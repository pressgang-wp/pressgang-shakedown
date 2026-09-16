import { test, expect } from '@playwright/test';
import { browsableRoutes, loadMatrix } from './matrix.mjs';
import { accessibilityFindings } from '../lib/health.mjs';

const matrix = loadMatrix();
for (const route of browsableRoutes(matrix)) {
  test(`02 ${route.kind} ${route.url}`, async ({ page }) => {
    await page.goto(route.url, { waitUntil: 'load' });
    const findings = await accessibilityFindings(page, matrix.ignore);
    for (const finding of findings.filter(f => !f.blocking)) console.log(`advisory a11y (${route.url}): ${finding.message}`);
    expect(findings.filter(f => f.blocking).map(f => f.message), 'serious/critical WCAG 2.1 A/AA violations').toEqual([]);
  });
}
