import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { seedAcfStates } from '../../lib/sandbox.mjs';

test('seedAcfStates passes the configured seed and epoch to Muster', () => {
  const root = mkdtempSync(join(tmpdir(), 'shakedown-seed-test-'));
  const theme = 'fixture-theme';
  const acfJson = join(root, 'wp-content', 'themes', theme, 'acf-json');
  const fakeBin = join(root, 'bin');
  const capture = join(root, 'wp-args.txt');
  const fakeWp = join(fakeBin, 'wp');
  const oldPath = process.env.PATH;
  const oldCapture = process.env.SHAKEDOWN_WP_CAPTURE;

  mkdirSync(acfJson, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(fakeWp, `#!/bin/sh
printf '%s\n' "$@" > "$SHAKEDOWN_WP_CAPTURE"
printf '{"routes":[]}'
`);
  chmodSync(fakeWp, 0o755);
  process.env.PATH = `${fakeBin}:${oldPath}`;
  process.env.SHAKEDOWN_WP_CAPTURE = capture;

  try {
    const routes = seedAcfStates(
      { root, theme },
      '/tmp/muster/vendor/autoload.php',
      { seed: 1978, epoch: '2030-04-05T06:07:08+00:00' }
    );

    assert.deepEqual(routes, []);
    const args = readFileSync(capture, 'utf8').trim().split('\n');
    assert.equal(args[0], 'eval-file');
    assert.equal(args[2], '/tmp/muster/vendor/autoload.php');
    assert.equal(args[3], acfJson);
    assert.equal(args[4], '1978');
    assert.equal(args[5], '2030-04-05T06:07:08+00:00');
    assert.equal(args[6], `--path=${root}`);
  } finally {
    process.env.PATH = oldPath;
    if (oldCapture === undefined) delete process.env.SHAKEDOWN_WP_CAPTURE;
    else process.env.SHAKEDOWN_WP_CAPTURE = oldCapture;
    rmSync(root, { recursive: true, force: true });
  }
});

test('seedAcfStates rejects ambiguous deterministic inputs', () => {
  assert.throws(
    () => seedAcfStates({ root: '/tmp', theme: 'theme' }, '/tmp/autoload.php', { seed: '42' }),
    /seed must be an integer/
  );
  assert.throws(
    () => seedAcfStates({ root: '/tmp', theme: 'theme' }, '/tmp/autoload.php', { epoch: '' }),
    /timezone-qualified ISO 8601/
  );
  assert.throws(
    () => seedAcfStates(
      { root: '/tmp', theme: 'theme' },
      '/tmp/autoload.php',
      { epoch: '2030-04-05T06:07:08' }
    ),
    /timezone-qualified ISO 8601/
  );
});
