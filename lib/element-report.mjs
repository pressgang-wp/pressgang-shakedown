import { highlight } from './accessibility-report.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function renderElements(result) {
  const changed = new Set(result.differences.filter(d => d.comparison !== 'unavailable').map(d => d.key));
  const sides = ['reference', 'candidate'].map(side => {
    const evidence = result[side].elements;
    const findings = evidence?.findings?.filter(f => changed.has(f.id) || !['images', 'forms', 'emptyLinks'].includes(f.id)) ?? [];
    if (!findings.length) return '';
    return `<h4>${side}</h4>${evidence.captureError ? `<p>${esc(evidence.captureError)}</p>` : ''}${findings.map(f => `<details><summary>${esc(f.id)} · ${f.nodes.length} captured element(s)${f.suppressed ? ' · suppressed' : ''}</summary>
${f.message ? `<p>${esc(f.message)}</p>` : '<p>Elements in this captured group. Compare the reference and candidate values above; inclusion here does not mean every element changed.</p>'}
${f.omittedNodes ? `<p>${f.omittedNodes} further possible contributors omitted from highlights.</p>` : ''}
${f.nodes.map((n, i) => `<details><summary>Element ${i + 1}${n.text ? ': ' + esc(n.text) : ''}</summary><p><strong>Selector:</strong> <code>${esc(n.target.join(' → '))}</code></p><pre>${esc(n.html)}</pre>${n.htmlTruncated ? '<p>HTML excerpt truncated at 6,000 characters.</p>' : ''}${n.dimensions ? `<pre>${esc(JSON.stringify(n.dimensions, null, 2))}</pre>` : ''}${highlight(evidence, n)}</details>`).join('')}</details>`).join('')}`;
  }).join('');
  return sides ? `<section class="a11y-evidence"><h3>Images, links and forms: element details</h3>${sides}</section>` : '';
}
