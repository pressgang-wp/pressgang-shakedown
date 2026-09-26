import { highlight } from './accessibility-report.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const comparisonValue = (key, value, includePosition = false) => {
  if (!value) return value;
  if (key === 'emptyLinks') {
    const { x, y, width, height, ...semantic } = value;
    return semantic;
  }
  if (key === 'images' && !includePosition) {
    const { x, y, ...semantic } = value;
    return semantic;
  }
  return value;
};

function changedIndexes(difference) {
  if (!Array.isArray(difference.reference) || !Array.isArray(difference.candidate)) return null;
  const reference = difference.reference ?? [], candidate = difference.candidate ?? [];
  const indexes = includePosition => {
    const changed = new Set();
    for (let index = 0; index < Math.max(reference.length, candidate.length); index++) {
      const before = comparisonValue(difference.key, reference[index], includePosition);
      const after = comparisonValue(difference.key, candidate[index], includePosition);
      if (JSON.stringify(before) !== JSON.stringify(after)) changed.add(index);
    }
    return changed;
  };
  const semantic = indexes(false);
  return semantic.size ? semantic : indexes(true);
}

export function renderElements(result) {
  const differences = new Map(result.differences.filter(d => d.comparison !== 'unavailable').map(d => [d.key, d]));
  const changed = new Set(differences.keys());
  const sides = ['reference', 'candidate'].map(side => {
    const evidence = result[side].elements;
    const findings = evidence?.findings?.filter(f => changed.has(f.id) || !['images', 'forms', 'emptyLinks'].includes(f.id)).map(f => {
      const difference = differences.get(f.id);
      if (!difference) return f;
      const indexes = changedIndexes(difference);
      if (!indexes) return f;
      return { ...f, nodes: f.nodes.filter((_, index) => indexes.has(index)), changedOnly: true };
    }).filter(f => f.nodes.length) ?? [];
    if (!findings.length) return '';
    return `<h4>${side}</h4>${evidence.captureError ? `<p>${esc(evidence.captureError)}</p>` : ''}${findings.map(f => `<details><summary>${esc(f.id)} · ${f.nodes.length} ${f.changedOnly ? 'changed' : 'captured'} element(s)${f.suppressed ? ' · suppressed' : ''}</summary>
${f.message ? `<p>${esc(f.message)}</p>` : '<p>Only elements with changed comparison values are shown.</p>'}
${f.omittedNodes ? `<p>${f.omittedNodes} further possible contributors omitted from highlights.</p>` : ''}
${f.nodes.map((n, i) => `<details><summary>Element ${i + 1}${n.text ? ': ' + esc(n.text) : ''}</summary><p><strong>Selector:</strong> <code>${esc(n.target.join(' → '))}</code></p><pre>${esc(n.html)}</pre>${n.htmlTruncated ? '<p>HTML excerpt truncated at 6,000 characters.</p>' : ''}${n.dimensions ? `<pre>${esc(JSON.stringify(n.dimensions, null, 2))}</pre>` : ''}${highlight(evidence, n)}</details>`).join('')}</details>`).join('')}`;
  }).join('');
  return sides ? `<section class="a11y-evidence"><h3>Images, links and forms: element details</h3>${sides}</section>` : '';
}
