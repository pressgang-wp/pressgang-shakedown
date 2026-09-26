import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVisual } from '../../lib/report-review.mjs';
const visual = { engine: 'Playwright', changed: true, dimensions: [{ width: 1280, height: 5927 }, { width: 1280, height: 5948 }], screenshot: 'diff.png', report: 'diff-playwright/index.html' };
test('visual mismatch opens human review with native diagnostics secondary', () => {
  const html = renderVisual(visual, 'reference.png', 'candidate.png');
  assert.match(html, /Appearance changed — review required/);
  assert.match(html, /21 pixels taller/);
  assert.match(html, /<details open><summary>Side by side/);
  assert.match(html, /<summary>Diff/);
  assert.match(html, /Comparison slider/);
  assert.match(html, /<details><summary>Technical details/);
  assert.match(html, /width="1280" height="5927"/);
  assert.match(html, /width="1280" height="5948"/);
});
test('capture errors cannot masquerade as a match or visual change', () => {
  const html = renderVisual({ ...visual, unavailable: '<capture failed>' });
  assert.match(html, /Comparison unavailable/);
  assert.match(html, /&lt;capture failed&gt;/);
  assert.doesNotMatch(html, /No visual change detected|Appearance changed/);
});
test('matched and legacy captures remain readable and artifact links are restricted', () => {
  assert.match(renderVisual({ ...visual, changed: false }), /No visual change detected/);
  assert.match(renderVisual({ percent: 5, screenshot: 'diff.png' }), /Appearance changed/);
  assert.doesNotMatch(renderVisual({ ...visual, report: 'javascript:alert(1)', screenshot: '../secret.png' }, 'https://bad.test/x', 'candidate.png'), /href="(?:javascript:|\.\.\/|https:)/);
});
