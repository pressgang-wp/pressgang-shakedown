/**
 * Trial Report reporter: turns a run into a client-readable, self-contained
 * HTML page (route × pass matrix, summary, plain-English failures) plus a
 * machine-readable run.json — the QA handover artifact, distinct from
 * Playwright's developer report (traces and stack dumps stay dev-side).
 *
 * Written to <workspace>/.shakedown/{run.json, trial-report.html}.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PASS_NAMES = { '00': 'Availability', '01': 'Integrity', '02': 'Accessibility', '03': 'Visual' };

export default class TrialReporter {
  constructor() {
    this.workspace = process.env.SHAKEDOWN_WORKSPACE ?? process.cwd();
    this.results = new Map(); // test.id → latest attempt
    this.started = new Date();
  }

  onTestEnd(test, result) {
    const match = test.title.match(/^(\d\d) (\S+) (\S+)$/);
    if (!match) return; // journeys and other suites: v1 reports derived passes only

    this.results.set(test.id, {
      pass: match[1],
      kind: match[2],
      url: match[3],
      status: result.status,
      error: result.error ? String(result.error.message ?? '').split('\n')[0].slice(0, 300) : null,
    });
  }

  onEnd() {
    const entries = [...this.results.values()];
    if (entries.length === 0) return;

    let target = {};
    try {
      const m = JSON.parse(readFileSync(join(this.workspace, '.shakedown', 'matrix.json'), 'utf8'));
      target = { name: m.target, baseUrl: m.baseUrl };
    } catch {
      // matrix metadata is decoration; the report stands without it
    }

    const run = { generated: this.started.toISOString(), target, results: entries };
    const dir = join(this.workspace, '.shakedown');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
    writeFileSync(join(dir, 'trial-report.html'), render(run));
    console.log(`\n⚓ Trial report: ${join(dir, 'trial-report.html')}`);
  }
}

/**
 * @param {{generated: string, target: object, results: array}} run
 * @returns {string} Self-contained HTML.
 */
function render(run) {
  const passes = [...new Set(run.results.map((r) => r.pass))].sort();
  const routes = new Map();
  for (const r of run.results) {
    if (!routes.has(r.url)) routes.set(r.url, { kind: r.kind, url: r.url, cells: {} });
    routes.get(r.url).cells[r.pass] = r;
  }

  const total = run.results.length;
  const failed = run.results.filter((r) => r.status === 'failed' || r.status === 'timedOut');
  const skipped = run.results.filter((r) => r.status === 'skipped').length;
  const passedCount = total - failed.length - skipped;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mark = (r) =>
    !r ? '<td class="na">–</td>'
    : r.status === 'passed' || r.status === 'flaky' ? '<td class="ok">✓</td>'
    : r.status === 'skipped' ? '<td class="na">–</td>'
    : '<td class="bad">✗</td>';

  const rows = [...routes.values()]
    .map((route) => {
      const path = new URL(route.url).pathname + (new URL(route.url).search || '');
      return `<tr><td class="kind">${esc(route.kind)}</td><td class="url">${esc(path)}</td>${passes.map((p) => mark(route.cells[p])).join('')}</tr>`;
    })
    .join('\n');

  const failures = failed
    .map((f) => `<li><strong>${esc(PASS_NAMES[f.pass] ?? f.pass)}</strong> — ${esc(f.kind)} <code>${esc(new URL(f.url).pathname)}</code><br>${esc(f.error ?? '')}</li>`)
    .join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<title>Trial Report — ${esc(run.target.name ?? 'shakedown')}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; color: #1b2a32; }
  h1 { font-size: 1.4rem; } .meta { color: #5b6b72; font-size: .9rem; }
  .strip { display: flex; gap: 2rem; margin: 1.2rem 0; }
  .stat b { display: block; font-size: 1.6rem; font-variant-numeric: tabular-nums; }
  .stat span { color: #5b6b72; font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th, td { padding: .35rem .6rem; border-bottom: 1px solid #dde2dc; text-align: left; }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: #5b6b72; }
  td.ok { color: #2e7d4f; } td.bad { color: #b3453a; font-weight: 700; } td.na { color: #9aa7a0; }
  td.kind { font-family: ui-monospace, monospace; font-size: .75rem; white-space: nowrap; }
  td.url { font-family: ui-monospace, monospace; font-size: .75rem; word-break: break-all; }
  ul.failures li { margin-bottom: .7rem; } code { background: #eef1eb; padding: 0 .3em; }
</style>
<h1>⚓ Trial Report — ${esc(run.target.name ?? 'shakedown')}</h1>
<p class="meta">${esc(run.target.baseUrl ?? '')} · generated ${esc(run.generated)}</p>
<div class="strip">
  <div class="stat"><b>${routes.size}</b><span>routes</span></div>
  <div class="stat"><b>${passedCount}</b><span>checks passed</span></div>
  <div class="stat"><b>${failed.length}</b><span>failed</span></div>
  <div class="stat"><b>${skipped}</b><span>skipped</span></div>
</div>
<table>
  <tr><th>Kind</th><th>Route</th>${passes.map((p) => `<th>${esc(PASS_NAMES[p] ?? p)}</th>`).join('')}</tr>
  ${rows}
</table>
${failed.length ? `<h2>Failures</h2><ul class="failures">${failures}</ul>` : '<p><strong>All checks passed.</strong></p>'}
`;
}
