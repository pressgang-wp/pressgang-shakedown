import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { origin, mapRoute, routePath, pairedPlan, regressionOptions, classifyRoute, compareEvidence, normaliseText, safeURL } from '../../lib/regression-plan.mjs';
import { availabilityFindings } from '../../lib/health.mjs';
import { reportSummary, writeRegressionReport } from '../../lib/regression-report.mjs';

const raw = { references: { production: 'https://prod.test' }, candidates: { local: 'https://local.test' } };
const options = () => regressionOptions(raw, 'https://discovery.test');
test('origin and remapping reject authority tricks, actions and preserve exact identity', () => {
  assert.equal(mapRoute('https://discovery.test/a%20b/?s=x%2By&page=2#anchor', 'https://discovery.test', 'https://prod.test'), 'https://prod.test/a%20b/?s=x%2By&page=2');
  for (const value of ['//evil.test/x', 'https://discovery.test.evil/x', '/\\evil.test', '/wp-admin/', '/?action=delete', 'javascript:alert(1)', 'https://u:p@discovery.test/']) assert.throws(() => routePath(value, 'https://discovery.test'));
  for (const value of ['https://prod.test/path', 'https://prod.test/?x=1', 'ftp://prod.test', 'https://u:p@prod.test']) assert.throws(() => origin(value));
  assert.equal(safeURL('https://prod.test/%77p-admin/'), false);
});
test('config validates keys, endpoints, viewport bounds and policies', () => {
  assert.equal(options().viewports.length, 3);
  for (const patch of [{ refernces: {} }, { accept: [''] }, { viewports: [] }, { navigationLimit: 201 }, { timeout: -1 }, { candidates: raw.references }]) assert.throws(() => regressionOptions({ ...raw, ...patch }, 'https://discovery.test'));
  assert.throws(() => regressionOptions(raw, 'https://discovery.test', { candidate: 'missing' }));
});
test('plan preserves identity, discloses excluded routes and never pairs by type', () => {
  const plan = pairedPlan({ routes: [{ url: 'https://discovery.test/a', kind: 'single:post', expect: 200 }, { url: 'https://discovery.test/b', kind: 'single:post', expect: 200 }, { url: 'https://outside.test/', expect: 200 }] }, options(), 'capstan');
  assert.deepEqual(plan.routes.map(r => r.path), ['/a', '/b']);
  assert.equal(plan.excluded.length, 1);
});
test('presence classification distinguishes missing from inaccessible and unrelated redirects', () => {
  const route = { expect: 200 }, ok = { status: 200, finalPath: '/a' };
  assert.equal(classifyRoute(route, ok, ok), 'matched');
  assert.equal(classifyRoute(route, { status: 404 }, ok), 'candidate-only');
  assert.equal(classifyRoute(route, ok, { status: 410 }), 'reference-only');
  assert.equal(classifyRoute(route, { error: 'timeout' }, ok), 'inconclusive');
  assert.equal(classifyRoute(route, { status: 403 }, ok), 'inconclusive');
  assert.equal(classifyRoute(route, ok, { ...ok, finalPath: '/b' }), 'unmatched');
  assert.equal(classifyRoute({ expect: 404 }, { status: 404 }, { status: 404 }), 'matched');
});
test('normalization is narrow; differences and accepted differences remain evidence', () => {
  assert.equal(normaliseText(' Hello \n world '), 'Hello world');
  assert.deepEqual(compareEvidence({ title: 'Hello  world', h1: ['A\nB'] }, { title: 'Hello world', h1: ['A B'] }, '/'), []);
  const diffs = compareEvidence({ title: 'Old', emptyLinks: [] }, { title: 'New', emptyLinks: [{}] }, '/a', ['title on /a']);
  assert.deepEqual(diffs.map(d => [d.key, d.suppressed]), [['title', true], ['emptyLinks', false]]);
});
test('shared health handles feeds, error signatures, optional and required oracle', () => {
  const route = { url: 'https://local.test/', expect: 200 };
  assert.deepEqual(availabilityFindings({ ...route, html: false }, { status: 200 }, '<rss/>'), []);
  assert.deepEqual(availabilityFindings(route, { status: 200 }, '<title>OK</title>Warning: ', { errorSignatures: ['Warning: '] }), []);
  assert.ok(availabilityFindings(route, { status: 200 }, '<title>OK</title>', {}, true).includes('observer did not answer'));
  assert.equal(availabilityFindings({ ...route, expect: 404 }, { status: 302 }, '').length, 0);
});
test('report escapes source content and separates health, differences, accepted and incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'regression-report-'));
  try {
    const run = { state: 'incomplete', results: [{ path: '<script>', health: ['<img onerror=x>'], classification: 'unmatched', differences: [{ suppressed: true }, { suppressed: false }], reference: {}, candidate: {} }] };
    const summary = reportSummary(run);
    assert.equal(summary.healthFailures, 1); assert.equal(summary.accepted, 1); assert.equal(summary.inconclusive, 1);
    writeRegressionReport(dir, run);
    assert.ok(!readFileSync(join(dir, 'index.html'), 'utf8').includes('<script>'));
  } finally { rmSync(dir, { recursive: true }); }
});
test('regression rejects baseline flags, journeys and arbitrary Playwright options before discovery', () => {
  for (const flag of ['--update-snapshots', '--update-snapshots=all', '-u', '--project=journeys', '--config=evil.mjs']) {
    const result = spawnSync(process.execPath, ['bin/shakedown.mjs', 'regression', flag], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /sandbox mode|Unsupported regression argument/);
  }
});
