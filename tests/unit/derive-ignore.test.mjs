import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deriveMatrix } from '../../lib/derive.mjs';
import { normaliseIgnore } from '../../lib/suppress.mjs';

/**
 * Stand up a fake `wp` on PATH that answers the matrix derivation with fixed
 * route sets, so merging and filtering can be tested without a WordPress
 * install. The stub distinguishes the two invocations the way the real thing
 * does — by which script it was handed.
 */
function withFakeWp({ base, supplement = [] }, run) {
  const root = mkdtempSync(join(tmpdir(), 'shakedown-derive-test-'));
  const bin = join(root, 'bin');
  const oldPath = process.env.PATH;

  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'wp'), `#!/bin/sh
case "$*" in
  *matrix-supplement.php*) cat <<'SUPP'
${JSON.stringify({ routes: supplement })}
SUPP
  ;;
  *) cat <<'BASE'
${JSON.stringify({ routes: base })}
BASE
  ;;
esac
`);
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
  withFakeWp({ base: ROUTES }, (workspace) => {
    const { matrix, ignored } = deriveMatrix(target({ routes: ['/private-area', '/wp-json/'] }), workspace);

    assert.equal(ignored, 2);
    assert.deepEqual(matrix.routes.map((r) => r.url), ['https://site.test/', 'https://site.test/about/']);
  });
});

test('deriveMatrix() keeps every route when nothing is ignored', () => {
  withFakeWp({ base: ROUTES }, (workspace) => {
    const { matrix, ignored } = deriveMatrix(target({}), workspace);

    assert.equal(ignored, 0);
    assert.equal(matrix.routes.length, ROUTES.length);
  });
});

test('deriveMatrix() records the policy in the matrix, so passes and the report can read it', () => {
  withFakeWp({ base: ROUTES }, (workspace) => {
    deriveMatrix(target({ consoleErrors: ['gtm'], a11yRules: ['color-contrast'] }), workspace);

    const persisted = JSON.parse(readFileSync(join(workspace, '.shakedown', 'matrix.json'), 'utf8'));

    assert.deepEqual(persisted.ignore.consoleErrors, ['gtm']);
    assert.deepEqual(persisted.ignore.a11yRules, ['color-contrast']);
    // Every category present, so a pass never has to branch on a missing key.
    assert.deepEqual(persisted.ignore.phpIssues, []);
  });
});

const SUPPLEMENT = [
  { url: 'https://site.test/author/jo/', kind: 'author', expect: 200 },
  { url: 'https://site.test/feed/', kind: 'feed', expect: 200, html: false },
  // Collides with a base route: the base label is the more specific one.
  { url: 'https://site.test/about/', kind: 'date:year', expect: 200 },
];

test('deriveMatrix() merges the supplementary families and counts them', () => {
  withFakeWp({ base: ROUTES, supplement: SUPPLEMENT }, (workspace) => {
    const { matrix, supplemented } = deriveMatrix(target({}), workspace);

    assert.equal(supplemented, 2, 'the colliding route should not have been added');
    assert.ok(matrix.routes.some((r) => r.kind === 'author'));
    // html: false survives the merge — the browser passes rely on it to skip feeds.
    assert.equal(matrix.routes.find((r) => r.kind === 'feed').html, false);
  });
});

test('deriveMatrix() lets base routes win a URL collision with a supplement', () => {
  withFakeWp({ base: ROUTES, supplement: SUPPLEMENT }, (workspace) => {
    const { matrix } = deriveMatrix(target({}), workspace);
    const about = matrix.routes.filter((r) => r.url === 'https://site.test/about/');

    assert.equal(about.length, 1, 'the URL should appear once');
    assert.equal(about[0].kind, 'template:about.php', 'the specific base label should have won');
  });
});

test('deriveMatrix() applies ignore.routes to supplementary families too', () => {
  withFakeWp({ base: ROUTES, supplement: SUPPLEMENT }, (workspace) => {
    const { matrix, ignored } = deriveMatrix(target({ routes: ['/feed/'] }), workspace);

    assert.equal(ignored, 1);
    assert.equal(matrix.routes.some((r) => r.kind === 'feed'), false);
  });
});
