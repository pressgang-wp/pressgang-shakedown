import { changedElementIndexes } from './element-report.mjs';

/** Reviewer-only projections. Never mutate the saved run or its verdicts. */
export function technicalDelta(difference) {
  const indexes = changedElementIndexes(difference);
  if (!indexes) return difference;
  return { ...difference,
    reference: difference.reference.filter((_, i) => indexes.reference.has(i)),
    candidate: difference.candidate.filter((_, i) => indexes.candidate.has(i)),
    note: 'Unmatched comparison values, not assumed element pairs. Equal values omitted; full evidence is in run.json. Image positions remain in raw/visual evidence.' };
}

export function compactAdvisories(run) {
  const groups = new Map();
  const key = finding => JSON.stringify([finding.id, finding.message, !!finding.suppressed,
    finding.nodes?.map(n => [n.target, n.dimensions])]);
  for (const [index, r] of run.results.entries()) {
    for (const f of r.candidate?.elements?.findings ?? []) {
      if (f.id !== 'image-aspect-ratio' || f.blocking) continue;
      const signature = key(f);
      const group = groups.get(signature) ?? { finding: f, representative: index, members: [] };
      group.members.push({ index, path: r.path, viewport: r.viewport });
      groups.set(signature, group);
    }
  }
  const repeated = [...groups.values()].filter(g => g.members.length > 1);
  const repeatedKeys = new Set(repeated.map(g => key(g.finding)));
  const results = run.results.map(r => {
    const hidden = (r.candidate?.elements?.findings ?? []).filter(f => repeatedKeys.has(key(f)));
    const messages = new Set(hidden.map(f => f.message));
    return { ...r, candidate: { ...r.candidate,
      advisory: r.candidate?.advisory?.filter(m => !messages.has(m)),
      elements: r.candidate?.elements && { ...r.candidate.elements,
        findings: r.candidate.elements.findings.filter(f => !repeatedKeys.has(key(f))) } } };
  });
  return { groups: repeated, results };
}

export function transportDetails(r) {
  const details = {};
  for (const side of ['reference', 'candidate']) {
    const evidence = r[side] ?? {}, fields = {};
    if (evidence.blocked?.length) fields.blocked = evidence.blocked;
    if (evidence.advisory?.length) fields.advisory = evidence.advisory;
    const lazy = evidence.lazyLoading;
    if (lazy && (lazy.reachedBottom === false || lazy.pendingImages?.length || lazy.error)) fields.lazyLoading = lazy;
    if (Object.keys(fields).length) details[side] = fields;
  }
  return Object.keys(details).length ? details : null;
}
