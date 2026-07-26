import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { browsableRoutes, loadMatrix } from './matrix.mjs';

/**
 * Pass 03 — visual regression.
 *
 * Full-page screenshots of every 200 route against baselines committed in
 * the workspace (`tests/__screenshots__/`, per-platform). Deterministic
 * fixtures (seeded values, pinned dates) are what make these stable —
 * a diff should mean the THEME changed, not the content.
 *
 * Baselines are only ever written on purpose. `playwright.config.mjs` pins
 * `updateSnapshots: 'none'`, so a route with no baseline FAILS rather than
 * quietly acquiring one from whatever happened to render — Playwright's
 * default ('missing') would mint it, fail once, then pass on the retry,
 * which in attached mode bakes that day's live content into the theme's
 * committed baselines. Writing requires `--update-snapshots`, which the CLI
 * permits only in sandbox mode.
 *
 * First run: no baselines exist at all — the pass skips with a pointer to
 * `shakedown sandbox --update-snapshots`, so a theme that hasn't adopted the
 * visual pass isn't red for a decision it hasn't made. Once ANY baseline
 * exists the pass is live, and a route missing its own baseline is a real
 * failure: either it is a new route needing a deliberate baseline, or a
 * committed one has gone missing.
 *
 * `<time>` elements are masked: sample content created by WP core install
 * carries the install date.
 */
const matrix = loadMatrix();
const workspace = process.env.SHAKEDOWN_WORKSPACE ?? process.cwd();
const hasBaselines = existsSync(join(workspace, 'tests', '__screenshots__'));

/**
 * Stable, unique snapshot name: kind plus the URL path.
 * Mirrored in lib/trial-reporter.mjs — keep in sync.
 *
 * @param {{kind: string, url: string}} route
 * @returns {string}
 */
function snapshotName(route) {
  const path = new URL(route.url).pathname.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home';
  return `${route.kind.replace(/\W+/g, '-')}--${path}.png`;
}

for (const route of browsableRoutes(matrix)) {
  test(`03 ${route.kind} ${route.url}`, async ({ page }) => {
    // 'none' is the configured default, so this reads as "no baselines at all,
    // and nobody asked us to create any". Passing --update-snapshots overrides
    // it, which is what lets the very first baseline run get past this skip.
    test.skip(!hasBaselines && test.info().config.updateSnapshots === 'none',
      'No visual baselines yet — create them with: shakedown sandbox --update-snapshots');

    await page.goto(route.url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(snapshotName(route), {
      fullPage: true,
      animations: 'disabled',
      mask: [page.locator('time')],
      maxDiffPixelRatio: 0.001,
    });
  });
}
