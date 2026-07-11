import { test, expect } from '@playwright/test';
import { loadMatrix, ERROR_SIGNATURES } from './matrix';

/**
 * Pass 00 — availability: every derived route returns its intended status
 * and the body carries no PHP/Twig error signatures. HTTP-only (no browser).
 */
const matrix = loadMatrix();

for (const route of matrix.routes) {
  test(`00 ${route.kind} ${route.url}`, async ({ request }) => {
    if (route.expect === 404) {
      // Unknown URLs must not render a page: a 404, or a redirect away
      // (e.g. the Redirection plugin's catch-all), both count as handled.
      const res = await request.get(route.url, { maxRedirects: 0 });
      expect([301, 302, 308, 404], `status for ${route.url}`).toContain(res.status());
      return;
    }
    const res = await request.get(route.url, { maxRedirects: 5 });
    expect(res.status(), `status for ${route.url}`).toBe(route.expect);

    const body = await res.text();
    for (const sig of ERROR_SIGNATURES) {
      expect(body, `"${sig}" found in ${route.url}`).not.toContain(sig);
    }
    if (route.expect === 200) {
      expect(body, `missing <title> on ${route.url}`).toMatch(/<title>[^<]+<\/title>/i);
    }
  });
}
