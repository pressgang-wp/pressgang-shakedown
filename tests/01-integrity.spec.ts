import { test, expect } from '@playwright/test';
import { loadMatrix } from './matrix';

/**
 * Pass 01 — integrity: render each 200 route in a real browser and assert
 * no JS exceptions, no console errors, no failed same-origin requests,
 * and no broken images.
 */
const matrix = loadMatrix();
const origin = new URL(matrix.baseUrl).origin;

for (const route of matrix.routes.filter((r) => r.expect === 200)) {
  test(`01 ${route.kind} ${route.url}`, async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().startsWith(origin)) {
        failedRequests.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto(route.url, { waitUntil: 'load' });

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
