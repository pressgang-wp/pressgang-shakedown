import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRegressionSession } from '../../lib/regression-runner.mjs';
import { pairedPlan, regressionOptions } from '../../lib/regression-plan.mjs';
import { addCoverage } from '../../lib/coverage.mjs';

test('browser execution consumes a supplied plan without a WordPress target or discovery process', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    const feed = req.url === '/feed/';
    res.writeHead(200, { 'content-type': feed ? 'application/rss+xml' : 'text/html' });
    res.end(feed ? '<rss/>' : '<!doctype html><html lang="en"><title>Prepared route</title><main><h1>Prepared route</h1></main></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const workspace = mkdtempSync(join(tmpdir(), 'shakedown-prepared-'));
  try {
    const options = regressionOptions({
      references: { production: 'http://127.0.0.1:1' }, candidates: { local: origin },
      defaultLevel: 'errors', viewports: [{ name: 'desktop', width: 800, height: 600 }, { name: 'mobile', width: 390, height: 844 }],
    }, origin);
    const matrix = { routes: [
      { url: origin + '/', kind: 'home', expect: 200 },
      { url: origin + '/feed/', kind: 'feed', expect: 200, html: false },
    ], ignore: {} };
    const run = await runRegressionSession(workspace, {
      async prepare(run) {
        await Promise.resolve();
        run.plan = pairedPlan(matrix, options, 'fixture inventory');
        run.coverage = addCoverage(run.plan, { routes: matrix.routes });
      },
    });
    assert.equal(run.state, 'complete');
    assert.equal(run.exitCode, 0);
    assert.equal(run.scope.level, 'errors');
    assert.equal(run.scope.comparison, false);
    assert.equal(run.results.length, 3, 'HTML is checked per viewport; feed once');
    assert.ok(run.results.every(result => result.classification === 'candidate-checked'));
    assert.equal(run.discovery.navigation, 'not run at errors level');
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.equal(requests.filter(request => request.url === '/feed/').length, 1);
    assert.equal(existsSync(join(workspace, '.shakedown', 'matrix.json')), false);
    const saved = JSON.parse(readFileSync(join(run.dir, 'run.json'), 'utf8'));
    assert.equal(saved.coverage.notVisited.length, 0);
    assert.equal(saved.coverage.notSelected.length, 0);
    assert.equal(readFileSync(join(run.dir, 'plan.json'), 'utf8'), JSON.stringify(run.plan, null, 2));
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(workspace, { recursive: true, force: true });
  }
});
