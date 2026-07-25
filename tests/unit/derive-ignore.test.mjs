import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deriveMatrix } from '../../lib/derive.mjs';
import { normaliseIgnore } from '../../lib/suppress.mjs';

/**
 * Stand up a fake `wp` on PATH that answers the matrix derivation with a fixed
 * route set, so route filtering can be tested without a WordPress install.
 */
function withFakeWp(routes, run) {
  const root = mkdtempSync(join(tmpdir(), 'shakedown-derive-test-'));
  const bin = join(root, 'bin');
  const oldPath = process.env.PATH;

  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'wp'), `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify({ routes })}\nJSON\n`);
  chmodSync(join(bin, 'wp'), 0o755);
  process.env.PATH = `${bin}:${oldPath}`;

  try {
    return run(root);
  } finally {
    process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
}

const ROUTES = [
  { url: 'https://site.test/', kind: 'home', expect: 200 },
  { url: 'https://site.test/private-area/', kind: 'template:private.php', expect: 200 },
  { url: 'https://site.test/wp-json/wp/v2/posts', kind: 'menu:main', expect: 200 },
  { url: 'https://site.test/about/', kind: 'template:about.php', expect: 200 },
];

const target = (ignore) => ({
  name: 'test',
  baseUrl: 'https://site.test',
  sitePath: '/nonexistent',
  samplesPerType: 2,
  searchTerm: 'test',
  ignore: normaliseIgnore(ignore),
});

test('deriveMatrix() drops routes matched by ignore.routes and reports the count', () => {
  withFakeWp(ROUTES, (workspace) => {
    const { matrix, ignored } = deriveMatrix(target({ routes: ['/private-area', '/wp-json/'] }), workspace);

    assert.equal(ignored, 2);
    assert.deepEqual(matrix.routes.map((r) => r.url), ['https://site.test/', 'https://site.test/about/']);
  });
});

test('deriveMatrix() keeps every route when nothing is ignored', () => {
  withFakeWp(ROUTES, (workspace) => {
    const { matrix, ignored } = deriveMatrix(target({}), workspace);

    assert.equal(ignored, 0);
    assert.equal(matrix.routes.length, ROUTES.length);
  });
});

test('deriveMatrix() records the policy in the matrix, so passes and the report can read it', () => {
  withFakeWp(ROUTES, (workspace) => {
    deriveMatrix(target({ consoleErrors: ['gtm'], a11yRules: ['color-contrast'] }), workspace);

    const persisted = JSON.parse(readFileSync(join(workspace, '.shakedown', 'matrix.json'), 'utf8'));

    assert.deepEqual(persisted.ignore.consoleErrors, ['gtm']);
    assert.deepEqual(persisted.ignore.a11yRules, ['color-contrast']);
    // Every category present, so a pass never has to branch on a missing key.
    assert.deepEqual(persisted.ignore.phpIssues, []);
  });
});
