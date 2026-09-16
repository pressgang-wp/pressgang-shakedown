import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRegression } from '../../lib/regression.mjs';
import { regressionOptions } from '../../lib/regression-plan.mjs';
import { normaliseIgnore } from '../../lib/suppress.mjs';

test('derived runner keeps baselines and attached artifacts intact, reports missing routes and paired evidence', async () => {
  const methods = [];
  const serve = candidate => createServer((req, res) => {
    methods.push(req.method);
    if (req.url === '/feed/') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end('<rss/>'); return; }
    const missing = req.url === '/probe' || (candidate && req.url === '/gone');
    res.writeHead(missing ? 404 : 200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html lang="en"><title>${candidate ? 'Candidate' : 'Reference'}</title><main><h1>${missing ? 'Not found' : 'Welcome'}</h1><p>Content.</p>${candidate ? '<a href="">Empty destination</a><button></button>' : ''}</main><nav aria-label="Main"><a href="/gone">Other page</a></nav></html>`);
  });
  const reference = serve(false), candidate = serve(true);
  await Promise.all([reference, candidate].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  const ref = `http://127.0.0.1:${reference.address().port}`, dest = `http://127.0.0.1:${candidate.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), 'shakedown-regression-test-'));
  const originalPath = process.env.PATH;
  try {
    mkdirSync(join(dir, 'bin'));
    const matrix = { routes: [{ url: dest + '/', kind: 'home', expect: 200 }, { url: dest + '/feed/', kind: 'feed', html: false, expect: 200 }, { url: dest + '/probe', kind: '404', expect: 404 }] };
    writeFileSync(join(dir, 'bin', 'wp'), `#!/usr/bin/env node\nconst args=process.argv.slice(2);console.log(JSON.stringify(args.includes('doctor') ? {checks:[],failures:0,warnings:0} : args.includes('eval-file') ? {routes:[]} : ${JSON.stringify(matrix)}));\n`);
    chmodSync(join(dir, 'bin', 'wp'), 0o755);
    process.env.PATH = join(dir, 'bin') + ':' + originalPath;
    mkdirSync(join(dir, 'tests', '__screenshots__'), { recursive: true });
    mkdirSync(join(dir, '.shakedown'));
    writeFileSync(join(dir, 'tests', '__screenshots__', 'sentinel'), 'baseline');
    writeFileSync(join(dir, '.shakedown', 'matrix.json'), 'attached-matrix');
    writeFileSync(join(dir, '.shakedown', 'trial-report.html'), 'attached-report');
    const target = { sitePath: dir, baseUrl: dest, samplesPerType: 2, searchTerm: 'test', ignore: normaliseIgnore(), regression: regressionOptions({ references: { production: ref }, candidates: { local: dest }, viewports: [{ name: 'desktop', width: 800, height: 600 }], accept: ['title on /'] }, dest) };
    const run = await runRegression(target, dir);
    assert.equal(run.state, 'complete');
    assert.equal(run.exitCode, 1);
    assert.equal(run.results.find(r => r.path === '/gone').classification, 'reference-only');
    assert.equal(run.results.find(r => r.path === '/feed/').candidate.screenshot, undefined);
    assert.ok(run.results[0].differences.some(d => d.key === 'title' && d.suppressed));
    assert.ok(run.results[0].differences.some(d => d.key === 'emptyLinks' && !d.suppressed));
    assert.ok(readFileSync(join(run.dir, run.results[0].candidate.screenshot)).length > 100);
    const evidence = run.results[0].candidate.accessibility;
    assert.ok(evidence.findings.some(f => f.id === 'button-name' && f.nodes[0].highlight.box));
    assert.ok(readFileSync(join(run.dir, evidence.screenshot)).length > 100);
    assert.match(readFileSync(join(run.dir, 'index.html'), 'utf8'), /Accessibility: element details/);
    assert.equal(readFileSync(join(dir, 'tests', '__screenshots__', 'sentinel'), 'utf8'), 'baseline');
    assert.equal(readFileSync(join(dir, '.shakedown', 'matrix.json'), 'utf8'), 'attached-matrix');
    assert.equal(readFileSync(join(dir, '.shakedown', 'trial-report.html'), 'utf8'), 'attached-report');
    assert.ok(methods.every(method => method === 'GET'));
  } finally {
    process.env.PATH = originalPath;
    await Promise.all([reference, candidate].map(server => new Promise(resolve => server.close(resolve))));
    rmSync(dir, { recursive: true });
  }
});

test('interrupting a paired run preserves an explicit incomplete report', async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { readdirSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'shakedown-regression-interrupt-'));
  let child, interrupted = false;
  const server = createServer((req, res) => {
    if (child && !interrupted) {
      interrupted = true;
      child.kill('SIGINT');
    }
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Fixture</title>');
    }, 100);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ref = `http://127.0.0.1:${server.address().port}`;
  try {
    mkdirSync(join(dir, 'bin'));
    const matrix = { routes: [{ url: 'http://discovery.test/', kind: 'home', expect: 200 }] };
    writeFileSync(join(dir, 'bin', 'wp'), `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.includes('doctor') ? {checks:[],failures:0,warnings:0} : process.argv.includes('eval-file') ? {routes:[]} : ${JSON.stringify(matrix)}));\n`);
    chmodSync(join(dir, 'bin', 'wp'), 0o755);
    writeFileSync(join(dir, 'shakedown.config.json'), JSON.stringify({ sitePath: dir, baseUrl: 'http://discovery.test', regression: { references: { production: ref }, candidates: { local: 'http://127.0.0.1:1' }, navigationLimit: 0 } }));
    const cli = new URL('../../bin/shakedown.mjs', import.meta.url).pathname;
    child = spawn(process.execPath, [cli, 'regression'], { cwd: dir, env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH }, stdio: 'ignore' });
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null);
    assert.equal(code, 2);
    const root = join(dir, '.shakedown', 'regression');
    const run = JSON.parse(readFileSync(join(root, readdirSync(root)[0], 'run.json')));
    assert.equal(run.state, 'incomplete');
    assert.match(run.error, /interrupted/);
    assert.equal(run.results.length, 0);
    assert.equal(run.exitCode, 2);
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
