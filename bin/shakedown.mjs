#!/usr/bin/env node
/**
 * shakedown — sea trials for PressGang themes.
 *
 * Run from inside a theme (or anywhere in a WordPress project):
 *
 *   shakedown            derive the matrix, then run every pass
 *   shakedown matrix     derive and print the route matrix only
 *   shakedown test [...] run passes (extra args pass through to Playwright)
 *   shakedown ui         Playwright UI mode
 *
 * The invocation directory is the workspace: matrix, reports, and traces are
 * written there, and its tests/e2e/ (if present) runs as the journeys suite.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from '../lib/target.mjs';
import { deriveMatrix } from '../lib/derive.mjs';
import { bootSandbox } from '../lib/sandbox.mjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = process.cwd();

const argv = process.argv.slice(2);
const targetFlag = (argv.find((a) => a.startsWith('--target=')) || '').split('=')[1];
const args = argv.filter((a) => !a.startsWith('--target='));
const command = args[0] ?? 'all';

/** Derive and persist the matrix, printing a summary. */
function matrix(target) {
  const { matrix: m, source } = deriveMatrix(target, workspace);
  console.log(`⚓ ${m.routes.length} routes for ${target.baseUrl} (via ${source})`);

  return m;
}

/** Run Playwright with the packaged config against the workspace. */
function test(extraArgs = []) {
  // Resolve Playwright's CLI from this package's own dependency tree —
  // consumers installing via file:/github: symlinks have no `playwright`
  // binary on their PATH or in their local node_modules/.bin.
  const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');

  const result = spawnSync(
    process.execPath,
    [playwrightCli, 'test', `--config=${join(pkgRoot, 'playwright.config.ts')}`, ...extraArgs],
    {
      cwd: workspace,
      stdio: 'inherit',
      env: { ...process.env, SHAKEDOWN_WORKSPACE: workspace },
    }
  );

  process.exitCode = result.status ?? 1;
}

try {
  const target = resolveTarget(workspace, { target: targetFlag });

  switch (command) {
    case 'matrix':
      for (const r of matrix(target).routes) {
        console.log(`  [${r.expect}] ${r.kind.padEnd(28)} ${r.url}`);
      }
      break;
    case 'test':
      test(args.slice(1));
      break;
    case 'ui':
      test(['--ui']);
      break;
    case 'all':
      matrix(target);
      test(args.slice(1));
      break;
    case 'sandbox': {
      // Throwaway WP: your code, symlinked read-only; its own SQLite DB and
      // uploads in a temp dir. The real database is never touched — this is
      // the only engine allowed to seed, because nothing persists.
      console.log('⚓ assembling sandbox (fresh SQLite, code symlinked read-only)…');
      const sandbox = await bootSandbox(target);
      console.log(`⚓ sandbox up at ${sandbox.baseUrl}`);
      try {
        matrix({ ...target, name: 'sandbox', sitePath: sandbox.root, baseUrl: sandbox.baseUrl });
        test(args.slice(1));
      } finally {
        sandbox.stop();
        console.log('⚓ sandbox destroyed');
      }
      break;
    }
    default:
      console.error(`Unknown command "${command}". Usage: shakedown [matrix|test|ui|sandbox] [--target=<name>]`);
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`shakedown: ${err.message}`);
  process.exitCode = 1;
}
