import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectElements, applyImagePolicy } from '../../lib/element-evidence.mjs';
import { captureAccessibilityEvidence } from '../../lib/accessibility-evidence.mjs';
import { semanticEvidence } from '../../lib/regression-browser.mjs';
import { compareEvidence } from '../../lib/regression-plan.mjs';
import { renderElements } from '../../lib/element-report.mjs';

test('missing sources, distortion and overflow have actionable evidence without treating cropping or clipped carousels as failures', async () => {
  const browser = await chromium.launch();
  const dir = mkdtempSync(join(tmpdir(), 'shakedown-elements-'));
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>');
    await page.setContent(`<style>img{width:100px;height:100px}.clipped{width:200px;overflow:hidden}.wide{width:2000px}</style><main>
    <img id="missing" alt="Missing"><img id="stretched" src="${src}"><img id="crop" style="object-fit:cover" src="${src}"><img style="width:100px;height:50px" srcset="${src} 1x">
    <div class="clipped"><div class="wide">Carousel slides</div></div><a href="">Newsletter</a><form><select name="topic"><option>Health</option></select></form></main>`);
    await page.waitForFunction(() => [...document.images].every(i => i.complete));
    const before = await semanticEvidence(page);
    const data = await collectElements(page);
    assert.deepEqual(data.issues.map(f => f.id), ['missing-image-source', 'image-aspect-ratio']);
    assert.equal(data.issues[0].blocking, true);
    assert.equal(data.issues[1].blocking, false);
    const policy = applyImagePolicy(data.issues, { imageIssues: ['missing-image-source'] });
    assert.equal(policy[0].suppressed, true);
    assert.equal(policy[1].suppressed, false);
    const evidence = await captureAccessibilityEvidence(page, [...data.findings, ...policy], join(dir, 'elements.png'));
    assert.ok(evidence.width >= 800);
    assert.ok(evidence.findings.every(f => f.nodes.every(n => n.highlight.box)));
    const html = renderElements({ differences: [{ key: 'forms' }, { key: 'emptyLinks' }], reference: {}, candidate: { elements: evidence } });
    assert.match(html, /Newsletter/);
    assert.match(html, /&lt;select/);
    assert.match(html, /<svg/);
    assert.match(html, /suppressed/);
    await page.locator('a').evaluate(el => el.style.marginLeft = '20px');
    const after = await semanticEvidence(page);
    assert.ok(!compareEvidence(before, after, '/').some(d => d.key === 'emptyLinks'));
    await page.locator('.clipped').evaluate(el => el.style.overflow = 'visible');
    const overflow = (await collectElements(page)).issues.find(f => f.id === 'horizontal-overflow');
    assert.ok(overflow.nodes.length);
    assert.match(overflow.message, /possible contributors/);
    await page.locator('#missing').evaluate(el => el.style.display = 'none');
    assert.ok(!(await collectElements(page)).issues.some(f => f.id === 'missing-image-source'));
    await page.locator('#stretched').evaluate(el => el.src = 'data:image/png;base64,broken');
    await page.waitForFunction(() => document.querySelector('#stretched').complete);
    const broken = (await collectElements(page)).issues.find(f => f.id === 'broken-image');
    assert.ok(broken.blocking && broken.nodes[0].html.includes('stretched'));
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});
