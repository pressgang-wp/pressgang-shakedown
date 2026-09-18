import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, request } from '@playwright/test';
import { getEvidence, protectContext, semanticEvidence } from '../../lib/regression-browser.mjs';

// Real browser test: method restrictions must hold below page JavaScript, not just CLI dispatch.
test('anonymous transport blocks POST, actions, sockets and unsafe redirects before they reach servers', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, cookie: req.headers.cookie, connection: req.headers.connection, port: req.socket.remotePort });
    if (req.url === '/redirect') { res.writeHead(302, { location: '/wp-admin/' }); res.end(); return; }
    if (req.url === '/external') { res.writeHead(302, { location: 'http://localhost:1/' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=secret' });
    res.end(`<title>Fixture</title><main><h1> Hello   world </h1><a href="">Blank</a><h2></h2><form><input type="hidden" value="nonce"><input name="q"></form></main><script>
    fetch('/write',{method:'POST',body:'bad'}).catch(()=>{});
    fetch('/wp-admin/').catch(()=>{});
    fetch('/read').catch(()=>{});
    new WebSocket('ws://127.0.0.1:'+location.port+'/socket');
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let browser, context, api;
  try {
    api = await request.newContext();
    const response = await getEvidence(api, url);
    assert.equal(response.status, 200);
    await assert.rejects(() => getEvidence(api, url + '/redirect'), /Blocked/);
    await assert.rejects(() => getEvidence(api, url + '/external'), /Blocked/);
    browser = await chromium.launch();
    context = await browser.newContext({ serviceWorkers: 'block' });
    const blocked = [];
    await protectContext(context, url, blocked, 5000);
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForTimeout(200);
    const evidence = await semanticEvidence(page);
    assert.deepEqual(evidence.h1, ['Hello world']);
    assert.equal(evidence.emptyLinks.length, 1);
    assert.equal(evidence.emptyHeadings.length, 1);
    assert.equal(evidence.forms[0].fields.length, 1);
    assert.ok(blocked.some(s => s.startsWith('POST')));
    assert.ok(blocked.some(s => s.startsWith('WebSocket')));
    assert.ok(seen.every(req => req.method === 'GET' && !req.cookie && !req.url.startsWith('/wp-admin') && req.url !== '/write'));
    assert.deepEqual(await context.cookies(), []);
    assert.ok(seen.every(req => req.connection === 'close'));
    assert.equal(new Set(seen.map(req => req.port)).size, seen.length, 'anonymous requests must not reuse sockets');
    await page.goto(url + '/redirect').catch(() => {});
    assert.ok(seen.every(req => !req.url.startsWith('/wp-admin')));
  } finally {
    await api?.dispose(); await context?.close(); await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('a transport failure after route fulfilment cannot crash the runner by aborting twice', async () => {
  const server = createServer((req, res) => { res.end('<title>Fixture</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let handleRoute, closeTransport;
  const context = {
    once(event, callback) { closeTransport = callback; },
    async routeWebSocket() {},
    async route(pattern, callback) { handleRoute = callback; },
  };
  const blocked = [];
  try {
    await protectContext(context, origin, blocked, 5000);
    await assert.doesNotReject(() => handleRoute({
      request: () => ({ url: () => origin, method: () => 'GET', isNavigationRequest: () => true, headers: () => ({}) }),
      fulfill: async () => { throw new Error('Target page, context or browser has been closed'); },
      abort: async () => { throw new Error('Route is already handled!'); },
    }));
    assert.equal(blocked.length, 1);
    assert.match(blocked[0], /transport .*Target page, context or browser has been closed/);
  } finally {
    closeTransport?.();
    await new Promise(resolve => server.close(resolve));
  }
});
