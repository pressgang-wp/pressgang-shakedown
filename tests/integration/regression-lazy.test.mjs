import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { protectContext, semanticEvidence, settlePage } from '../../lib/regression-browser.mjs';
import { brokenImages } from '../../lib/health.mjs';

test('paired capture settles below-fold lazy images and discloses scroll limits', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/image.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>');
      return;
    }
    if (req.url === '/broken.svg') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html lang="en"><title>Lazy fixture</title><main><h1>Page</h1><div style="height:9000px"></div><img alt="Lazy" src="/image.svg" width="80" height="40" loading="lazy"><img alt="Broken" src="/broken.svg" width="80" height="40" loading="lazy"></main></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, serviceWorkers: 'block' });
    await protectContext(context, origin, [], 5000);
    const page = await context.newPage();
    await page.goto(origin);
    assert.equal((await semanticEvidence(page)).images[0].naturalWidth, 0);
    assert.equal(requests.includes('/image.svg'), false);
    const limited = await settlePage(page, { maxScrollSteps: 1, imageTimeout: 50 });
    assert.equal(limited.reachedBottom, false);
    assert.ok(limited.pendingImages.length > 0);
    const settled = await settlePage(page);
    assert.equal(settled.reachedBottom, true);
    assert.deepEqual(settled.pendingImages, []);
    assert.equal((await semanticEvidence(page)).images[0].naturalWidth, 80);
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.deepEqual(await brokenImages(page), []);
    assert.deepEqual(await brokenImages(page, { includeLazy: true }), [`broken image: ${origin}/broken.svg`]);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
