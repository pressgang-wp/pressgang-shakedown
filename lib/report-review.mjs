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
  return `<details><summary>Accept this difference in future runs</summary><p><a href="#acceptance-policy">Acceptance policy and scope</a></p>${json({ regression: { accept: [d.signature] } })}</details>`;
}
const artifactPath = value => typeof value === 'string' && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(value) && !value.split('/').includes('..') ? esc(value) : null;

export function renderVisual(visual, reference, candidate) {
  if (!visual) return '';
  if (visual.unavailable) return `<section class="visual-review"><h3>Comparison unavailable</h3><p>${esc(visual.unavailable)}</p><p>No visual verdict could be established. Review available captures separately.</p></section>`;
  const dimensions = visual.dimensions?.map((d, i) => `${i ? 'Candidate' : 'Reference'}: ${d.width} × ${d.height}`).join('; ');
  const changed = visual.changed ?? visual.percent > 0;
  const ref = artifactPath(reference), cand = artifactPath(candidate), diff = artifactPath(visual.screenshot), report = artifactPath(visual.report);
  const sizes = visual.dimensions;
  const validSizes = sizes?.length === 2 && sizes.every(d => Number.isFinite(d.width) && Number.isFinite(d.height) && d.width > 0 && d.height > 0);
  const width = validSizes ? Math.max(...sizes.map(d => d.width)) : 0;
  const height = validSizes ? Math.max(...sizes.map(d => d.height)) : 0;
  const delta = validSizes ? sizes[1].height - sizes[0].height : 0;
  const image = (src, label) => `<figure><figcaption>${label}</figcaption><a href="${src}"><img loading="lazy" src="${src}" alt="${label} capture"></a></figure>`;
  return `<section class="visual-review"><h3>${changed ? 'Appearance changed — review required' : 'No visual change detected'}</h3><p>${esc(dimensions)}</p>
${delta ? `<p>The candidate page is ${Math.abs(delta)} pixels ${delta > 0 ? 'taller' : 'shorter'} than the reference.</p>` : ''}
<p>${changed ? 'Review the images to decide whether this change is intentional. A visual mismatch alone does not establish an application failure.' : 'The captured images matched within the comparison tolerance; this does not test interactive behaviour.'}</p>
${ref && cand ? `<details open><summary>Side by side</summary><div class="visual-pair">${image(ref, 'Reference')}${image(cand, 'Candidate')}</div></details>` : ''}
${diff ? `<details><summary>Diff</summary>${image(diff, 'Highlighted differences')}</details>` : ''}
${ref && cand && validSizes ? `<details><summary>Comparison slider</summary><p>Images share a common scale and top edge. Blank space can indicate a difference in page size.</p><label>Reveal candidate <input class="visual-slider" type="range" min="0" max="100" value="50" aria-label="Percentage of candidate image revealed"></label><div class="visual-overlay" style="aspect-ratio:${width}/${height}"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Reference"><image href="${ref}" width="${sizes[0].width}" height="${sizes[0].height}"/></svg><svg class="visual-candidate" style="clip-path:inset(0 50% 0 0)" viewBox="0 0 ${width} ${height}" role="img" aria-label="Candidate"><image href="${cand}" width="${sizes[1].width}" height="${sizes[1].height}"/></svg></div></details>` : ''}
${report ? `<details><summary>Technical details</summary><p>Playwright records a screenshot mismatch as a failed assertion. Its Errors heading and Buffer message describe that comparison, not a buffer malfunction or an application crash. Expected means reference; actual means candidate.</p><a href="${report}">Open underlying Playwright test report</a></details>` : ''}</section>`;
}

const md = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
export function markdownReport(run, summary, coverage) {
  const sections = [['Candidate health failures', r => r.health.map(md)], ['Behaviour changes', r => r.differences.filter(d => !d.suppressed && d.comparison !== 'unavailable' && ['status','redirects','forms','emptyLinks','h1','emptyHeadings'].includes(d.key)).map(d => md(d.signature ?? d.key))], ['Accepted differences', r => r.differences.filter(d => d.suppressed).map(d => md(d.signature ?? d.key))], ['Comparison limitations', r => [...r.differences.filter(d => d.comparison === 'unavailable').map(d => md(d.reason)), ...[r.reference, r.candidate].flatMap(side => side?.error || side?.unavailableReason ? [md(side.error ?? side.unavailableReason)] : [])]], ['Screenshot guidance', r => r.visual ? [r.visual.unavailable ? md(r.visual.unavailable) : (r.visual.engine ? (r.visual.changed ? 'Appearance changed (Playwright; review required)' : 'No visual change detected by Playwright') : `${r.visual.percent.toFixed(2)}% changed pixels (legacy advisory)`)] : []]];
  return `# Shakedown regression report\n\n${md(run.state)} · ${md(run.started)}\n\nReference: ${md(run.plan?.options.reference)}\n\nCandidate: ${md(run.plan?.options.candidate)}\n\n${summary.routes} observations; ${summary.healthFailures} pages with health failures; ${summary.differences} review differences; ${summary.limitations} comparison limitations.\n\nCoverage: ${md(coverage.mode)}; ${coverage.selectedRoutes} selected routes; ${coverage.state === 'complete' ? coverage.notSelected.length : 'unknown'} discovered routes omitted; ${coverage.notVisited.length} observations not visited.\n\n${md(coverage.scope)}\n\n${run.error ? md(run.error) + '\n\n' : ''}A clean result covers selected checks only. Visual changes are advisory. See [HTML report](index.html) and [raw evidence](run.json).\n\n` + sections.map(([title, values]) => `## ${title}\n\n${run.results.flatMap(r => values(r).map(v => `- ${md(r.path)} (${md(r.viewport)}): ${v}`)).join('\n') || 'None recorded.'}\n`).join('\n') + `\n## Repeated changes\n\n${groupedChanges(run).map(g => `- ${md(g.title)}: ${g.members.length} observations${g.accepted ? ' (accepted)' : ''}`).join('\n') || 'None grouped.'}\n`;
}
