/** Orchestration stays outside Playwright's spec collection: no journeys or snapshot pass. */
import { chromium, request } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveMatrix, capstanDoctor } from './derive.mjs';
import { activeSuppressions, suppressed } from './suppress.mjs';
import { pairedPlan, routePath, classifyRoute, compareEvidence } from './regression-plan.mjs';
import { getEvidence, protectContext, semanticEvidence } from './regression-browser.mjs';
import { availabilityFindings, watchIntegrity, brokenImages, accessibilityFindings } from './health.mjs';
import { writeRegressionReport } from './regression-report.mjs';

async function capture(browser, route, side, viewport, plan, dir, id) {
  const url = route[`${side}Url`], selectedOrigin = new URL(url).origin;
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
    const renderedUrl = new URL(page.url());
    result.browserFinalPath = renderedUrl.pathname + renderedUrl.search;
    if (result.browserFinalPath !== result.finalPath) {
      result.unavailableReason = `Browser navigated after HTTP capture: ${result.finalPath} → ${result.browserFinalPath}`;
    }
    if (side === 'candidate' && route.expect === 200) {
      result.health.push(...await brokenImages(page));
      const a11y = await accessibilityFindings(page, plan.ignore);
      result.health.push(...a11y.filter(f => f.blocking).map(f => f.message));
      result.advisory.push(...a11y.filter(f => !f.blocking).map(f => f.message));
    }
    Object.assign(result, await semanticEvidence(page, plan.options.ignoreSelectors));
    if (/coming soon|under maintenance|just a moment|checking your browser|access denied/i.test(result.title)) {
      result.unavailableReason = `Possible access/maintenance interstitial: ${result.title}`;
    }
    const screenshot = `${id}-${side}.png`;
    await page.screenshot({ path: join(dir, screenshot), fullPage: true, animations: 'disabled', timeout: plan.options.timeout, mask: plan.options.ignoreSelectors.map(s => page.locator(s)) });
    result.screenshot = screenshot;
    result.health.push(...integrity);
  } catch (error) {
    result.error = error.message;
    if (side === 'candidate') result.health.push(`capture incomplete: ${error.message}`);
  } finally {
    await api.dispose();
    await context.close();
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
    run.discovery = { ...run.discovery, source, derived: matrix.routes.length, ignored, supplemented, warnings: matrix.discoveryWarnings, doctor: capstanDoctor(target.sitePath) };
    for (const warning of matrix.discoveryWarnings) console.warn(`⚓ ${warning}`);
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(run.plan, null, 2));
    for (const policy of activeSuppressions(target.ignore)) console.log(`⚓ suppressing ${policy.key}: ${policy.patterns.join(', ')}`);
    console.log(`⚓ regression policies: ${JSON.stringify({ ignoreSelectors: target.regression.ignoreSelectors, accept: target.regression.accept })}`);
    console.log(`⚓ regression: ${run.plan.routes.length} derived routes; report ${join(dir, 'index.html')}`);
    if (!run.plan.routes.some(route => route.source !== 'critical supplement')) throw new Error('No safe derived routes to compare; critical routes cannot replace discovery');
    browser = await chromium.launch();
    // Bounded homepage navigation supplement, never recursive and never a replacement matrix.
    if (target.regression.navigationLimit > 0) {
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
    } else run.discovery.navigation = 'disabled by navigationLimit=0';
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(run.plan, null, 2));
    routeLoop: for (const [index, route] of run.plan.routes.entries()) {
      for (const viewport of target.regression.viewports) {
        if (interrupted) break routeLoop;
        if (route.html === false && viewport !== target.regression.viewports[0]) continue;
        const id = `${index}-${viewport.name}`;
        const reference = await capture(browser, route, 'reference', viewport, run.plan, dir, id);
        const candidate = await capture(browser, route, 'candidate', viewport, run.plan, dir, id);
        const classification = classifyRoute(route, reference, candidate);
        // Different final paths are not comparable content; status/redirect evidence still matters.
        const differences = classification === 'matched'
          ? compareEvidence(reference, candidate, route.path, target.regression.accept)
          : compareEvidence({ status: reference.status, redirects: reference.redirects }, { status: candidate.status, redirects: candidate.redirects }, route.path, target.regression.accept);
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
    run.state = 'incomplete'; run.error = error.message;
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
