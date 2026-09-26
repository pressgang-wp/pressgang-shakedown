import test from 'node:test';
import assert from 'node:assert/strict';
import { compactAdvisories, technicalDelta, transportDetails } from '../../lib/report-compact.mjs';

test('repeated advisory projections preserve raw data and suppression boundaries', () => {
  const finding = { id: 'image-aspect-ratio', message: 'Logo distortion', nodes: [{ target: ['footer img'], dimensions: { renderedWidth: 133 }, highlight: { box: { y: 20 } } }] };
  const row = (path, f) => ({ path, viewport: 'desktop', candidate: { advisory: [f.message], elements: { findings: [f] } } });
  const run = { results: [row('/a', finding), row('/b', { ...finding, nodes: [{ ...finding.nodes[0], highlight: { box: { y: 900 } } }] }), row('/c', { ...finding, suppressed: true })] };
  const raw = JSON.stringify(run);
  const compact = compactAdvisories(run);
  assert.equal(compact.groups.length, 1);
  assert.equal(compact.groups[0].members.length, 2);
  assert.equal(compact.results[0].candidate.elements.findings.length, 0);
  assert.equal(compact.results[2].candidate.elements.findings.length, 1);
  assert.equal(JSON.stringify(run), raw);
});

test('transport panels exclude successful capture bookkeeping but retain limitations', () => {
  assert.equal(transportDetails({ candidate: { blocked: [], advisory: [], lazyLoading: { steps: 7, reachedBottom: true, pendingImages: [] } } }), null);
  assert.ok(transportDetails({ candidate: { lazyLoading: { reachedBottom: false } } }));
  assert.ok(transportDetails({ reference: { blocked: ['GET embed'] } }));
});

test('technical delta omits unchanged values and position-only image movement without mutating input', () => {
  const d = { key: 'images', reference: [{ src: 'same', y: 1 }, { src: 'old' }], candidate: [{ src: 'new' }, { src: 'same', y: 90 }] };
  assert.deepEqual(technicalDelta(d).reference, [{ src: 'old' }]);
  assert.deepEqual(technicalDelta(d).candidate, [{ src: 'new' }]);
  assert.equal(d.reference.length, 2);
});
