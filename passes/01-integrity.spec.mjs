import { test, expect } from '@playwright/test';
import { browsableRoutes } from '../lib/matrix.mjs';
import { loadMatrix } from '../lib/matrix-store.mjs';
import { watchIntegrity, brokenImages } from '../lib/health.mjs';

const matrix = loadMatrix();
for (const route of browsableRoutes(matrix)) {
  test(`01 ${route.kind} ${route.url}`, async ({ page }) => {
    const findings = watchIntegrity(page, matrix.baseUrl, matrix.ignore);
    await page.goto(route.url, { waitUntil: 'load' });
    findings.push(...await brokenImages(page));
    expect(findings, 'browser integrity').toEqual([]);
  });
}
