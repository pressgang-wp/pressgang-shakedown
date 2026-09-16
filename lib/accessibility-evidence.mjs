/** Capture geometry and an unaltered page image; report overlays never touch the tested DOM. */
import { basename } from 'node:path';

export async function locateAccessibilityNode(page, target) {
  // Axe uses nested selector arrays for shadow roots and multiple top-level
  // entries for frames. Frames are excluded by our axe setup; never guess one.
  if (!Array.isArray(target) || target.length !== 1) return { unavailable: 'Frame or unsupported selector path; inspect the selector manually.' };
  const selectors = Array.isArray(target[0]) ? target[0] : [target[0]];
  if (!selectors.length || selectors.some(s => typeof s !== 'string' || !s)) return { unavailable: 'No usable element selector.' };
  try {
    let locator = page.locator(selectors[0]);
    for (const selector of selectors.slice(1)) locator = locator.locator(selector);
    const count = await locator.count();
    if (count !== 1) return { unavailable: count ? 'Selector matches multiple elements; highlight omitted.' : 'Element no longer exists at capture time.' };
    return await locator.evaluate(element => {
      const r = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (!r.width || !r.height || !element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
        return { unavailable: 'Element has no visible box at capture time.' };
      }
      return { box: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } };
    }, undefined, { timeout: 1000 });
  } catch {
    return { unavailable: 'Element could not be located at capture time; inspect the selector manually.' };
  }
}

export async function captureAccessibilityEvidence(page, findings, path, options = {}) {
  const evidence = { url: page.url(), findings };
  if (!findings.length) return evidence;
  try {
    for (const finding of findings) for (const node of finding.nodes) {
      node.highlight = await locateAccessibilityNode(page, node.target);
    }
    // CSS pixels keep browser geometry and image coordinates aligned even at DPR 2.
    const png = await page.screenshot({ ...options, path, fullPage: true, scale: 'css', animations: 'disabled' });
    evidence.screenshot = basename(path);
    evidence.width = png.readUInt32BE(16);
    evidence.height = png.readUInt32BE(20);
  } catch (error) {
    evidence.captureError = `Screenshot evidence unavailable: ${error.message.split('\n')[0]}`;
  }
  return evidence;
}
