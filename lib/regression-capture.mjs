/** Capture one side of a planned route, including health and review evidence. */
import { request } from '@playwright/test';
import { join } from 'node:path';
import { collectElements, applyImagePolicy } from './element-evidence.mjs';
import { runScope } from './regression-scope.mjs';
import { getEvidence, protectContext, semanticEvidence, settlePage } from './regression-browser.mjs';
import { availabilityFindings, watchIntegrity, accessibilityFindings } from './health.mjs';
import { capturePageScreenshot, captureAccessibilityEvidence, captureElementEvidence } from './accessibility-evidence.mjs';

export async function capture(browser, route, side, viewport, plan, dir, id) {
  const url = route[`${side}Url`], selectedOrigin = new URL(url).origin;
  const scope = runScope(plan.options);
  const result = { health: [], advisory: [], blocked: [] };
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, ignoreHTTPSErrors: selectedOrigin === plan.options.candidate && new URL(url).hostname.endsWith('.test'), serviceWorkers: 'block', acceptDownloads: false });
  context.setDefaultTimeout(plan.options.timeout);
  const api = await request.newContext({ ignoreHTTPSErrors: selectedOrigin === plan.options.candidate && new URL(url).hostname.endsWith('.test') });
  try {
    const http = await getEvidence(api, url, { timeout: plan.options.timeout });
    Object.assign(result, { status: http.status, redirects: http.redirects, finalPath: http.finalPath });
    if (side === 'candidate') {
      const observed = route.expect === 404 && http.redirects.length ? { ...http, status: http.redirects[0].status } : http;
      result.health.push(...availabilityFindings({ ...route, url }, observed, http.body, plan.ignore));
    }
    if (route.html === false || !/text\/html/i.test(http.headers['content-type'] ?? '')) return result;
    await protectContext(context, selectedOrigin, result.blocked, plan.options.timeout);
    const page = await context.newPage();
    const integrity = side === 'candidate' && route.expect === 200 ? watchIntegrity(page, url, plan.ignore) : [];
    await page.goto(http.finalUrl, { waitUntil: 'load', timeout: plan.options.timeout });
    // Fonts settle when available; endless third-party traffic cannot hold the run open.
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1500))]));
    result.lazyLoading = await settlePage(page);
    if (!result.lazyLoading.reachedBottom || result.lazyLoading.pendingImages.length) {
      result.advisory.push('Lazy-loading capture incomplete; see scroll limit and pending images.');
    }
    const renderedUrl = new URL(page.url());
    result.browserFinalPath = renderedUrl.pathname + renderedUrl.search;
    if (result.browserFinalPath !== result.finalPath) {
      result.unavailableReason = `Browser navigated after HTTP capture: ${result.finalPath} → ${result.browserFinalPath}`;
    }
    if (side === 'candidate' && route.expect === 200) {
      const allA11y = scope.accessibility ? await accessibilityFindings(page, plan.ignore) : [];
      const a11y = scope.level === 'core' ? allA11y.filter(f => f.blocking) : allA11y;
      if (allA11y.length !== a11y.length) result.advisory.push(`${allA11y.length - a11y.length} accessibility rule finding(s) outside the core level; use --level=full to review them.`);
      if (scope.accessibility) result.accessibility = await captureAccessibilityEvidence(page, a11y, join(dir, `${id}-accessibility.png`), { timeout: plan.options.timeout, mask: plan.options.ignoreSelectors.map(s => page.locator(s)) });
      result.health.push(...a11y.filter(f => f.blocking).map(f => f.message));
      result.advisory.push(...a11y.filter(f => !f.blocking).map(f => f.message));
    }
    const elements = await collectElements(page, plan.options.ignoreSelectors, scope.level, result.lazyLoading.reachedBottom);
    const issues = side === 'candidate' && route.expect === 200 ? applyImagePolicy(elements.issues, plan.ignore) : [];
    result.imageIssues = issues;
    result.overflow = elements.overflow;
    result.health.push(...issues.filter(f => f.blocking && !f.suppressed).map(f => f.message));
    result.advisory.push(...issues.filter(f => !f.blocking && !f.suppressed).map(f => f.message));
    result.elements = await captureElementEvidence(page, [...elements.findings, ...issues], join(dir, `${id}-${side}-elements.png`), { timeout: plan.options.timeout, mask: plan.options.ignoreSelectors.map(s => page.locator(s)) });
    if (result.elements.captureError) result.advisory.push(result.elements.captureError);
    result.title = await page.title();
    if (scope.comparison) Object.assign(result, await semanticEvidence(page, plan.options.ignoreSelectors, scope.level));
    if (/coming soon|under maintenance|just a moment|checking your browser|access denied/i.test(result.title)) {
      result.unavailableReason = `Possible access/maintenance interstitial: ${result.title}`;
    }
    if (scope.screenshots) {
      const screenshot = result.elements.screenshot ?? `${id}-${side}.png`;
      if (!result.elements.screenshot) await capturePageScreenshot(page, { path: join(dir, screenshot), animations: 'disabled', timeout: plan.options.timeout, mask: plan.options.ignoreSelectors.map(s => page.locator(s)) });
      result.screenshot = screenshot;
    }
    result.health.push(...integrity);
  } catch (error) {
    result.error = error.message.split('\n')[0];
    if (side === 'candidate') result.health.push(`capture incomplete: ${result.error}`);
  } finally {
    await api.dispose().catch(() => {});
    await context.close().catch(() => {});
  }
  return result;
}

