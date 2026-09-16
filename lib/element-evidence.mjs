/** Location metadata lives outside semantic values: moving a link is not changing it. */
import { suppressed } from './suppress.mjs';

export async function collectElements(page, selectors = [], level = 'full', includeLazy = false) {
  return page.evaluate(({ selectors, level, includeLazy }) => {
    const selector = el => {
      const parts = [];
      for (let node = el; node?.nodeType === 1; node = node.parentElement) {
        const tag = node.localName;
        const siblings = node.parentElement ? [...node.parentElement.children].filter(n => n.localName === tag) : [node];
        parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
      }
      return parts.join(' > ');
    };
    const describe = el => {
      const r = el.getBoundingClientRect();
      // Keep evidence bounded and make truncation explicit; never compare this HTML.
      const html = el.outerHTML;
      return { target: [selector(el)], html: html.slice(0, 6000), htmlTruncated: html.length > 6000,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
        highlight: { box: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } } };
    };
    const ignored = el => selectors.some(s => el.matches(s) || el.closest(s));
    const all = s => [...document.querySelectorAll(s)].filter(el => !ignored(el));
    const findings = [];
    if (level !== 'errors') {
      findings.push({ id: 'forms', nodes: all('form').map(describe) });
      findings.push({ id: 'emptyLinks', nodes: all('a[href]').filter(el => !el.getAttribute('href').trim()).map(describe) });
      if (level === 'full') findings.push({ id: 'images', nodes: all('img').map(describe) });
    }
    const issues = [];
    for (const img of document.images) {
      const r = img.getBoundingClientRect(), css = getComputedStyle(img);
      if ((img.loading !== 'lazy' || (includeLazy && r.width > 0)) && img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src)) {
        const node = describe(img);
        issues.push({ id: 'broken-image', blocking: true, nodes: [node], message: `broken image: ${img.currentSrc || img.src}` });
      }
      if (!r.width || !r.height || css.visibility === 'hidden' || css.display === 'none' || css.opacity === '0') continue;
      const node = describe(img);
      node.dimensions = { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, renderedWidth: r.width, renderedHeight: r.height, objectFit: css.objectFit };
      if (!img.currentSrc && !img.getAttribute('src')?.trim() && !img.getAttribute('srcset')?.trim() && ![...(img.closest('picture')?.querySelectorAll('source[srcset]') ?? [])].some(source => source.getAttribute('srcset').trim())) {
        issues.push({ id: 'missing-image-source', blocking: true, nodes: [node], message: `Missing image source: ${node.target[0]}` });
      }
      // Use the content box, excluding padding/borders and transforms. Cropping
      // via object-fit is intentional; small icons and rounding are excluded.
      let w = parseFloat(css.width), h = parseFloat(css.height);
      if (css.boxSizing === 'border-box') {
        w -= ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((n, k) => n + parseFloat(css[k] || 0), 0);
        h -= ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((n, k) => n + parseFloat(css[k] || 0), 0);
      }
      if (img.naturalWidth && img.naturalHeight && w >= 32 && h >= 32 && css.objectFit === 'fill') {
        const expected = w * img.naturalHeight / img.naturalWidth;
        if (Math.abs(h - expected) > 2 && Math.abs(h / expected - 1) > 0.1) {
          issues.push({ id: 'image-aspect-ratio', blocking: false, nodes: [node], message: `Possible image distortion: ${img.currentSrc || img.src}; natural ${img.naturalWidth}×${img.naturalHeight}, content box ${w}×${h}` });
        }
      }
    }
    const width = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
    if (scrollWidth > width + 2) {
      const outside = [...document.querySelectorAll('body *')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > width + 2 && getComputedStyle(el).visibility !== 'hidden';
      });
      issues.push({ id: 'horizontal-overflow', blocking: false, message: `Horizontal page overflow: ${scrollWidth}px document in ${width}px viewport. Highlighted elements are possible contributors, not proven causes.`, nodes: outside.slice(0, 20).map(describe), omittedNodes: Math.max(0, outside.length - 20) });
    }
    return { findings: findings.filter(f => f.nodes.length), issues };
  }, { selectors, level, includeLazy });
}

export function applyImagePolicy(issues, ignore = {}) {
  return issues.map(f => ({ ...f, suppressed: suppressed(ignore.imageIssues, `${f.id}: ${f.message} ${f.nodes.map(n => n.target.join(' ')).join(' ')}`) }));
}
