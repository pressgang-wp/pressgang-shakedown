import { highlight } from './accessibility-report.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const comparisonValue = (key, value) => {
  if (key === 'images' && value) { const { x, y, ...semantic } = value; return semantic; }
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

/** Sources are already normalized by semanticEvidence. Repeated sources are ambiguous. */
export function pairedImages(difference) {
  if (difference?.key !== 'images' || !Array.isArray(difference.reference) || !Array.isArray(difference.candidate)) return [];
  const pairs = [];
  difference.reference.forEach((before, referenceIndex) => {
    if (!before.src || difference.reference.filter(v => v.src === before.src).length !== 1) return;
    const candidates = difference.candidate.map((v, i) => ({ v, i })).filter(({ v }) => v.src === before.src);
    if (candidates.length !== 1) return;
    const { v: after, i: candidateIndex } = candidates[0];
    const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map(key => ({ key, before: before[key], after: after[key] }));
    // Pure movement stays in visual/layout evidence, as before.
    if (!changes.some(c => !['x', 'y'].includes(c.key))) return;
    pairs.push({ referenceIndex, candidateIndex, src: before.src, changes,
      altOnly: changes.length === 1 && changes[0].key === 'alt' });
  });
  return pairs;
}

export function renderElements(result) {
  const differences = new Map(result.differences.filter(d => d.comparison !== 'unavailable').map(d => [d.key, d]));
  const changed = new Set(differences.keys());
  const imageDifference = differences.get('images');
  const mapped = imageDifference && ['reference', 'candidate'].every(side =>
    Array.isArray(imageDifference[side]) && result[side]?.elements?.findings?.find(f => f.id === 'images')?.nodes.length === imageDifference[side].length);
  const pairs = mapped ? pairedImages(imageDifference) : [];
  const paired = pairs.map(pair => {
    const attributes = pair.changes.map(c => `<li><strong>${esc(c.key)}</strong><pre>- ${esc(c.before ?? '(absent)')}\n+ ${esc(c.after ?? '(absent)')}</pre></li>`).join('');
    const evidence = ['reference', 'candidate'].map(side => {
      const capture = result[side].elements;
      const node = capture.findings.find(f => f.id === 'images').nodes[pair[side + 'Index']];
      return `<details><summary>${side} element</summary><code>${esc(node.target.join(' → '))}</code><pre>${esc(node.html)}</pre>${pair.altOnly ? '' : highlight(capture, node)}</details>`;
    }).join('');
    return `<details open><summary>${pair.altOnly ? 'Image alternative text changed' : 'Image attributes changed'}</summary><p>Matched by unique source: <code>${esc(pair.src)}</code></p><ul>${attributes}</ul>${pair.altOnly ? '<p>Only alternative text changed; no screenshot is needed for this attribute difference.</p>' : ''}${evidence}</details>`;
  }).join('');
  const sides = ['reference', 'candidate'].map(side => {
    const evidence = result[side].elements;
    const findings = evidence?.findings?.filter(f => changed.has(f.id) || !['images', 'forms', 'emptyLinks'].includes(f.id)).map(f => {
      const difference = differences.get(f.id);
      if (!difference) return f;
      const indexes = changedElementIndexes(difference);
      if (!indexes || f.nodes.length !== difference[side].length) return f;
      return { ...f, nodes: f.nodes.filter((_, index) => indexes[side].has(index) && !(f.id === 'images' && pairs.some(p => p[side + 'Index'] === index))), changedOnly: true };
    }).filter(f => f.nodes.length) ?? [];
    if (!findings.length) return '';
    return `<h4>${side}</h4>${evidence.captureError ? `<p>${esc(evidence.captureError)}</p>` : ''}${findings.map(f => `<details><summary>${esc(f.id)} · ${f.nodes.length} ${f.changedOnly ? 'changed or unmatched' : 'captured'} element(s)${f.suppressed ? ' · suppressed' : ''}</summary>
${f.message ? `<p>${esc(f.message)}</p>` : (f.changedOnly ? '<p>Elements with no equal comparison value on the other side. These may be changed, added or removed; no one-to-one match is assumed. Position-only movement is retained in visual/layout evidence, not this image-content panel.</p>' : '<p>Captured group retained because comparison mapping is unavailable; inclusion does not establish that each element changed.</p>')}
${f.omittedNodes ? `<p>${f.omittedNodes} further possible contributors omitted from highlights.</p>` : ''}
${f.nodes.map((n, i) => `<details><summary>Element ${i + 1}${n.text ? ': ' + esc(n.text) : ''}</summary><p><strong>Selector:</strong> <code>${esc(n.target.join(' → '))}</code></p><pre>${esc(n.html)}</pre>${n.htmlTruncated ? '<p>HTML excerpt truncated at 6,000 characters.</p>' : ''}${n.dimensions ? `<pre>${esc(JSON.stringify(n.dimensions, null, 2))}</pre>` : ''}${highlight(evidence, n)}</details>`).join('')}</details>`).join('')}`;
  }).join('');
  return sides || paired ? `<section class="a11y-evidence"><h3>Images, links and forms: element details</h3>${paired}${sides}</section>` : '';
}
