import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessibilityFindings } from '../../lib/health.mjs';
import { captureAccessibilityEvidence, locateAccessibilityNode } from '../../lib/accessibility-evidence.mjs';
import { renderAccessibilityEvidence, accessibilityStyles } from '../../lib/accessibility-report.mjs';

test('axe retains element reasons and contrast, with aligned screenshot locations and disclosed missing targets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shakedown-a11y-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.setContent('<html lang="en"><title>Evidence</title><main><h1>Fixture</h1><p id="contrast" style="margin-top:800px;color:#aaa;background:white">Low contrast text</p><button></button><div id="host"></div></main></html>');
    await page.locator('#host').evaluate(e => { e.attachShadow({mode:'open'}).innerHTML = '<button id="shadow">Shadow button</button>'; });
    const findings = await accessibilityFindings(page, {});
    const contrast = findings.find(f => f.id === 'color-contrast');
    assert.ok(contrast.nodes.find(n => n.target.includes('#contrast')));
    assert.ok(contrast.nodes[0].checks.any.some(c => c.data.contrastRatio));
    assert.ok(findings.find(f => f.id === 'button-name').nodes[0].html.includes('button'));
    const evidence = await captureAccessibilityEvidence(page, findings, join(dir, 'page.png'));
    assert.equal(evidence.width, 800);
    assert.ok(evidence.height > 800);
    assert.ok(contrast.nodes[0].highlight.box.y > 600);
    assert.ok((await locateAccessibilityNode(page, [['#host', '#shadow']])).box);
    assert.match((await locateAccessibilityNode(page, ['#missing'])).unavailable, /no longer exists/);
    assert.match((await locateAccessibilityNode(page, ['button'])).unavailable, /multiple/);
    const suppressed = await accessibilityFindings(page, { a11yRules: ['color-contrast'] });
    assert.ok(!suppressed.some(f => f.id === 'color-contrast'));
    const html = '<style>' + accessibilityStyles + '</style>' + renderAccessibilityEvidence(evidence);
    assert.match(html, /Show location on full page/);
    assert.match(html, /&lt;button/);
    assert.ok(!html.includes('<button'));
    writeFileSync(join(dir, 'index.html'), html);
    await page.goto('file://' + join(dir, 'index.html'));
    await page.locator('details').evaluateAll(nodes => nodes.forEach(n => n.open = true));
    assert.ok(await page.locator('svg rect').count() > 0);
    assert.equal(await page.locator('svg image').first().getAttribute('href'), 'page.png');
    assert.ok(readFileSync(join(dir, 'page.png')).length > 1000);
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});
