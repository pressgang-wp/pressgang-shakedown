import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRegressionSession } from '../../lib/regression-runner.mjs';
import { pairedPlan, regressionOptions } from '../../lib/regression-plan.mjs';
import { chromium } from '@playwright/test';

const options = regressionOptions({
  references: { production: 'https://production.test' },
  candidates: { local: 'https://local.test' },
}, 'https://local.test');
const matrix = { routes: [{ url: 'https://local.test/', kind: 'home', expect: 200 }] };

async function session(prepare, check) {
  const workspace = mkdtempSync(join(tmpdir(), 'shakedown-session-'));
  const listeners = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
  try {
    const run = await runRegressionSession(workspace, { prepare });
    assert.equal(run.state, 'incomplete');
    assert.equal(run.exitCode, 2);
    assert.deepEqual(run.results, []);
    const saved = JSON.parse(readFileSync(join(run.dir, 'run.json'), 'utf8'));
    assert.equal(saved.exitCode, 2);
    assert.equal(process.listenerCount('SIGINT'), listeners.int);
    assert.equal(process.listenerCount('SIGTERM'), listeners.term);
    check(run, saved);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}

test('preparation failure leaves a fresh incomplete report before a plan exists', async () => {
  await session((run, dir) => {
    assert.ok(existsSync(join(dir, 'index.html')), 'initial report must precede discovery');
    throw new Error('Discovery failed\nprivate command details');
  }, (run, saved) => {
    assert.equal(run.error, 'Discovery failed');
    assert.equal(saved.plan, undefined);
    assert.equal(saved.discovery.navigation, 'pending');
    assert.match(readFileSync(join(run.dir, 'index.html'), 'utf8'), /Discovery failed/);
  });
});

test('preparation failure retains the partial plan and unavailable coverage evidence', async () => {
  await session(run => {
    run.plan = pairedPlan(matrix, options, 'capstan');
    run.coverage = { mode: 'exhaustive', state: 'unavailable', error: 'Inventory failed' };
    throw new Error('Exhaustive inventory unavailable: Inventory failed');
  }, (run, saved) => {
    assert.equal(run.plan.routes[0].path, '/');
    assert.equal(saved.coverage.state, 'unavailable');
    assert.equal(saved.coverage.notVisited.length, options.viewports.length);
    assert.equal(existsSync(join(run.dir, 'plan.json')), false, 'preparation had not reached plan persistence');
    assert.match(readFileSync(join(run.dir, 'index.html'), 'utf8'), /number of omitted routes is unknown/);
  });
});

test('asynchronous preparation rejection is contained and retains partial evidence', async () => {
  await session(async run => {
    await Promise.resolve();
    run.plan = pairedPlan(matrix, options, 'capstan');
    throw new Error('Async inventory failed');
  }, (run, saved) => {
    assert.equal(run.error, 'Async inventory failed');
    assert.equal(saved.plan.routes[0].path, '/');
    assert.equal(saved.coverage.notVisited.length, options.viewports.length);
  });
});

test('interruption during preparation prevents browser startup', async t => {
  const launch = t.mock.method(chromium, 'launch', async () => { throw new Error('Browser should not start'); });
  await session(async run => {
    run.plan = pairedPlan(matrix, options, 'capstan');
    await Promise.resolve();
    process.emit('SIGINT');
  }, run => {
    assert.equal(launch.mock.callCount(), 0);
    assert.equal(run.error, 'Run interrupted; remaining routes were not checked.');
  });
});

test('interruption during browser startup closes the acquired browser without beginning capture', async t => {
  let closes = 0, captures = 0;
  t.mock.method(chromium, 'launch', async () => {
    process.emit('SIGINT');
    return {
      async close() { closes++; },
      async newContext() { captures++; throw new Error('Capture should not start'); },
    };
  });
  await session(run => {
    run.plan = pairedPlan(matrix, options, 'capstan');
  }, run => {
    assert.equal(captures, 0);
    assert.equal(closes, 1);
    assert.equal(run.error, 'Run interrupted; remaining routes were not checked.');
  });
});

test('empty discovery and a critical-only plan cannot enter browser execution', async () => {
  for (const criticalRoutes of [[], ['/important/']]) {
    await session(run => {
      run.plan = pairedPlan({ routes: [] }, { ...options, criticalRoutes }, 'capstan');
    }, run => {
      assert.equal(run.error, 'No safe derived routes to compare; critical routes cannot replace discovery');
    });
  }
});
