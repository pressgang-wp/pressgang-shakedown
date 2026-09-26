import { highlight } from './accessibility-report.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const comparisonValue = (key, value) => {
  if (key === 'emptyLinks' && value) {
    const { x, y, width, height, ...semantic } = value;
    return semantic;
  }
  return value;
};

// Cancel equal values as a multiset, not by array position. Keep unmatched
// values on each side without inventing a correspondence between elements.
export function changedElementIndexes(difference) {
  if (!Array.isArray(difference.reference) || !Array.isArray(difference.candidate)) return null;
  const buckets = new Map();
  const key = value => JSON.stringify(comparisonValue(difference.key, value));
  difference.candidate.forEach((value, index) => {
    const signature = key(value);
    if (!buckets.has(signature)) buckets.set(signature, []);
    buckets.get(signature).push(index);
  });
  const reference = new Set();
  const candidate = new Set(difference.candidate.map((_, index) => index));
  difference.reference.forEach((value, index) => {
    const matches = buckets.get(key(value));
    if (matches?.length) candidate.delete(matches.shift());
    else reference.add(index);
  });
  return { reference, candidate };
}

export function renderElements(result) {
  const differences = new Map(result.differences.filter(d => d.comparison !== 'unavailable').map(d => [d.key, d]));
  const changed = new Set(differences.keys());
  const sides = ['reference', 'candidate'].map(side => {
    const evidence = result[side].elements;
    const findings = evidence?.findings?.filter(f => changed.has(f.id) || !['images', 'forms', 'emptyLinks'].includes(f.id)).map(f => {
      const difference = differences.get(f.id);
      if (!difference) return f;
      const indexes = changedElementIndexes(difference);
      if (!indexes || f.nodes.length !== difference[side].length) return f;
      return { ...f, nodes: f.nodes.filter((_, index) => indexes[side].has(index)), changedOnly: true };
    }).filter(f => f.nodes.length) ?? [];
    if (!findings.length) return '';
    return `<h4>${side}</h4>${evidence.captureError ? `<p>${esc(evidence.captureError)}</p>` : ''}${findings.map(f => `<details><summary>${esc(f.id)} · ${f.nodes.length} ${f.changedOnly ? 'changed or unmatched' : 'captured'} element(s)${f.suppressed ? ' · suppressed' : ''}</summary>
${f.message ? `<p>${esc(f.message)}</p>` : (f.changedOnly ? '<p>Elements with no equal comparison value on the other side. These may be changed, added or removed; no one-to-one match is assumed. Image position changes are retained.</p>' : '<p>Captured group retained because comparison mapping is unavailable; inclusion does not establish that each element changed.</p>')}
${f.omittedNodes ? `<p>${f.omittedNodes} further possible contributors omitted from highlights.</p>` : ''}
${f.nodes.map((n, i) => `<details><summary>Element ${i + 1}${n.text ? ': ' + esc(n.text) : ''}</summary><p><strong>Selector:</strong> <code>${esc(n.target.join(' → '))}</code></p><pre>${esc(n.html)}</pre>${n.htmlTruncated ? '<p>HTML excerpt truncated at 6,000 characters.</p>' : ''}${n.dimensions ? `<pre>${esc(JSON.stringify(n.dimensions, null, 2))}</pre>` : ''}${highlight(evidence, n)}</details>`).join('')}</details>`).join('')}`;
  }).join('');
  return sides ? `<section class="a11y-evidence"><h3>Images, links and forms: element details</h3>${sides}</section>` : '';
}
