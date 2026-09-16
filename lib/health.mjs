/** Shared candidate correctness checks used by the derived passes and regression. */
import AxeBuilder from '@axe-core/playwright';
import { ERROR_SIGNATURES, controllerHeaderName } from '../passes/matrix.mjs';
import { suppressed } from './suppress.mjs';

export function availabilityFindings(route, response, body, ignore = {}, observerRequired = false) {
  const failures = [];
  const status = response.status;
  if (route.expect === 404) {
    if (![301, 302, 303, 307, 308, 404].includes(status)) failures.push(`unknown URL should 404 or redirect away, got ${status}`);
    return failures;
  }
  if (status !== route.expect) failures.push(`expected HTTP ${route.expect}, got ${status}`);
  for (const signature of ERROR_SIGNATURES) {
    if (body.includes(signature) && !suppressed(ignore.errorSignatures, `${signature} on ${route.url}`)) failures.push(`PHP/Twig: ${signature}`);
  }
  if (route.expect === 200 && route.html !== false && !/<title>[^<]+<\/title>/i.test(body)) failures.push('missing <title>');
  const headers = response.headers ?? {};
  if (observerRequired && headers['x-shakedown-php-issues'] === undefined) failures.push('observer did not answer');
  if (route.template && headers['x-shakedown-template'] && route.template !== headers['x-shakedown-template']) failures.push(`template oracle: expected ${route.template}, got ${headers['x-shakedown-template']}`);
  if (route.controller && headers['x-shakedown-controller'] && controllerHeaderName(route.controller) !== headers['x-shakedown-controller']) failures.push(`controller oracle: expected ${controllerHeaderName(route.controller)}, got ${headers['x-shakedown-controller']}`);
  if (headers['x-shakedown-php-issues'] !== undefined && Number(headers['x-shakedown-php-issues']) !== 0) failures.push(`PHP issues: ${headers['x-shakedown-php-issues']} ${headers['x-shakedown-php-sample'] ?? ''}`);
  return failures;
}
export function watchIntegrity(page, baseUrl, ignore = {}) {
  const findings = [];
  const own = url => new URL(url).origin === new URL(baseUrl).origin;
  page.on('pageerror', error => findings.push(`JS exception: ${error.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error' && !suppressed(ignore.consoleErrors, msg.text())) findings.push(`console: ${msg.text()}`);
  });
  page.on('response', res => {
    if (res.status() >= 400 && own(res.url()) && !suppressed(ignore.requests, res.url())) findings.push(`request: ${res.status()} ${res.url()}`);
  });
  page.on('requestfailed', req => {
    if (own(req.url()) && !suppressed(ignore.requests, req.url())) findings.push(`request: ${req.failure()?.errorText} ${req.url()}`);
  });
  return findings;
}
export async function brokenImages(page) {
  return page.evaluate(() => Array.from(document.images)
    .filter(img => img.loading !== 'lazy' && img.complete && img.naturalWidth === 0 && !!img.src)
    .map(img => `broken image: ${img.currentSrc || img.src}`));
}
export async function accessibilityFindings(page, ignore = {}) {
  const axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe');
  if (ignore.a11yRules?.length) axe.disableRules(ignore.a11yRules);
  const { violations } = await axe.analyze();
  return violations.map(v => ({ blocking: ['serious', 'critical'].includes(v.impact), message: `[${v.impact}] ${v.id} × ${v.nodes.length} — ${v.helpUrl}` }));
}
