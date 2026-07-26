import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSuppressions, ignoresFor, IGNORE_KEYS, normaliseIgnore, suppressed } from '../../lib/suppress.mjs';

test('suppressed() matches on substring, anywhere in the finding', () => {
  assert.equal(suppressed(['googletagmanager'], 'GET https://www.googletagmanager.com/gtm.js 404'), true);
  assert.equal(suppressed(['Deprecated: '], 'Deprecated: foo in wp-content/plugins/acf/acf.php:12'), true);
  // Origin-based suppression: the PHP signature carries a path, so a pattern
  // naming a directory silences everything raised inside it.
  assert.equal(suppressed(['wp-content/plugins/acf/'], 'Undefined key in wp-content/plugins/acf/acf.php:12'), true);
  assert.equal(suppressed(['wp-content/plugins/acf/'], 'Undefined key in wp-content/themes/mine/f.php:3'), false);
});

test('suppressed() suppresses nothing when there are no patterns', () => {
  assert.equal(suppressed([], 'anything at all'), false);
  assert.equal(suppressed(undefined, 'anything at all'), false);
});

test('suppressed() is case-sensitive and never treats patterns as regex', () => {
  assert.equal(suppressed(['deprecated'], 'Deprecated: foo'), false);
  // A regex metacharacter is a literal: '.' must not match an arbitrary char,
  // or a pattern meant to be narrow would silently widen.
  assert.equal(suppressed(['a.c'], 'abc'), false);
  assert.equal(suppressed(['a.c'], 'a.c'), true);
  assert.equal(suppressed(['.*'], 'anything'), false);
});

test('normaliseIgnore() fills every category so callers never branch on absence', () => {
  const ignore = normaliseIgnore({ consoleErrors: ['gtm'] });

  assert.deepEqual(Object.keys(ignore).sort(), Object.keys(IGNORE_KEYS).sort());
  assert.deepEqual(ignore.consoleErrors, ['gtm']);
  assert.deepEqual(ignore.routes, []);
  assert.deepEqual(normaliseIgnore(), normaliseIgnore({}));
});

test('normaliseIgnore() rejects a mistyped key rather than silently ignoring it', () => {
  // The whole failure mode: `consoleError` reads as though it suppresses, and
  // would suppress nothing at all.
  assert.throws(() => normaliseIgnore({ consoleError: ['gtm'] }), /Unknown ignore key\(s\): consoleError/);
  assert.throws(() => normaliseIgnore({ a11yRule: ['x'] }), /Valid keys:/);
});

test('normaliseIgnore() rejects malformed pattern lists', () => {
  assert.throws(() => normaliseIgnore({ consoleErrors: 'gtm' }), /must be an array/);
  assert.throws(() => normaliseIgnore({ consoleErrors: [''] }), /non-empty strings/);
  assert.throws(() => normaliseIgnore({ consoleErrors: ['  '] }), /non-empty strings/);
  assert.throws(() => normaliseIgnore({ consoleErrors: [42] }), /non-empty strings/);
  assert.throws(() => normaliseIgnore(['routes']), /must be an object/);
  assert.throws(() => normaliseIgnore(null), /must be an object/);
});

test('normaliseIgnore() copies, so a caller cannot mutate the config it was given', () => {
  const raw = { routes: ['/a'] };
  normaliseIgnore(raw).routes.push('/b');

  assert.deepEqual(raw.routes, ['/a']);
});

test('ignoresFor() tolerates a matrix written before the policy existed', () => {
  assert.deepEqual(ignoresFor({ ignore: { routes: ['/a'] } }, 'routes'), ['/a']);
  assert.deepEqual(ignoresFor({}, 'routes'), []);
  assert.deepEqual(ignoresFor(undefined, 'routes'), []);
  // A non-array survivor from a hand-edited matrix must not reach .some()
  assert.deepEqual(ignoresFor({ ignore: { routes: 'oops' } }, 'routes'), []);
});

test('every documented ignore key is a real category', () => {
  // IGNORE_KEYS is the single source of truth: normaliseIgnore() accepts exactly
  // these, the trial report describes them from the same map, and anything else
  // throws. A key added to one and not the other would suppress nothing.
  for (const key of Object.keys(IGNORE_KEYS)) {
    assert.deepEqual(normaliseIgnore({ [key]: ['x'] })[key], ['x']);
    assert.equal(typeof IGNORE_KEYS[key], 'string');
  }
  assert.ok(Object.keys(IGNORE_KEYS).includes('errorSignatures'));
});

test('activeSuppressions() reports only non-empty categories, for disclosure', () => {
  assert.deepEqual(activeSuppressions(normaliseIgnore({})), []);
  assert.deepEqual(
    activeSuppressions(normaliseIgnore({ a11yRules: ['color-contrast'], routes: ['/x'] })),
    [{ key: 'routes', patterns: ['/x'] }, { key: 'a11yRules', patterns: ['color-contrast'] }]
  );
});
