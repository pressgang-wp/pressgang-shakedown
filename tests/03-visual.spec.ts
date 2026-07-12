import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { loadMatrix } from './matrix';

/**
 * Pass 03 — visual regression.
 *
 * Full-page screenshots of every 200 route against baselines committed in
 * the workspace (`tests/__screenshots__/`, per-platform). Deterministic
 * fixtures (seeded values, pinned dates) are what make these stable —
 * a diff should mean the THEME changed, not the content.
 *
 * First run: no baselines exist yet — the whole pass skips with a pointer
 * to `shakedown sandbox --update-snapshots`, so CI isn't red for the wrong
 * reason. `<time>` elements are masked: sample content created by WP core
 * install carries the install date.
 */
const matrix = loadMatrix();
const workspace = process.env.SHAKEDOWN_WORKSPACE ?? process.cwd();
const hasBaselines = existsSync(join(workspace, 'tests', '__screenshots__'));

/** Stable, unique snapshot name: kind plus the URL path. */
function snapshotName(route: { kind: string; url: string }): string {
  const path = new URL(route.url).pathname.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home';
  return `${route.kind.replace(/\W+/g, '-')}--${path}.png`;
}

for (const route of matrix.routes.filter((r) => r.expect === 200)) {
  test(`03 ${route.kind} ${route.url}`, async ({ page }) => {
    test.skip(!hasBaselines && test.info().config.updateSnapshots === 'missing',
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
