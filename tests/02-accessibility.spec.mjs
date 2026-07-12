import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loadMatrix } from './matrix.mjs';

/**
 * Pass 02 — accessibility.
 *
 * Runs axe-core against every 200 route, scoped to WCAG 2.1 A/AA rules.
 *
 * Gate policy (per RFC-001: gates start advisory, promoted once stable):
 * `serious` and `critical` violations fail the route; `moderate` and `minor`
 * are reported to the console but do not fail — promote them once the
 * serious/critical set is clean.
 */
const matrix = loadMatrix();

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FAILING_IMPACTS = ['serious', 'critical'];

/**
 * One-line summary of an axe violation for readable failure output.
 *
 * @param {{id: string, impact?: string|null, nodes: unknown[], helpUrl: string}} v
 * @returns {string}
 */
function describeViolation(v) {
  return `[${v.impact}] ${v.id} × ${v.nodes.length} — ${v.helpUrl}`;
}

for (const route of matrix.routes.filter((r) => r.expect === 200)) {
  test(`02 ${route.kind} ${route.url}`, async ({ page }) => {
    await page.goto(route.url, { waitUntil: 'load' });

    // Iframe contents are excluded: violations inside third-party embeds
    // (YouTube player chrome etc.) are not the site's remediation surface.
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .exclude('iframe')
      .analyze();

    const failing = results.violations.filter((v) => FAILING_IMPACTS.includes(v.impact ?? ''));
    const advisory = results.violations.filter((v) => !FAILING_IMPACTS.includes(v.impact ?? ''));

    if (advisory.length > 0) {
      console.log(`advisory a11y (${route.url}):\n  ${advisory.map(describeViolation).join('\n  ')}`);
    }

    expect(
      failing.map(describeViolation),
      `serious/critical WCAG 2.1 A/AA violations on ${route.url}`
    ).toEqual([]);
  });
}
