import test from 'node:test';
import assert from 'node:assert/strict';
import { changedElementIndexes, renderElements } from '../../lib/element-report.mjs';

const image = (src, y = 0) => ({ src, width: 100, height: 50, x: 0, y });
const indexes = (key, reference, candidate) => {
  const result = changedElementIndexes({ key, reference, candidate });
  return { reference: [...result.reference], candidate: [...result.candidate] };
};

test('insertions, deletions and reordering do not cascade to unchanged elements', () => {
  const a = image('a'), b = image('b'), c = image('c');
  assert.deepEqual(indexes('images', [a, b], [c, b, a]), { reference: [], candidate: [0] });
  assert.deepEqual(indexes('images', [c, a, b], [b, a]), { reference: [0], candidate: [] });
  assert.deepEqual(indexes('forms', [{ action: '/a' }, { action: '/b' }], [{ action: '/b' }, { action: '/a' }]), { reference: [], candidate: [] });
});

test('duplicate counts survive matching and unmatched replacements are not paired', () => {
  const a = image('a');
  assert.deepEqual(indexes('images', [a, a], [a]), { reference: [1], candidate: [] });
  assert.deepEqual(indexes('images', [a], [a, a]), { reference: [], candidate: [1] });
  assert.deepEqual(indexes('images', [image('old')], [image('new')]), { reference: [0], candidate: [0] });
});

test('image movement remains evidence alongside source changes; link movement does not', () => {
  assert.deepEqual(indexes('images', [image('a'), image('old')], [image('a', 20), image('new')]), { reference: [0, 1], candidate: [0, 1] });
  assert.deepEqual(indexes('emptyLinks', [{ text: 'a', y: 0 }, { text: 'b' }], [{ text: 'b' }, { text: 'a', y: 20 }]), { reference: [], candidate: [] });
});

test('legacy and mismatched evidence arrays retain captures with an honest explanation', () => {
  const node = { target: ['img'], html: '<img>' };
  for (const difference of [{ key: 'images' }, { key: 'images', reference: [], candidate: [] }]) {
    const html = renderElements({ differences: [difference], reference: { elements: { findings: [{ id: 'images', nodes: [node] }] } }, candidate: {} });
    assert.match(html, /1 captured element/);
    assert.match(html, /inclusion does not establish/);
  }
});
