import { captureAccessibilityEvidence } from '../lib/accessibility-evidence.mjs';
import { test, expect } from '@playwright/test';
import { browsableRoutes, loadMatrix } from './matrix.mjs';
import { accessibilityFindings } from '../lib/health.mjs';

const matrix = loadMatrix();
for (const route of browsableRoutes(matrix)) {
  test(`02 ${route.kind} ${route.url}`, async ({ page }, testInfo) => {
    await page.goto(route.url, { waitUntil: 'load' });
    const findings = await accessibilityFindings(page, matrix.ignore);
    const evidence = await captureAccessibilityEvidence(page, findings, testInfo.outputPath('accessibility.png'));
    if (evidence.screenshot) await testInfo.attach('accessibility-screenshot', { path: testInfo.outputPath('accessibility.png'), contentType: 'image/png' });
    await testInfo.attach('accessibility-evidence', { body: JSON.stringify(evidence), contentType: 'application/json' });
    for (const finding of findings.filter(f => !f.blocking)) console.log(`advisory a11y (${route.url}): ${finding.message}`);
    expect(findings.filter(f => f.blocking).map(f => f.message), 'serious/critical WCAG 2.1 A/AA violations').toEqual([]);
  });
}
