import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleMatrix, browsableRoutes, prependMatrixRoutes } from '../../lib/matrix.mjs';
import { loadMatrix, readMatrix, writeMatrix } from '../../lib/matrix-store.mjs';
import { mergeRoutes } from '../../lib/derive.mjs';

const home = { url: 'https://site.test/', kind: 'home', expect: 200, template: 'front-page.php', controller: 'Site\\HomeController' };
const feed = { url: 'https://site.test/feed/', kind: 'feed', expect: 200, html: false };

test('matrix assembly preserves discovery metadata, precedence and policy without changing its inputs', () => {
  const discovery = {
    matrix: { generated: 'fixed', home: 'https://site.test/', routes: [home] },
    source: 'capstan',
    supplement: {
      source: 'bundled matrix-supplement.php',
      routes: [{ ...home, kind: 'menu:main' }, feed, { url: 'https://site.test/author/alice/', kind: 'author', expect: 200 }],
      warnings: ['Stored rules differ'], excluded: [{ kind: 'date', reason: 'No route' }],
    },
  };
  const target = { name: 'test', baseUrl: 'https://site.test', ignore: { routes: ['/author/'] } };
  const before = structuredClone({ discovery, target });
  const result = assembleMatrix(discovery, target);
  assert.deepEqual(result, {
    matrix: {
      ...discovery.matrix, target: 'test', baseUrl: target.baseUrl, ignore: target.ignore,
      routes: [{ ...home, derivation: 'capstan' }, { ...feed, derivation: 'bundled matrix-supplement.php' }],
      discoveryWarnings: ['Stored rules differ'], discoveryExcluded: discovery.supplement.excluded,
    },
    source: 'capstan', ignored: 1, supplemented: 2,
  });
  assert.deepEqual({ discovery, target }, before);
  assert.deepEqual(browsableRoutes(result.matrix), [result.matrix.routes[0]]);
});

test('seeded routes take first-occurrence precedence and preserve exact query identity', () => {
  const matrix = { routes: [home, feed, { ...home }], discoveryWarnings: ['kept'] };
  const state = { ...home, kind: 'state:populated' };
  const query = { ...home, url: home.url + '?a=1&b=2' };
  const reorderedQuery = { ...home, url: home.url + '?b=2&a=1' };
  const before = structuredClone(matrix);
  const result = prependMatrixRoutes(matrix, [state, { ...state, kind: 'state:minimal' }, query, reorderedQuery]);
  assert.deepEqual(result.routes, [state, query, reorderedQuery, feed]);
  assert.deepEqual(result.discoveryWarnings, ['kept']);
  assert.deepEqual(matrix, before);
});

test('late fixture merging cannot reintroduce an excluded route or lose policy disclosure', () => {
  const ignored = { url: 'https://site.test/private/', kind: 'state:populated', expect: 200 };
  const matrix = { routes: [home, feed], ignore: { routes: ['/private/', '/feed/'] } };
  const before = structuredClone(matrix);
  const result = prependMatrixRoutes(matrix, [ignored, { ...ignored, kind: 'state:minimal' }]);
  assert.deepEqual(result.routes, [home]);
  assert.deepEqual(result.ignore, matrix.ignore);
  assert.deepEqual(matrix, before);
});

test('matrix persistence and the existing merge entry point retain the JSON contract', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'shakedown-matrix-'));
  try {
    assert.throws(() => loadMatrix(workspace), /No matrix found/);
    const matrix = { target: 'sandbox', baseUrl: 'https://site.test', routes: [home, feed], ignore: { routes: ['/private/'] } };
    const path = writeMatrix(workspace, matrix);
    assert.equal(path, join(workspace, '.shakedown', 'matrix.json'));
    assert.equal(readFileSync(path, 'utf8'), JSON.stringify(matrix, null, 2));
    assert.deepEqual(loadMatrix(workspace), matrix);
    const states = [{ ...home, kind: 'state:minimal' }, { ...home, url: 'https://site.test/private/', kind: 'state:populated' }];
    const merged = mergeRoutes(workspace, states);
    assert.deepEqual(merged, prependMatrixRoutes(matrix, states));
    assert.deepEqual(readMatrix(workspace), merged);
    assert.deepEqual(loadMatrix(workspace).routes.map(route => route.url), [home.url, feed.url]);
    assert.deepEqual(loadMatrix(workspace).ignore, matrix.ignore);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('browser route selection excludes HTTP-only routes and non-success probes', () => {
  assert.deepEqual(browsableRoutes({ routes: [home, feed, { ...home, expect: 404 }, { ...home, expect: 301 }] }), [home]);
});
