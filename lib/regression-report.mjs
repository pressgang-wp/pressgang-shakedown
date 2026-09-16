import { runScope, levels, reviewGroups, reviewLabels, observationVerdict } from './regression-scope.mjs';
import { accessibilityStyles, renderAccessibilityEvidence } from './accessibility-report.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function reportSummary(run) {
  return {
    routes: run.results.length,
    verdicts: Object.fromEntries(['passed', 'failed', 'review', 'incomplete'].map(kind => [kind, run.results.filter(r => observationVerdict(r).kind === kind).length])),
    review: Object.fromEntries(Object.keys(reviewLabels).map(key => [key, run.results.filter(r => reviewGroups(r).includes(key)).length])),
    healthFailures: run.results.filter(r => r.health.length).length,
    differences: run.results.reduce((n, r) => n + r.differences.filter(d => !d.suppressed).length, 0),
    accepted: run.results.reduce((n, r) => n + r.differences.filter(d => d.suppressed).length, 0),
    inconclusive: run.results.filter(r => ['inconclusive', 'unmatched'].includes(r.classification)).length,
    additions: run.results.filter(r => r.classification === 'candidate-only').length,
    removals: run.results.filter(r => r.classification === 'reference-only').length,
  };
}
export function writeRegressionReport(dir, run) {
  const summary = reportSummary(run);
  const scope = run.scope ?? runScope(run.plan?.options);
  const badge = result => {
    const verdict = observationVerdict(result);
    return `<span class="verdict verdict-${verdict.kind}" title="${escape(verdict.detail)}">${verdict.label}</span>`;
  };
  const json = value => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shakedown Regression Report</title>
<style>body{font:16px/1.5 system-ui;margin:32px auto;padding:0 24px;max-width:1400px;color:#17233a;background:#f5f7fa}article{background:white;padding:24px;margin:24px 0;border:1px solid #ccd3df;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pair img{width:100%;height:440px;object-fit:contain;object-position:top;border:1px solid #ccd3df}h2{overflow-wrap:anywhere}.bad{color:#a12626}summary{cursor:pointer}figure{margin:0}a{color:#175ac0}.review-controls{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.review-controls select{font:inherit;padding:8px;max-width:100%}.verdict{display:inline-block;font-size:16px;font-weight:700;padding:5px 12px;border-radius:5px;vertical-align:middle}.verdict-passed{color:#17613a;background:#e5f4eb}.verdict-failed{color:#942222;background:#fde8e8}.verdict-review{color:#775000;background:#fff2cc}.verdict-incomplete{color:#374151;background:#e5e7eb}.route-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}[hidden]{display:none!important}${accessibilityStyles}</style>
<h1>Shakedown Regression Report</h1><p>${escape(run.started)} · ${escape(run.state)}</p>
<p>Reference${scope.comparison ? '' : ' (not observed at errors level)'}: ${escape(run.plan?.options.reference)}<br>Candidate: ${escape(run.plan?.options.candidate)}</p>
<p><strong>Level: ${escape(scope.level)}</strong> — ${escape(scope.description)}<br>Viewports: ${escape((run.plan?.options.viewports ?? []).map(v => `${v.name} (${v.width} × ${v.height})`).join(', '))}</p>
${scope.skipped.length ? `<p><strong>Not checked in this run:</strong> ${scope.skipped.map(escape).join('; ')}. A clean result only covers the selected checks.</p>` : ''}
<p><strong>${summary.routes} checked · ${summary.verdicts.passed} passed · ${summary.verdicts.failed} failed · ${summary.verdicts.review} need review · ${summary.verdicts.incomplete} inconclusive</strong><br>These totals cover the selected checks and route/viewports.</p>
<p>${summary.routes} route/viewports · ${summary.healthFailures} candidate health failures · ${summary.differences} differences for review · ${summary.accepted} accepted differences · ${summary.additions} additions · ${summary.removals} reference-only · ${summary.inconclusive} inconclusive/unmatched</p>
<p>${scope.comparison ? 'Production is an observed reference, not a correctness oracle. Screenshots and structural changes are advisory. Route presence is sampled; reference-only can mean a removal or discovery gap.' : 'Candidate-only application health check. Production was not contacted; no regression comparison was performed.'} No automatic retries; every attempt remains visible.</p>
${run.error ? `<p class="bad">${escape(run.error)}</p>` : ''}
${!run.results.length ? '<p>No routes checked. This is not an all-clear.</p>' : ''}
<div class="review-controls" hidden id="review-controls"><label>Review <select id="review-filter"><option value="attention" selected>Needs attention</option><option value="passed">Passed pages</option><option value="all">All observations</option>${Object.entries(reviewLabels).map(([key, label]) => `<option value="${key}">${label} (${summary.review[key]})</option>`).join('')}</select></label><label>Viewport <select id="viewport-filter"><option value="all">All selected viewports</option>${[...new Set(run.results.map(r => r.viewport))].map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('')}</select></label><span id="review-count" aria-live="polite"></span></div>
<p id="review-empty" hidden>No observations match this view. Choose Passed pages or All observations to check coverage.</p>
<p>Core changes need review; they are not automatically severe regressions. Review groups can overlap. Filters only hide observations; totals and saved evidence stay unchanged.</p>
<details><summary>Coverage, exclusions and suppression policy</summary>${json({ scope, excluded: run.plan?.excluded, ignore: run.plan?.ignore, selectors: run.plan?.options.ignoreSelectors, acceptedPatterns: run.plan?.options.accept, discovery: run.discovery })}</details>
<details><summary>Route index (${run.results.length} observations)</summary><ul>${run.results.map((r, index) => `<li data-observation data-verdict="${observationVerdict(r).kind}" data-groups="${reviewGroups(r).join(' ')}" data-viewport="${escape(r.viewport)}"><a href="#route-${index}">${escape(r.path)} · ${escape(r.viewport)}</a> ${badge(r)} — ${escape(r.classification)}; ${r.health.length} health findings; ${r.differences.filter(d => !d.suppressed).length} review differences</li>`).join('')}</ul></details>
${run.results.map((r, index) => `<article id="route-${index}" data-observation data-verdict="${observationVerdict(r).kind}" data-groups="${reviewGroups(r).join(' ')}" data-viewport="${escape(r.viewport)}"><div class="route-heading"><h2>${escape(r.path)} · ${escape(r.viewport)}</h2>${badge(r)}</div><p>${escape(observationVerdict(r).detail)}</p><p>${escape(r.kind)} · ${escape(r.source)} · <strong>${escape(r.classification)}</strong></p>
<h3>Candidate correctness</h3>${r.health.length ? `<ul class="bad">${r.health.map(f => `<li>${escape(f)}</li>`).join('')}</ul>` : '<p>No candidate health failures recorded in the selected checks.</p>'}
${r.reference.error || r.candidate.error || r.reference.unavailableReason || r.candidate.unavailableReason ? json({ reference: r.reference.error ?? r.reference.unavailableReason, candidate: r.candidate.error ?? r.candidate.unavailableReason }) : ''}
${renderAccessibilityEvidence(r.candidate.accessibility)}
${['core', 'other'].map(group => {
  const differences = r.differences.filter(d => levels.core.differenceKeys.includes(d.key) === (group === 'core'));
  return differences.length ? `<details><summary>${group === 'core' ? 'Core' : 'Other'} differences (${differences.length})</summary>${json(differences)}</details>` : '';
}).join('')}
<details><summary>Transport restrictions, capture limits and accessibility advisories</summary>${json({ reference: r.reference.blocked, candidate: r.candidate.blocked, lazyLoading: { reference: r.reference.lazyLoading, candidate: r.candidate.lazyLoading }, advisory: { reference: r.reference.advisory, candidate: r.candidate.advisory } })}</details>
${scope.screenshots ? `<div class="pair">${['reference', 'candidate'].map(side => `<figure><figcaption>${side}</figcaption>${r[side].screenshot ? `<a href="${escape(r[side].screenshot)}"><img loading="lazy" alt="${side} ${escape(r.path)}" src="${escape(r[side].screenshot)}"></a>` : '<p>No screenshot captured.</p>'}</figure>`).join('')}</div>` : ''}</article>`).join('')}
<script type="module">
const controls = document.getElementById('review-controls');
const group = document.getElementById('review-filter');
const viewport = document.getElementById('viewport-filter');
function filter() {
  for (const row of document.querySelectorAll('[data-observation]')) {
    const matches = group.value === 'all' ||
      (group.value === 'attention' ? row.dataset.verdict !== 'passed' :
       group.value === 'passed' ? row.dataset.verdict === 'passed' :
       row.dataset.groups.split(' ').includes(group.value));
    row.hidden = !matches ||
      !(viewport.value === 'all' || row.dataset.viewport === viewport.value);
  }
  const shown = document.querySelectorAll('article[data-observation]:not([hidden])').length;
  document.getElementById('review-count').textContent = shown + ' observation' + (shown === 1 ? '' : 's') + ' shown';
  document.getElementById('review-empty').hidden = shown !== 0;
}
group.addEventListener('change', filter);
viewport.addEventListener('change', filter);
controls.hidden = false;
filter();
</script></html>`;
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...run, summary }, null, 2));
  writeFileSync(join(dir, 'index.html'), html);
  return summary;
}
