/** Shared, escaped HTML evidence for both report types. No scripts or live-page mutation. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
const webLink = value => {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? esc(u.href) : null; }
  catch { return null; }
};
const imagePath = value => typeof value === 'string' && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.png$/.test(value) && !value.split('/').includes('..') ? esc(value) : null;

export const accessibilityStyles = `
.a11y-evidence{margin:16px 0}.a11y-evidence details{margin:10px 0;padding:10px;border:1px solid #ccd3df;border-radius:4px;background:#fff}
.a11y-evidence summary{cursor:pointer;font-weight:600}.a11y-evidence pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
.a11y-evidence p{overflow-wrap:anywhere}.a11y-evidence svg{display:block;width:100%;height:auto;max-height:600px;background:#eef1f5}
.a11y-evidence .a11y-note{color:#4b5563;font-size:14px}.a11y-evidence figure{margin:12px 0}.a11y-evidence figcaption{font-size:14px}
`;

function highlight(evidence, node) {
  const src = imagePath(evidence.screenshot), b = node.highlight?.box;
  const w = evidence.width, h = evidence.height;
  if (!src || !b || ![w, h, b.x, b.y, b.width, b.height].every(Number.isFinite) || w <= 0 || h <= 0 || b.width <= 0 || b.height <= 0) {
    return `<p class="a11y-note">Highlight unavailable: ${esc(node.highlight?.unavailable ?? evidence.captureError ?? 'No screenshot geometry was retained.')}</p>`;
  }
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  const right = Math.min(w, b.x + b.width), bottom = Math.min(h, b.y + b.height);
  if (right <= x || bottom <= y) return '<p class="a11y-note">Highlight unavailable: element is outside the captured image.</p>';
  const cx = Math.max(0, x - 32), cy = Math.max(0, y - 32);
  const cw = Math.min(w - cx, Math.max(280, right - cx + 32));
  const ch = Math.min(h - cy, Math.max(120, bottom - cy + 32));
  const svg = view => `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Failing element outlined on the captured page" viewBox="${view}"><image href="${src}" width="${w}" height="${h}"/><rect x="${x}" y="${y}" width="${right - x}" height="${bottom - y}" fill="none" stroke="white" stroke-width="6" vector-effect="non-scaling-stroke"/><rect x="${x}" y="${y}" width="${right - x}" height="${bottom - y}" fill="none" stroke="#b00020" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`;
  return `<figure>${svg(`${cx} ${cy} ${cw} ${ch}`)}<figcaption>Outlined element in the captured page. Geometry is measured at capture time.</figcaption></figure><details><summary>Show location on full page</summary>${svg(`0 0 ${w} ${h}`)}</details><p><a href="${src}">Open original screenshot</a></p>`;
}

export function renderAccessibilityEvidence(evidence) {
  if (!evidence?.findings?.length) return '';
  const pageLink = webLink(evidence.url);
  return `<section class="a11y-evidence"><h3>Accessibility: element details</h3>
<p>${pageLink ? `<a href="${pageLink}">Open tested page</a>. ` : ''}These findings describe the tested page, not a comparison with production. Expand a rule, then an element.</p>
${evidence.captureError ? `<p class="a11y-note">${esc(evidence.captureError)}</p>` : ''}
${evidence.findings.map(f => `<details><summary>${esc(f.impact)} · ${esc(f.id)} · ${f.nodes.length} element(s)${f.blocking ? '' : ' · advisory'}</summary>
<p>${esc(f.help ?? f.description)}</p>${webLink(f.helpUrl) ? `<p><a href="${webLink(f.helpUrl)}">Rule explanation</a></p>` : ''}
${f.nodes.map((n, index) => `<details><summary>Element ${index + 1}: ${esc(n.target?.flat().join(' → ') ?? 'selector unavailable')}</summary>
<p><strong>Selector</strong></p>${json(n.target)}<p><strong>Element HTML</strong></p><pre>${esc(n.html)}</pre>
<p><strong>Why it failed</strong></p><pre>${esc(n.failureSummary ?? 'See individual checks below.')}</pre>
${Object.entries(n.checks ?? {}).map(([group, checks]) => checks.length ? `<details><summary>Check evidence (${esc(group)})</summary>${checks.map(c => {
  const d = c.data;
  const contrast = c.id === 'color-contrast' && d ? `<p><strong>Contrast:</strong> ${esc(d.contrastRatio ?? 'not available')}${d.contrastRatio != null ? ':1' : ''}; required ${esc(d.expectedContrastRatio ?? 'not available')}. Foreground ${esc(d.fgColor ?? 'unknown')}; background ${esc(d.bgColor ?? 'unknown')}.</p>` : '';
  return `<p>${esc(c.message)}</p>${contrast}${d != null ? json(d) : ''}${c.relatedNodes?.length ? `<p>Related elements</p>${json(c.relatedNodes)}` : ''}`;
}).join('')}</details>` : '').join('')}
${highlight(evidence, n)}</details>`).join('')}</details>`).join('')}</section>`;
}
