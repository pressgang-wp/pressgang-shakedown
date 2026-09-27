import { technicalDelta, compactAdvisories, transportDetails } from './report-compact.mjs';
import { coverageSummary } from './coverage.mjs';
import { renderGroups, acceptanceHelp, renderVisual, markdownReport } from './report-review.mjs';
import { pairedImages, renderElements } from './element-report.mjs';
import { runScope, levels, reviewGroups, reviewLabels, observationVerdict } from './regression-scope.mjs';
import { accessibilityStyles, renderAccessibilityEvidence } from './accessibility-report.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const label = value => ({ h1: 'page heading', emptyHeadings: 'empty heading', emptyLinks: 'empty link', redirects: 'redirect behaviour', landmarks: 'page landmarks' }[value] ?? value);
function imageSummary(reference = [], candidate = []) {
  const delta = technicalDelta({ key: 'images', reference, candidate });
  if (!delta.reference.length && !delta.candidate.length) return ['Image positions/order changed; see visual/layout evidence. No image-content or size change recorded.'];
  const sizes = pairedImages({ key: 'images', reference, candidate }).flatMap(pair =>
    pair.changes.filter(c => c.key === 'alt').map(c => `Alternative text changed from “${c.before ?? ''}” to “${c.after ?? ''}” (${pair.src}).`));
  for (const before of delta.reference) {
    const identity = value => before.src ? value.src === before.src : before.alt && value.alt === before.alt;
    const matches = delta.candidate.filter(identity);
    if (matches.length !== 1 || delta.reference.filter(identity).length !== 1) continue;
    const after = matches[0];
    if (before.width !== after.width || before.height !== after.height) sizes.push(`${after.alt || before.alt || before.src || 'Image'}: rendered ${before.width} × ${before.height} in the reference and ${after.width} × ${after.height} in the candidate.`);
  }
  return [...sizes, `${delta.reference.length} reference and ${delta.candidate.length} candidate image values changed or are unmatched (source, text, dimensions or rendering metadata). See the delta and element details; values are not assumed pairs.`];
}
function describeDifference(difference) {
  if (difference.key === 'images') return imageSummary(difference.reference, difference.candidate);
  if (difference.key === 'title') return [`Title changed from “${difference.reference}” to “${difference.candidate}”.`];
  if (difference.key === 'h1') return [`Page heading changed from “${(difference.reference ?? []).join(', ')}” to “${(difference.candidate ?? []).join(', ')}”.`];
  if (difference.key === 'status') return [`HTTP status changed from ${difference.reference} to ${difference.candidate}.`];
  if (difference.key === 'forms') return ['Form fields or choices changed.'];
  if (difference.key === 'emptyHeadings') return ['Empty headings changed.'];
  if (difference.key === 'emptyLinks') return ['Links without a destination changed.'];
  if (difference.key === 'landmarks') return ['Page landmark roles or labels changed.'];
  if (difference.key === 'redirects') return ['Redirect behaviour changed.'];
  return [`${label(difference.key)} changed.`];
}
function renderDifferences(differences, json) {
  if (!differences.length) return '';
  return `<ul class="finding-list">${differences.map(d => `<li><strong>${escape(label(d.key))}:</strong> ${describeDifference(d).map(escape).join(' ') }${d.suppressed ? ' <em>Accepted difference.</em>' : ''}${acceptanceHelp(d)}<details><summary>Technical evidence</summary>${json(technicalDelta(d))}<p><a href="run.json">Full raw evidence</a></p></details></li>`).join('')}</ul>`;
}
function limitationSummary(run) {
  const groups = new Map();
  for (const result of run.results) for (const difference of result.differences.filter(d => d.comparison === 'unavailable' && !d.suppressed)) {
    const key = `${difference.key}\n${difference.reason}`;
    const group = groups.get(key) ?? { key: difference.key, reason: difference.reason, routes: [] };
    group.routes.push(result.path); groups.set(key, group);
  }
  return [...groups.values()];
}
export function reportSummary(run) {
  return {
    routes: run.results.length,
    verdicts: Object.fromEntries(['passed', 'failed', 'review', 'incomplete'].map(kind => [kind, run.results.filter(r => observationVerdict(r).kind === kind).length])),
    review: Object.fromEntries(Object.keys(reviewLabels).map(key => [key, run.results.filter(r => reviewGroups(r).includes(key)).length])),
    healthFailures: run.results.filter(r => r.health.length).length,
    differences: run.results.reduce((n, r) => n + r.differences.filter(d => !d.suppressed && d.comparison !== 'unavailable').length, 0),
    limitations: run.results.reduce((n, r) => n + r.differences.filter(d => !d.suppressed && d.comparison === 'unavailable').length, 0),
    accepted: run.results.reduce((n, r) => n + r.differences.filter(d => d.suppressed).length, 0),
    inconclusive: run.results.filter(r => ['inconclusive', 'unmatched'].includes(r.classification)).length,
    additions: run.results.filter(r => r.classification === 'candidate-only').length,
    removals: run.results.filter(r => r.classification === 'reference-only').length,
  };
}
export function writeRegressionReport(dir, run) {
  const summary = reportSummary(run);
  const coverage = coverageSummary(run);
  const scope = run.scope ?? runScope(run.plan?.options);
  const badge = result => {
    const verdict = observationVerdict(result);
    return `<span class="verdict verdict-${verdict.kind}" title="${escape(verdict.detail)}">${verdict.label}</span>`;
  };
  const json = value => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
  const limitations = limitationSummary(run);
  const compact = compactAdvisories(run);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shakedown Regression Report</title>
<style>body{font:16px/1.5 system-ui;margin:32px auto;padding:0 24px;max-width:1400px;color:#17233a;background:#f5f7fa}article,.report-section{background:white;padding:24px;margin:24px 0;border:1px solid #ccd3df;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pair img{width:100%;height:440px;object-fit:contain;object-position:top;border:1px solid #ccd3df}h2{overflow-wrap:anywhere}.bad{color:#a12626}summary{cursor:pointer}figure{margin:0}a{color:#175ac0}.review-controls{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.review-controls select{font:inherit;padding:8px;max-width:100%}.verdict{display:inline-block;font-size:16px;font-weight:700;padding:5px 12px;border-radius:5px;vertical-align:middle}.verdict-passed{color:#17613a;background:#e5f4eb}.verdict-failed{color:#942222;background:#fde8e8}.verdict-review{color:#775000;background:#fff2cc}.verdict-incomplete{color:#374151;background:#e5e7eb}.route-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.finding-list>li{margin:10px 0}.finding-list details{margin-top:6px}[hidden]{display:none!important}.visual-review img{display:block;width:100%;height:auto}.visual-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.visual-overlay{position:relative;background:#eee}.visual-overlay svg{position:absolute;inset:0;width:100%;height:100%}.visual-slider{width:240px;max-width:100%}${accessibilityStyles}</style>
<h1>Shakedown Regression Report</h1><p>${escape(run.started)} · ${escape(run.state)}</p>
<p><a href="summary.md">Download Markdown summary</a></p>
${run.plan?.options.routes ? `<p><strong>Focused run:</strong> ${escape(run.plan.options.routes.join(', '))}. Other routes were excluded by --routes. Remove that flag for broader coverage.</p>` : ''}
<p>Reference${scope.comparison ? '' : ' (not observed at errors level)'}: ${escape(run.plan?.options.reference)}<br>Candidate: ${escape(run.plan?.options.candidate)}</p>
<p><strong>Level: ${escape(scope.level)}</strong> — ${escape(scope.description)}<br>Viewports: ${escape((run.plan?.options.viewports ?? []).map(v => `${v.name} (${v.width} × ${v.height})`).join(', '))}</p>
${scope.skipped.length ? `<p><strong>Not checked in this run:</strong> ${scope.skipped.map(escape).join('; ')}. A clean result only covers the selected checks.</p>` : ''}
<p><strong>${summary.routes} checked · ${summary.verdicts.passed} passed · ${summary.verdicts.failed} failed · ${summary.verdicts.review} need review · ${summary.verdicts.incomplete} inconclusive</strong><br>These totals cover the selected checks and route/viewports.</p>
<p>${summary.routes} route/viewports · ${summary.healthFailures} candidate health failures · ${summary.differences} differences for review · ${summary.limitations} comparison limitations · ${summary.accepted} accepted differences · ${summary.additions} additions · ${summary.removals} reference-only · ${summary.inconclusive} inconclusive/unmatched</p>
<p>${scope.comparison ? 'Production is an observed reference, not a correctness oracle. Screenshots and structural changes are advisory. Route presence is sampled; reference-only can mean a removal or discovery gap.' : 'Candidate-only application health check. Production was not contacted; no regression comparison was performed.'} No automatic retries; every attempt remains visible.</p>
<p><strong>Coverage: ${escape(coverage.mode ?? 'sampled')}</strong> · ${coverage.selectedRoutes} selected routes · ${coverage.state === 'complete' ? coverage.notSelected.length : 'Unknown number of'} known content routes not selected · ${coverage.notVisited.length} route/viewports not visited.</p>
${coverage.state !== 'complete' ? `<p class="bad">Content inventory unavailable: ${escape(coverage.error ?? 'not collected')}. The number of omitted routes is unknown.</p>` : ''}
<p>${escape(coverage.scope)}</p>
${coverage.mode === 'sampled' && coverage.state === 'complete' && coverage.notSelected.length ? `<section class="report-section"><h2>Known content not tested</h2><p><strong>${coverage.notSelected.length} discovered public content route${coverage.notSelected.length === 1 ? '' : 's'} ${coverage.notSelected.length === 1 ? 'was' : 'were'} omitted by sampled coverage.</strong> Include all discovered public content with:</p><pre>npx shakedown regression --level=${escape(scope.level)} --coverage=exhaustive</pre><p>This includes published public posts, pages and terms. Archive, pagination, arbitrary searches and component interactions remain sampled.</p></section>` : ''}
<details><summary>Known routes not selected (${coverage.state === 'complete' ? coverage.notSelected.length : 'unknown'})</summary><p>Use <code>--coverage=exhaustive</code> to include the eligible published content inventory.</p><a href="run.json">Download the full route inventory in run.json</a></details>
<details><summary>Selected routes not visited (${coverage.notVisited.length})</summary>${json(coverage.notVisited)}</details>
${limitations.length ? `<section class="report-section"><h2>Comparison limitations</h2><p>These are capture constraints, not regressions.</p><ul>${limitations.map(item => `<li><strong>${escape(label(item.key))}:</strong> ${escape(item.reason)} Affected routes: ${item.routes.length}.<details><summary>Show routes</summary>${json(item.routes)}</details></li>`).join('')}</ul></section>` : ''}
${run.error ? `<p class="bad">${escape(run.error)}</p>` : ''}
${renderGroups(run)}
<section id="acceptance-policy"><h2>Accepting intentional differences</h2><p>After review, merge a finding's snippet into the existing regression.accept array in shakedown.config.json. Matching is case-sensitive substring matching and applies to longer matching route names, all viewports and future changes to that field. It does not suppress candidate health failures or remove routes.</p></section>
${compact.groups.length ? `<section class="report-section"><h2>Repeated image advisories</h2><p>Grouped for review only; full evidence and page verdicts are unchanged.</p>${compact.groups.map(g => `<details><summary>${escape(g.finding.message)} · ${new Set(g.members.map(m => m.path)).size} routes · ${g.members.length} observations</summary><p>Representative: <a href="#route-${g.representative}">${escape(run.results[g.representative].path)}</a>. All affected observations remain in run.json.</p>${renderElements({ differences: [], reference: {}, candidate: { elements: { ...run.results[g.representative].candidate.elements, findings: [g.finding] } } })}</details>`).join('')}</section>` : ''}
${!run.results.length ? '<p>No routes checked. This is not an all-clear.</p>' : ''}
<div class="review-controls" hidden id="review-controls"><label>Review <select id="review-filter"><option value="attention" selected>Needs attention</option><option value="passed">Passed pages</option><option value="all">All observations</option>${Object.entries(reviewLabels).map(([key, label]) => `<option value="${key}">${label} (${summary.review[key]})</option>`).join('')}</select></label><label>Viewport <select id="viewport-filter"><option value="all">All selected viewports</option>${[...new Set(run.results.map(r => r.viewport))].map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('')}</select></label><span id="review-count" aria-live="polite"></span></div>
<p id="review-empty" hidden>No observations match this view. Choose Passed pages or All observations to check coverage.</p>
<p>Core changes need review; they are not automatically severe regressions. Review groups can overlap. Filters only hide observations; totals and saved evidence stay unchanged.</p>
<details><summary>Coverage, exclusions and suppression policy</summary>${json({ coverage: { ...coverage, notSelected: { count: coverage.notSelected.length, evidence: "run.json" } }, scope, excluded: run.plan?.excluded, ignore: run.plan?.ignore, selectors: run.plan?.options.ignoreSelectors, acceptedPatterns: run.plan?.options.accept, discovery: run.discovery })}</details>
<details><summary>Route index (${run.results.length} observations)</summary><ul>${run.results.map((r, index) => `<li data-observation data-verdict="${observationVerdict(r).kind}" data-groups="${reviewGroups(r).join(' ')}" data-viewport="${escape(r.viewport)}"><a href="#route-${index}">${escape(r.path)} · ${escape(r.viewport)}</a> ${badge(r)} — ${escape(r.classification)}; ${r.health.length} health findings; ${r.differences.filter(d => !d.suppressed && d.comparison !== 'unavailable').length} review differences; ${r.differences.filter(d => !d.suppressed && d.comparison === 'unavailable').length} comparison limitations</li>`).join('')}</ul></details>
${run.results.map((r, index) => `<article id="route-${index}" data-observation data-verdict="${observationVerdict(r).kind}" data-groups="${reviewGroups(r).join(' ')}" data-viewport="${escape(r.viewport)}"><div class="route-heading"><h2>${escape(r.path)} · ${escape(r.viewport)}</h2>${badge(r)}${!r.health.length && !['inconclusive', 'unmatched'].includes(r.classification) && !r.candidate.error ? '<small>No recorded health failures</small>' : ''}</div><p>${escape(observationVerdict(r).detail)}</p><p>${escape(r.kind)} · ${escape(r.source)} · <strong>${escape(r.classification)}</strong></p>
${r.health.length ? `<h3>Candidate correctness</h3><ul class="bad">${r.health.map(f => `<li>${escape(f)}</li>`).join('')}</ul>` : ''}
${renderVisual(r.visual, r.reference.screenshot, r.candidate.screenshot)}
${r.reference.error || r.candidate.error || r.reference.unavailableReason || r.candidate.unavailableReason ? json({ reference: r.reference.error ?? r.reference.unavailableReason, candidate: r.candidate.error ?? r.candidate.unavailableReason }) : ''}
${renderAccessibilityEvidence(r.candidate.accessibility)}
${r.differences.some(d => d.comparison === 'unavailable') ? `<details><summary>Comparison limitation on this page</summary><p>The captured content regions are not comparable. This is not evidence that the candidate added or removed all the listed structures.</p>${json(r.differences.filter(d => d.comparison === 'unavailable'))}</details>` : ''}
${['core', 'other'].map(group => {
  const differences = r.differences.filter(d => d.comparison !== 'unavailable').filter(d => levels.core.differenceKeys.includes(d.key) === (group === 'core'));
  return differences.length ? `<details open><summary>${group === 'core' ? 'Behaviour changes' : 'Presentation and content changes'} (${differences.length})</summary>${renderDifferences(differences, json)}</details>` : '';
}).join('')}
${renderElements(compact.results[index])}
${transportDetails(compact.results[index]) ? `<details><summary>Transport restrictions, capture limits and advisories</summary>${json(transportDetails(compact.results[index]))}</details>` : ''}
${scope.screenshots && (!r.visual || r.visual.unavailable) ? `<div class="pair">${['reference', 'candidate'].map(side => `<figure><figcaption>${side}</figcaption>${r[side].screenshot ? `<a href="${escape(r[side].screenshot)}"><img loading="lazy" alt="${side} ${escape(r.path)}" src="${escape(r[side].screenshot)}"></a>` : '<p>No screenshot captured.</p>'}</figure>`).join('')}</div>` : ''}</article>`).join('')}
<script type="module">
document.querySelectorAll('.visual-slider').forEach(slider => {
  slider.addEventListener('input', () => {
    slider.closest('details').querySelector('.visual-candidate').style.clipPath = 'inset(0 ' + (100 - Number(slider.value)) + '% 0 0)';
  });
});
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
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#route-"]');
  if (!link) return;
  group.value = 'all'; viewport.value = 'all'; filter();
});
controls.hidden = false;
filter();
</script></html>`;
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...run, coverage, summary }, null, 2));
  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, 'summary.md'), markdownReport(run, summary, coverage));
  return summary;
}
