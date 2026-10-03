/** Regression session and browser execution, independent of local CMS discovery. */
import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeSuppressions, suppressed } from './suppress.mjs';
import { runScope } from './regression-scope.mjs';
import { routePath, classifyRoute, compareEvidence, focusRoutes } from './regression-plan.mjs';
import { compareScreenshots } from './screenshot-diff.mjs';
import { capture } from './regression-capture.mjs';
import { writeRegressionReport } from './regression-report.mjs';

/**
 * Execute a prepared plan. The bounded reference-navigation supplement remains
 * here because it is browser evidence, and focused selection follows it so a
 * reference-only navigation route can still be selected.
 * The supplied run contains plan, scope, coverage, discovery and results. The
 * session owns the browser and final report; this stage appends observations.
 */
async function executeRegression(browser, run, dir, isInterrupted) {
  const { plan, scope } = run;
  const options = plan.options;
  // Bounded homepage navigation supplement, never recursive and never a replacement matrix.
  if (scope.comparison && options.navigationLimit > 0) {
    const home = { path: '/', referenceUrl: options.reference + '/', candidateUrl: options.candidate + '/', expect: 200 };
    const ref = await capture(browser, home, 'reference', options.viewports[0], plan, dir, 'navigation');
    run.discovery.navigation = ref.error ?? 'homepage navigation only; not an exhaustive reference inventory';
    const known = new Set(plan.routes.map(r => r.path));
    let added = 0;
    for (const url of ref.navigation ?? []) {
      try {
        const path = routePath(url, options.reference);
        const candidateUrl = options.candidate + path;
        if (known.has(path) || suppressed(plan.ignore.routes, url) || suppressed(plan.ignore.routes, candidateUrl)) continue;
        if (added >= options.navigationLimit) { run.discovery.navigationTruncated = true; break; }
        plan.routes.push({ path, url, referenceUrl: url, candidateUrl, expect: 200, kind: 'reference-navigation', source: 'reference homepage navigation' });
        known.add(path); added++;
      } catch { /* external/action links are not navigable route evidence */ }
    }
    run.discovery.navigationAdded = added;
  } else run.discovery.navigation = scope.comparison ? 'disabled by navigationLimit=0' : 'not run at errors level';
  focusRoutes(plan, run.coverage);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
  routeLoop: for (const [index, route] of plan.routes.entries()) {
    for (const viewport of options.viewports) {
      if (isInterrupted()) break routeLoop;
      if (route.html === false && viewport !== options.viewports[0]) continue;
      const id = `${index}-${viewport.name}`;
      const reference = scope.comparison ? await capture(browser, route, 'reference', viewport, plan, dir, id) : { skipped: 'errors level: candidate only', health: [], advisory: [], blocked: [] };
      if (isInterrupted()) break routeLoop;
      const candidate = await capture(browser, route, 'candidate', viewport, plan, dir, id);
      if (isInterrupted()) break routeLoop;
      const classification = scope.comparison ? classifyRoute(route, reference, candidate) : candidate.error || candidate.unavailableReason ? 'inconclusive' : 'candidate-checked';
      // Different final paths are not comparable content; status/redirect evidence still matters.
      const differences = !scope.comparison ? [] : classification === 'matched'
        ? compareEvidence(reference, candidate, route.path, options.accept, scope.level)
        : compareEvidence({ status: reference.status, redirects: reference.redirects }, { status: candidate.status, redirects: candidate.redirects }, route.path, options.accept, scope.level);
      const visual = scope.screenshots && classification === 'matched' ? await compareScreenshots(browser, dir, reference.screenshot, candidate.screenshot, `${id}-diff.png`) : undefined;
      run.results.push({ ...route, viewport: viewport.name, classification, reference, candidate, health: candidate.health, differences, visual });
      writeRegressionReport(dir, run);
      console.log(`  ${index + 1}/${plan.routes.length} ${viewport.name} ${route.path}: ${classification}, ${candidate.health.length} health failures`);
      if (reference.unavailableReason || candidate.unavailableReason) {
        run.error = reference.unavailableReason ?? candidate.unavailableReason;
        run.discovery.stoppedEarly = 'Capture cannot reliably represent requested content; remaining routes not visited.';
        break routeLoop;
      }
    }
  }
  run.state = run.discovery.stoppedEarly || isInterrupted() ? 'incomplete' : 'complete';
}

/**
 * Own artifacts and cleanup from before discovery until the final report.
 * prepare(run, dir) supplies plan, coverage and discovery, and may be async.
 * It fills the run incrementally so preparation errors retain partial evidence.
 * This session derives execution scope from the plan and owns its persistence.
 */
export async function runRegressionSession(workspace, { prepare, discovery = {} }) {
  const root = join(workspace, '.shakedown', 'regression');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'run-'));
  const run = { started: new Date().toISOString(), state: 'running', results: [], discovery: { navigation: 'pending', ...discovery } };
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
    await prepare(run, dir);
    if (interrupted) throw new Error(run.error);
    const { plan } = run;
    const options = plan.options;
    const scope = runScope(options);
    run.scope = { ...scope, viewports: options.viewports };
    console.log(`⚓ level: ${scope.level}; viewports: ${options.viewports.map(v => v.name).join(', ')}; skipped: ${scope.skipped.join('; ') || 'none'}`);
    for (const warning of run.discovery.warnings ?? []) console.warn(`⚓ ${warning}`);
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
    for (const policy of activeSuppressions(plan.ignore)) console.log(`⚓ suppressing ${policy.key}: ${policy.patterns.join(', ')}`);
    console.log(`⚓ regression policies: ${JSON.stringify({ ignoreSelectors: options.ignoreSelectors, accept: options.accept })}`);
    console.log(`⚓ regression: ${plan.routes.length} derived routes; report ${join(dir, 'index.html')}`);
    if (!run.plan.routes.some(route => route.source !== 'critical supplement')) throw new Error('No safe derived routes to compare; critical routes cannot replace discovery');
    // This runner owns signal cleanup and its incomplete report. Playwright's
    // default SIGINT handler exits the process before that report can finish.
    browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false });
    if (interrupted) throw new Error(run.error);
    await executeRegression(browser, run, dir, () => interrupted);
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
