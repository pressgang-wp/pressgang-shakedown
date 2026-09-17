const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;

// Only group identical changes or a precisely recognised title transformation.
export function groupedChanges(run) {
  const groups = new Map();
  const add = (key, title, accepted, member) => {
    const group = groups.get(key) ?? { title, accepted, members: [] };
    if (!group.members.some(m => m.index === member.index)) group.members.push(member);
    groups.set(key, group);
  };
  for (const [index, r] of run.results.entries()) for (const d of r.differences) {
    if (d.comparison === 'unavailable') continue;
    const punctuation = d.key === 'title' && typeof d.reference === 'string' && d.reference !== d.candidate && d.reference.replaceAll(' - ', ' – ') === d.candidate;
    const key = JSON.stringify([d.key, !!d.suppressed, punctuation ? 'hyphen-to-en-dash' : [d.reference, d.candidate]]);
    const group = groups.get(key) ?? { title: punctuation ? 'Title separator changed from hyphen to en dash' : `${d.key}: identical recorded change`, accepted: !!d.suppressed, members: [] };
    group.members.push({ path: r.path, viewport: r.viewport, index }); groups.set(key, group);
    if (d.key === 'images') for (const before of d.reference ?? []) {
      // Ambiguous/repeated images remain raw evidence, never guessed by array index.
      if (!before.alt || d.reference.filter(i => i.alt === before.alt).length !== 1) continue;
      const matches = (d.candidate ?? []).filter(i => i.alt === before.alt);
      if (matches.length !== 1) continue;
      const after = matches[0];
      if (before.src === after.src || before.width !== after.width || before.height !== after.height) continue;
      add(JSON.stringify(['asset',d.suppressed,before.src,after.src,before.width,before.height]), `Image source changed: ${before.alt} (${before.width} × ${before.height} on both sides; other properties may differ)`, !!d.suppressed, {path:r.path,viewport:r.viewport,index});
    }
    if (d.key === 'landmarks') {
      const semantics = items => (items ?? []).map(({tag,role,label}) => ({tag,role,label}));
      const before = semantics(d.reference), after = semantics(d.candidate);
      if (JSON.stringify(before) !== JSON.stringify(after)) add(JSON.stringify(['landmark-semantics',d.suppressed,before,after]), 'Repeated landmark roles or labels change (layout changes remain in page evidence)', !!d.suppressed, {path:r.path,viewport:r.viewport,index});
    }
  }
  return [...groups.values()].filter(g => g.members.length > 1);
}
export function renderGroups(run) {
  const groups = groupedChanges(run);
  return groups.length ? `<section class="report-section"><h2>Repeated changes</h2><p>Grouped for review only; no findings are suppressed. Other differences on these pages still need review.</p>${groups.map(g => `<details><summary>${esc(g.title)} · ${new Set(g.members.map(m => m.path)).size} routes · ${g.members.length} observations${g.accepted ? ' · accepted' : ''}</summary><ul>${g.members.map(m => `<li><a href="#route-${m.index}">${esc(m.path)} · ${esc(m.viewport)}</a></li>`).join('')}</ul></details>`).join('')}</section>` : '';
}
export function acceptanceHelp(d) {
  if (d.suppressed || !d.signature || d.comparison === 'unavailable') return '';
  return `<details><summary>Accept this difference in future runs</summary><p>Merge this entry into the existing regression.accept array in shakedown.config.json after reviewing it. This uses case-sensitive substring matching: it can also match longer route names, all viewports, and future changes to this field. It does not suppress candidate health failures or remove a route.</p>${json({ regression: { accept: [d.signature] } })}</details>`;
}
export function renderVisual(visual) {
  if (!visual) return '';
  const dimensions = visual.dimensions?.map((d, i) => `${i ? 'Candidate' : 'Reference'}: ${d.width} × ${d.height}`).join('; ');
  return `<section><h3>Screenshot comparison</h3><p>${esc(dimensions)}</p>${visual.unavailable ? `<p>Unavailable: ${esc(visual.unavailable)}</p>` : `<p>${visual.percent.toFixed(2)}% of the combined canvas differs. Pink marks changed pixels; extra page area counts as changed. Channel tolerance: 16/255. Font rendering, animation and content changes can contribute; this is advisory, not a regression verdict.</p><a href="${esc(visual.screenshot)}">Open highlighted diff</a>`}</section>`;
}
const md = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
export function markdownReport(run, summary, coverage) {
  const sections = [['Candidate health failures', r => r.health.map(md)], ['Behaviour changes', r => r.differences.filter(d => !d.suppressed && d.comparison !== 'unavailable' && ['status','redirects','forms','emptyLinks','h1','emptyHeadings'].includes(d.key)).map(d => md(d.signature ?? d.key))], ['Accepted differences', r => r.differences.filter(d => d.suppressed).map(d => md(d.signature ?? d.key))], ['Comparison limitations', r => [...r.differences.filter(d => d.comparison === 'unavailable').map(d => md(d.reason)), ...[r.reference, r.candidate].flatMap(side => side?.error || side?.unavailableReason ? [md(side.error ?? side.unavailableReason)] : [])]], ['Screenshot guidance', r => r.visual ? [r.visual.unavailable ? md(r.visual.unavailable) : `${r.visual.percent.toFixed(2)}% changed pixels (advisory)`] : []]];
  return `# Shakedown regression report\n\n${md(run.state)} · ${md(run.started)}\n\nReference: ${md(run.plan?.options.reference)}\n\nCandidate: ${md(run.plan?.options.candidate)}\n\n${summary.routes} observations; ${summary.healthFailures} pages with health failures; ${summary.differences} review differences; ${summary.limitations} comparison limitations.\n\nCoverage: ${md(coverage.mode)}; ${coverage.selectedRoutes} selected routes; ${coverage.state === 'complete' ? coverage.notSelected.length : 'unknown'} discovered routes omitted; ${coverage.notVisited.length} observations not visited.\n\n${md(coverage.scope)}\n\n${run.error ? md(run.error) + '\n\n' : ''}A clean result covers selected checks only. Visual changes are advisory. See [HTML report](index.html) and [raw evidence](run.json).\n\n` + sections.map(([title, values]) => `## ${title}\n\n${run.results.flatMap(r => values(r).map(v => `- ${md(r.path)} (${md(r.viewport)}): ${v}`)).join('\n') || 'None recorded.'}\n`).join('\n') + `\n## Repeated changes\n\n${groupedChanges(run).map(g => `- ${md(g.title)}: ${g.members.length} observations${g.accepted ? ' (accepted)' : ''}`).join('\n') || 'None grouped.'}\n`;
}
