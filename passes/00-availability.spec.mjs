import { test, expect } from '@playwright/test';
import { loadMatrix, controllerHeaderName, ERROR_SIGNATURES } from './matrix.mjs';
import { ignoresFor, suppressed } from '../lib/suppress.mjs';

/**
 * Pass 00 — availability.
 *
 * Every derived route must return its intended status with a body free of
 * PHP/Twig error signatures and carrying a <title>. HTTP-only (no browser),
 * so this pass sweeps the whole site in seconds. Where the observer answers
 * (sandbox), each route is also checked against the Capstan oracle and for
 * silent PHP notices.
 */
const matrix = loadMatrix();

/** Redirect statuses that count as "handled" for the unknown-URL probe. */
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/**
 * Sandbox runs always install the observer, so its headers must be present.
 * Attached runs never do, so the oracle and PHP-issue checks stay optional there.
 */
const expectsObserver = matrix.target === 'sandbox';
const ignoredSignatures = ignoresFor(matrix, 'errorSignatures');

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
    //
    // The signature scan is a blunt instrument by design — a page whose CONTENT
    // legitimately reads "Warning: " trips it. `ignore.errorSignatures` matches
    // "<signature> on <url>", so a pattern can name the page (the usual case:
    // one article about warnings), the signature, or both.
    const found = ERROR_SIGNATURES.filter(
      (sig) => body.includes(sig) && !suppressed(ignoredSignatures, `${sig} on ${route.url}`)
    );
    expect(found, `PHP/Twig error signatures in ${route.url} (suppress via ignore.errorSignatures)`).toEqual([]);

    if (route.expect === 200) {
      expect(body, `missing <title> on ${route.url}`).toMatch(/<title>[^<]+<\/title>/i);
    }

    // Oracle assertions — active when the observer answered (sandbox) and
    // the matrix carries capstan --resolve expectations for this route.
    const headers = res.headers();

    // Every check below is guarded on its header existing, so an observer that
    // stops answering turns them all into no-ops that report success — which is
    // exactly what happened for as long as its headers were being dropped. In a
    // sandbox the observer is always installed, so its silence is a failure.
    if (expectsObserver) {
      expect(
        headers['x-shakedown-php-issues'],
        `observer did not answer on ${route.url} — the oracle and PHP-issue checks below cannot run`
      ).toBeDefined();
    }

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
    // The count already excludes anything matched by ignore.phpIssues, and the
    // sampled signatures are quoted verbatim so one can be pasted straight into
    // that list (they carry the path relative to the install root).
    if (headers['x-shakedown-php-issues'] !== undefined) {
      const sample = decodeURIComponent(headers['x-shakedown-php-sample'] ?? '');
      expect(
        Number(headers['x-shakedown-php-issues']),
        `PHP notices/warnings on ${route.url} (suppress via ignore.phpIssues): ${sample}`
      ).toBe(0);
    }
  });
}
