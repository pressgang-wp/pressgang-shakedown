import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { routePath } from './regression-plan.mjs';
import { suppressed } from './suppress.mjs';

export function inventoryRoutes(target) {
  const output = execFileSync('wp', ['eval-file', fileURLToPath(new URL('../bin/route-inventory.php', import.meta.url)), `--path=${target.sitePath}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const inventory = JSON.parse(output.slice(output.indexOf('{')));
  if (!Array.isArray(inventory.routes)) throw new Error('Inventory returned no routes');
  return inventory;
}

export function addCoverage(plan, inventory, mode = 'sampled') {
  const known = new Set(plan.routes.map(r => r.path));
  const eligible = [], excluded = [...(inventory.excluded ?? [])], seen = new Set();
  for (const route of inventory.routes) {
    try {
      const path = routePath(route.url, plan.options.discovery);
      if (seen.has(path)) continue;
      seen.add(path);
      const referenceUrl = plan.options.reference + path, candidateUrl = plan.options.candidate + path;
      if ([route.url, referenceUrl, candidateUrl].some(url => suppressed(plan.ignore.routes, url))) {
        excluded.push({ ...route, reason: 'ignore.routes' }); continue;
      }
      eligible.push({ path, kind: route.kind });
      if (mode === 'exhaustive' && !known.has(path)) {
        plan.routes.push({ ...route, path, referenceUrl, candidateUrl, source: 'public content inventory (no template oracle)' });
        known.add(path);
      }
    } catch (error) { excluded.push({ ...route, reason: error.message }); }
  }
  return {
    mode, state: 'complete', eligible, excluded,
    notSelected: eligible.filter(r => !known.has(r.path)),
    scope: 'Published public singles/pages and public terms (including empty terms). Archive, author/date, feed and pagination samples and search probes remain as derived; arbitrary query combinations and component interactions are not exhaustively tested.',
  };
}

export function coverageSummary(run) {
  const planned = run.plan?.routes ?? [];
  const viewports = run.plan?.options.viewports ?? [];
  const observed = new Set(run.results.map(r => JSON.stringify([r.path, r.viewport])));
  const notVisited = planned.flatMap(r => (r.html === false ? viewports.slice(0, 1) : viewports)
    .filter(v => !observed.has(JSON.stringify([r.path, v.name])))
    .map(v => ({ path: r.path, viewport: v.name, reason: run.state === 'running' ? 'Pending' : 'Not visited' })));
  const selected = new Set(planned.map(r => r.path));
  const notSelected = (run.coverage?.eligible ?? []).filter(r => !selected.has(r.path));
  return { ...run.coverage, notSelected, selectedRoutes: planned.length, checkedObservations: run.results.length, notVisited };
}
