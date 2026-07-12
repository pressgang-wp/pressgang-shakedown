import { test, expect } from '@playwright/test';
import { loadMatrix, controllerHeaderName, ERROR_SIGNATURES } from './matrix';

/**
 * Pass 00 — availability.
 *
 * Every derived route must return its intended status with a body free of
 * PHP/Twig error signatures and carrying a <title>. HTTP-only (no browser),
 * so this pass sweeps the whole site in seconds.
 */
const matrix = loadMatrix();

/** Redirect statuses that count as "handled" for the unknown-URL probe. */
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

for (const route of matrix.routes) {
  test(`00 ${route.kind} ${route.url}`, async ({ request }) => {
    if (route.expect === 404) {
      // Unknown URLs must not render a page: a 404, or a redirect away
      // (e.g. the Redirection plugin's catch-all), both count as handled.
      const res = await request.get(route.url, { maxRedirects: 0 });
      expect(
        [...REDIRECT_STATUSES, 404],
        `unknown URL should 404 or redirect away, got ${res.status()}`
      ).toContain(res.status());
      return;
    }

    const res = await request.get(route.url, { maxRedirects: 5 });
    expect(res.status(), `status for ${route.url}`).toBe(route.expect);

    const body = await res.text();

    // Collect-then-assert so a failure names the signatures found instead of
    // dumping the page body into the report.
    const found = ERROR_SIGNATURES.filter((sig) => body.includes(sig));
    expect(found, `PHP/Twig error signatures in ${route.url}`).toEqual([]);

    if (route.expect === 200) {
      expect(body, `missing <title> on ${route.url}`).toMatch(/<title>[^<]+<\/title>/i);
    }

    // Oracle assertions — active when the observer answered (sandbox) and
    // the matrix carries capstan --resolve expectations for this route.
    const headers = res.headers();

    if (route.template && headers['x-shakedown-template']) {
      expect(headers['x-shakedown-template'], `template oracle for ${route.url}`).toBe(route.template);
    }

    if (route.controller && headers['x-shakedown-controller']) {
      expect(headers['x-shakedown-controller'], `controller oracle for ${route.url}`).toBe(
        controllerHeaderName(route.controller)
      );
    }

    // PHP issues are counted by the observer even when display/log are off —
    // a page can look perfect and still be raising notices on every request.
    if (headers['x-shakedown-php-issues'] !== undefined) {
      const sample = decodeURIComponent(headers['x-shakedown-php-sample'] ?? '');
      expect(Number(headers['x-shakedown-php-issues']), `PHP notices/warnings on ${route.url}: ${sample}`).toBe(0);
    }
  });
}
