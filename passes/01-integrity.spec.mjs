import { test, expect } from '@playwright/test';
import { browsableRoutes, loadMatrix } from './matrix.mjs';
import { ignoresFor, suppressed } from '../lib/suppress.mjs';

/**
 * Pass 01 — integrity.
 *
 * Renders each 200 route in a real browser and asserts a clean runtime:
 * no JS exceptions, no console errors, no failed same-origin requests,
 * and no broken images. Third-party request failures are ignored — the
 * site under trial is the subject, not its CDNs.
 *
 * That carve-out used to stop at requests, which left the console asymmetric:
 * a third-party script's own noise (tag managers, pixels, cookie banners,
 * extensions blocking beacons) failed the route even though its network
 * failures were forgiven. `ignore.consoleErrors` and `ignore.requests` close
 * that gap — see lib/suppress.mjs.
 */
const matrix = loadMatrix();
const origin = new URL(matrix.baseUrl).origin;
const ignoredConsole = ignoresFor(matrix, 'consoleErrors');
const ignoredRequests = ignoresFor(matrix, 'requests');

for (const route of browsableRoutes(matrix)) {
  test(`01 ${route.kind} ${route.url}`, async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    const failedRequests = [];

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !suppressed(ignoredConsole, msg.text())) {
        consoleErrors.push(msg.text());
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().startsWith(origin) && !suppressed(ignoredRequests, res.url())) {
        failedRequests.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto(route.url, { waitUntil: 'load' });

    // Lazy images below the fold never load in this pass, so only eagerly
    // loaded, "complete" images with zero natural width count as broken.
    const brokenImages = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((img) => img.loading !== 'lazy' && img.complete && img.naturalWidth === 0 && !!img.src)
        .map((img) => img.currentSrc || img.src)
    );

    expect(pageErrors, 'JS exceptions').toEqual([]);
    expect(consoleErrors, 'console errors').toEqual([]);
    expect(failedRequests, 'failed same-origin requests').toEqual([]);
    expect(brokenImages, 'broken images').toEqual([]);
  });
}
