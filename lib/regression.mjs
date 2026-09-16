/** Orchestration stays outside Playwright's spec collection: no journeys or snapshot pass. */
import { runScope } from './regression-scope.mjs';
import { chromium, request } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveMatrix, capstanDoctor } from './derive.mjs';
import { activeSuppressions, suppressed } from './suppress.mjs';
import { pairedPlan, routePath, classifyRoute, compareEvidence } from './regression-plan.mjs';
import { getEvidence, protectContext, semanticEvidence, settlePage } from './regression-browser.mjs';
import { availabilityFindings, watchIntegrity, brokenImages, accessibilityFindings } from './health.mjs';
import { captureAccessibilityEvidence } from './accessibility-evidence.mjs';
import { writeRegressionReport } from './regression-report.mjs';

async function capture(browser, route, side, viewport, plan, dir, id) {
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
      result.health.push(...await brokenImages(page, { includeLazy: result.lazyLoading.reachedBottom }));
      const allA11y = scope.accessibility ? await accessibilityFindings(page, plan.ignore) : [];
      const a11y = scope.level === 'core' ? allA11y.filter(f => f.blocking) : allA11y;
      if (allA11y.length !== a11y.length) result.advisory.push(`${allA11y.length - a11y.length} accessibility rule finding(s) outside the core level; use --level=full to review them.`);
      if (scope.accessibility) result.accessibility = await captureAccessibilityEvidence(page, a11y, join(dir, `${id}-accessibility.png`), { timeout: plan.options.timeout, mask: plan.options.ignoreSelectors.map(s => page.locator(s)) });
      result.health.push(...a11y.filter(f => f.blocking).map(f => f.message));
      result.advisory.push(...a11y.filter(f => !f.blocking).map(f => f.message));
    }
    result.title = await page.title();
    if (scope.comparison) Object.assign(result, await semanticEvidence(page, plan.options.ignoreSelectors, scope.level));
    if (/coming soon|under maintenance|just a moment|checking your browser|access denied/i.test(result.title)) {
      result.unavailableReason = `Possible access/maintenance interstitial: ${result.title}`;
    }
    if (scope.screenshots) {
      const screenshot = `${id}-${side}.png`;
      await page.screenshot({ path: join(dir, screenshot), fullPage: true, animations: 'disabled', timeout: plan.options.timeout, mask: plan.options.ignoreSelectors.map(s => page.locator(s)) });
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

export async function runRegression(target, workspace) {
  const root = join(workspace, '.shakedown', 'regression');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'run-'));
  const run = { started: new Date().toISOString(), state: 'running', results: [], discovery: { navigation: 'pending', acf: 'No field-to-DOM assertions: ACF locations alone do not prove rendered content.' } };
  writeRegressionReport(dir, run);
  let browser;
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
    run.error = 'Run interrupted; remaining routes were not checked.';
    browser?.close().catch(() => {});
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    // Discovery artifacts stay inside this run; ordinary attached/sandbox matrix is untouched.
    const { matrix, source, ignored, supplemented } = deriveMatrix(target, dir);
    run.plan = pairedPlan(matrix, target.regression, source);
    const scope = runScope(target.regression);
    run.scope = { ...scope, viewports: target.regression.viewports };
    console.log(`⚓ level: ${scope.level}; viewports: ${target.regression.viewports.map(v => v.name).join(', ')}; skipped: ${scope.skipped.join('; ') || 'none'}`);
    run.discovery = { ...run.discovery, source, derived: matrix.routes.length, ignored, supplemented, warnings: matrix.discoveryWarnings, doctor: capstanDoctor(target.sitePath) };
    for (const warning of matrix.discoveryWarnings) console.warn(`⚓ ${warning}`);
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(run.plan, null, 2));
    for (const policy of activeSuppressions(target.ignore)) console.log(`⚓ suppressing ${policy.key}: ${policy.patterns.join(', ')}`);
    console.log(`⚓ regression policies: ${JSON.stringify({ ignoreSelectors: target.regression.ignoreSelectors, accept: target.regression.accept })}`);
    console.log(`⚓ regression: ${run.plan.routes.length} derived routes; report ${join(dir, 'index.html')}`);
    if (!run.plan.routes.some(route => route.source !== 'critical supplement')) throw new Error('No safe derived routes to compare; critical routes cannot replace discovery');
    // This runner owns signal cleanup and its incomplete report. Playwright's
    // default SIGINT handler exits the process before that report can finish.
    browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false });
    // Bounded homepage navigation supplement, never recursive and never a replacement matrix.
    if (scope.comparison && target.regression.navigationLimit > 0) {
      const home = { path: '/', referenceUrl: target.regression.reference + '/', candidateUrl: target.regression.candidate + '/', expect: 200 };
      const ref = await capture(browser, home, 'reference', target.regression.viewports[0], run.plan, dir, 'navigation');
      run.discovery.navigation = ref.error ?? 'homepage navigation only; not an exhaustive reference inventory';
      const known = new Set(run.plan.routes.map(r => r.path));
      let added = 0;
      for (const url of ref.navigation ?? []) {
        try {
          const path = routePath(url, target.regression.reference);
          const candidateUrl = target.regression.candidate + path;
          if (known.has(path) || suppressed(target.ignore.routes, url) || suppressed(target.ignore.routes, candidateUrl)) continue;
          if (added >= target.regression.navigationLimit) { run.discovery.navigationTruncated = true; break; }
          run.plan.routes.push({ path, url, referenceUrl: url, candidateUrl, expect: 200, kind: 'reference-navigation', source: 'reference homepage navigation' });
          known.add(path); added++;
        } catch { /* external/action links are not navigable route evidence */ }
      }
      run.discovery.navigationAdded = added;
    } else run.discovery.navigation = scope.comparison ? 'disabled by navigationLimit=0' : 'not run at errors level';
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(run.plan, null, 2));
    routeLoop: for (const [index, route] of run.plan.routes.entries()) {
      for (const viewport of target.regression.viewports) {
        if (interrupted) break routeLoop;
        if (route.html === false && viewport !== target.regression.viewports[0]) continue;
        const id = `${index}-${viewport.name}`;
        const reference = scope.comparison ? await capture(browser, route, 'reference', viewport, run.plan, dir, id) : { skipped: 'errors level: candidate only', health: [], advisory: [], blocked: [] };
        if (interrupted) break routeLoop;
        const candidate = await capture(browser, route, 'candidate', viewport, run.plan, dir, id);
        if (interrupted) break routeLoop;
        const classification = scope.comparison ? classifyRoute(route, reference, candidate) : candidate.error || candidate.unavailableReason ? 'inconclusive' : 'candidate-checked';
        // Different final paths are not comparable content; status/redirect evidence still matters.
        const differences = !scope.comparison ? [] : classification === 'matched'
          ? compareEvidence(reference, candidate, route.path, target.regression.accept, scope.level)
          : compareEvidence({ status: reference.status, redirects: reference.redirects }, { status: candidate.status, redirects: candidate.redirects }, route.path, target.regression.accept, scope.level);
        run.results.push({ ...route, viewport: viewport.name, classification, reference, candidate, health: candidate.health, differences });
        writeRegressionReport(dir, run);
        console.log(`  ${index + 1}/${run.plan.routes.length} ${viewport.name} ${route.path}: ${classification}, ${candidate.health.length} health failures`);
        if (reference.unavailableReason || candidate.unavailableReason) {
          run.error = reference.unavailableReason ?? candidate.unavailableReason;
          run.discovery.stoppedEarly = 'Capture cannot reliably represent requested content; remaining routes not visited.';
          break routeLoop;
        }
      }
    }
    run.state = run.discovery.stoppedEarly || interrupted ? 'incomplete' : 'complete';
  } catch (error) {
    run.state = 'incomplete';
    if (!interrupted) run.error = error.message.split('\n')[0];
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (browser) await browser.close().catch(() => {});
    const summary = writeRegressionReport(dir, run);
    console.log(`⚓ Regression report: ${join(dir, 'index.html')}`);
    run.exitCode = run.state !== 'complete' || !summary.routes || summary.inconclusive > 0 ? 2 : summary.healthFailures > 0 ? 1 : 0;
    writeRegressionReport(dir, run);
  }
  return { ...run, dir };
}
