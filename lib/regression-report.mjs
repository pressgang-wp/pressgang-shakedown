import { accessibilityStyles, renderAccessibilityEvidence } from './accessibility-report.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function reportSummary(run) {
  return {
    routes: run.results.length,
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
  const json = value => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shakedown Regression Report</title>
<style>body{font:16px/1.5 system-ui;margin:32px auto;padding:0 24px;max-width:1400px;color:#17233a;background:#f5f7fa}article{background:white;padding:24px;margin:24px 0;border:1px solid #ccd3df;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pair img{width:100%;height:440px;object-fit:contain;object-position:top;border:1px solid #ccd3df}h2{overflow-wrap:anywhere}.bad{color:#a12626}summary{cursor:pointer}figure{margin:0}a{color:#175ac0}${accessibilityStyles}</style>
<h1>Shakedown Regression Report</h1><p>${escape(run.started)} · ${escape(run.state)}</p>
<p>Reference: ${escape(run.plan?.options.reference)}<br>Candidate: ${escape(run.plan?.options.candidate)}</p>
<p>${summary.routes} route/viewports · ${summary.healthFailures} candidate health failures · ${summary.differences} differences for review · ${summary.accepted} accepted differences · ${summary.additions} additions · ${summary.removals} reference-only · ${summary.inconclusive} inconclusive/unmatched</p>
<p>Production is an observed reference, not a correctness oracle. Screenshots and structural changes are advisory. Route presence is sampled; reference-only can mean a removal or discovery gap. No automatic retries; every attempt remains visible.</p>
${run.error ? `<p class="bad">${escape(run.error)}</p>` : ''}
${!run.results.length ? '<p>No routes checked. This is not an all-clear.</p>' : ''}
<details><summary>Coverage, exclusions and suppression policy</summary>${json({ excluded: run.plan?.excluded, ignore: run.plan?.ignore, selectors: run.plan?.options.ignoreSelectors, acceptedPatterns: run.plan?.options.accept, discovery: run.discovery })}</details>
<details><summary>Route index (${run.results.length} observations)</summary><ul>${run.results.map((r, index) => `<li><a href="#route-${index}">${escape(r.path)} · ${escape(r.viewport)}</a> — ${escape(r.classification)}; ${r.health.length} health findings; ${r.differences.filter(d => !d.suppressed).length} review differences</li>`).join('')}</ul></details>
${run.results.map((r, index) => `<article id="route-${index}"><h2>${escape(r.path)} · ${escape(r.viewport)}</h2><p>${escape(r.kind)} · ${escape(r.source)} · <strong>${escape(r.classification)}</strong></p>
<h3>Candidate correctness</h3>${r.health.length ? `<ul class="bad">${r.health.map(f => `<li>${escape(f)}</li>`).join('')}</ul>` : '<p>No candidate health failures recorded.</p>'}
${r.reference.error || r.candidate.error || r.reference.unavailableReason || r.candidate.unavailableReason ? json({ reference: r.reference.error ?? r.reference.unavailableReason, candidate: r.candidate.error ?? r.candidate.unavailableReason }) : ''}
${renderAccessibilityEvidence(r.candidate.accessibility)}
<details><summary>Differences (${r.differences.length})</summary>${json(r.differences)}</details>
<details><summary>Transport restrictions, capture limits and accessibility advisories</summary>${json({ reference: r.reference.blocked, candidate: r.candidate.blocked, lazyLoading: { reference: r.reference.lazyLoading, candidate: r.candidate.lazyLoading }, advisory: { reference: r.reference.advisory, candidate: r.candidate.advisory } })}</details>
<div class="pair">${['reference', 'candidate'].map(side => `<figure><figcaption>${side}</figcaption>${r[side].screenshot ? `<a href="${escape(r[side].screenshot)}"><img loading="lazy" alt="${side} ${escape(r.path)}" src="${escape(r[side].screenshot)}"></a>` : '<p>No screenshot captured.</p>'}</figure>`).join('')}</div></article>`).join('')}</html>`;
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...run, summary }, null, 2));
  writeFileSync(join(dir, 'index.html'), html);
  return summary;
}
