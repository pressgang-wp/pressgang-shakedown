import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared runner config for all shakedown passes.
 *
 * The workspace (SHAKEDOWN_WORKSPACE, set by the CLI — falls back to this
 * package for standalone use) owns all run artifacts: matrix, reports,
 * traces. The derived passes live in this package's `passes/`; a workspace
 * `tests/e2e/` directory, when present, runs alongside them as the journeys
 * suite.
 *
 * Note the two distinct `tests/` meanings: paths built from `workspace` are
 * the CONSUMER theme's (its journeys and committed visual baselines), while
 * this package's own shipped checks live in `passes/` — deliberately not
 * `tests/`, which is reserved for this repo's unit tests and is not published.
 *
 * `ignoreHTTPSErrors` accommodates self-signed local TLS (.test domains);
 * traces are kept on failure so any red route can be replayed step-by-step.
 */
const pkgRoot = dirname(fileURLToPath(import.meta.url));
const workspace = process.env.SHAKEDOWN_WORKSPACE ?? pkgRoot;
const journeysDir = join(workspace, 'tests/e2e');

export default defineConfig({
  fullyParallel: true,
  // Attached mode drives one shared PHP-FPM; a single retry absorbs load transients.
  retries: 1,
  outputDir: join(workspace, 'test-results'),
  // Visual baselines belong to the THEME (committed in its repo), keyed by
  // platform because font rendering differs across OSes — macOS baselines
  // and CI Linux baselines coexist.
  snapshotPathTemplate: join(workspace, 'tests', '__screenshots__', '{platform}', '{arg}{ext}'),
  reporter: [
    ['list'],
    ['html', { outputFolder: join(workspace, 'playwright-report'), open: 'never' }],
    [join(pkgRoot, 'lib', 'trial-reporter.mjs')],
  ],
  use: {
    // Journeys (tests/e2e/) navigate with relative paths; the CLI exports the
    // sandbox/target origin so page.goto('/path') resolves. Derived passes use
    // full matrix URLs and ignore this.
    baseURL: process.env.SHAKEDOWN_BASE_URL || undefined,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [
    // testMatch is explicit: the passes are a closed set of *.spec.mjs files,
    // so a helper or a stray *.test.mjs alongside them is never collected.
    { name: 'derived', testDir: join(pkgRoot, 'passes'), testMatch: '**/*.spec.mjs' },
    ...(existsSync(journeysDir) ? [{ name: 'journeys', testDir: journeysDir }] : []),
  ],
});
