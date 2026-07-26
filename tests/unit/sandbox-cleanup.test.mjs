import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bootSandbox } from '../../lib/sandbox.mjs';

/** Sandbox temp trees currently on disk, by name. */
const sandboxDirs = () => readdirSync(tmpdir()).filter((d) => d.startsWith('shakedown-sandbox-'));

test('bootSandbox() leaves no temp tree behind when assembly fails', async () => {
  // A site path that cannot be read makes assemble() throw on its first
  // readdirSync — before the SQLite download, so this needs no network. This is
  // the case that was previously impossible to clean up: assemble owned the
  // temp dir it had just created, so a throw inside it stranded a directory the
  // caller had never been told the name of.
  const before = sandboxDirs();

  await assert.rejects(
    () => bootSandbox({ sitePath: join(tmpdir(), 'shakedown-does-not-exist'), sandbox: {} }),
    /ENOENT/
  );

  assert.deepEqual(sandboxDirs(), before, 'a failed boot left a temp tree behind');
});

test('bootSandbox() deregisters its signal handlers, so boots do not stack listeners', async () => {
  // The handlers exist because a signal bypasses try/finally. destroy() has to
  // remove them again, or a process that boots repeatedly accumulates listeners
  // until Node warns — and every stale handler still points at a dead sandbox.
  const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };

  for (let i = 0; i < 12; i++) {
    await assert.rejects(() => bootSandbox({ sitePath: join(tmpdir(), `shakedown-nope-${i}`), sandbox: {} }));
  }

  assert.equal(process.listenerCount('SIGINT'), before.int, 'SIGINT listeners left registered');
  assert.equal(process.listenerCount('SIGTERM'), before.term, 'SIGTERM listeners left registered');
});

test('bootSandbox() leaves no temp tree behind when `wp core install` fails', async () => {
  // Assembly succeeds far enough to matter, then WP-CLI fails against a tree
  // that is not a WordPress install. Guarded on the SQLite plugin already being
  // cached, so the suite never reaches for the network.
  const cached = join(process.env.HOME ?? '', '.cache', 'pressgang-shakedown', 'sqlite-database-integration');
  if (!existsSync(cached)) {
    return; // nothing to assert without the cached drop-in; covered by the case above
  }

  const site = mkdtempSync(join(tmpdir(), 'shakedown-fakesite-'));
  mkdirSync(join(site, 'wp-content', 'themes'), { recursive: true });
  writeFileSync(join(site, 'wp-config.php'), '<?php // not a real install');
  writeFileSync(join(site, 'index.php'), '<?php // not a real install');

  const before = sandboxDirs();

  try {
    await assert.rejects(() => bootSandbox({ sitePath: site, sandbox: {} }));
    assert.deepEqual(sandboxDirs(), before, 'a failed install left a temp tree behind');
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});
