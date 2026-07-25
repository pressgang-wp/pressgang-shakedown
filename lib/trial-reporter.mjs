/**
 * Trial Report reporter: turns a run into a client-readable, self-contained
 * HTML page (route × pass matrix, summary, plain-English failures) plus a
 * machine-readable run.json — the QA handover artifact, distinct from
 * Playwright's developer report (traces and stack dumps stay dev-side).
 *
 * Written to <workspace>/.shakedown/{run.json, trial-report.html}.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PASS_NAMES = { '00': 'Availability', '01': 'Integrity', '02': 'Accessibility', '03': 'Visual' };

export default class TrialReporter {
  constructor() {
    this.workspace = process.env.SHAKEDOWN_WORKSPACE ?? process.cwd();
    this.results = new Map(); // test.id → route identity + the TestCase
    this.unreported = new Set(); // test.id of everything this report omits
    this.started = new Date();
  }

  onTestEnd(test) {
    const match = test.title.match(/^(\d\d) (\S+) (\S+)$/);
    if (!match) {
      // Journeys and other suites: v1 reports derived passes only. Counted so
      // an otherwise-empty report can say what DID run instead of implying
      // nothing happened.
      this.unreported.add(test.id);
      return;
    }

    // Fires once per ATTEMPT, so retries collapse onto one entry by test.id.
    // Deliberately keeps the TestCase rather than this attempt's result: a
    // retried route ends on a PASS, so recording the latest attempt reports a
    // route that failed and was retried as if it had been green all along.
    // The verdict needs every attempt, so it is computed in onEnd().
    this.results.set(test.id, { pass: match[1], kind: match[2], url: match[3], test });
  }

  /**
   * Always writes, even with nothing to report. Bailing out on an empty run
   * used to leave the PREVIOUS run's report in place, and nothing about it
   * said so — a red run that died before testing, or a filter that matched no
   * route, would hand the reader last week's green report as if it were this
   * one. A report that says "nothing ran" is the honest artifact; a stale one
   * that looks current is worse than none.
   */
  onEnd() {
    const entries = [...this.results.values()].map(({ test, ...route }) => ({ ...route, ...verdict(test) }));

    let target = {};
    try {
      const m = JSON.parse(readFileSync(join(this.workspace, '.shakedown', 'matrix.json'), 'utf8'));
      target = { name: m.target, baseUrl: m.baseUrl };
    } catch {
      // matrix metadata is decoration; the report stands without it
    }

    const run = {
      generated: this.started.toISOString(),
      target,
      results: entries,
      unreported: this.unreported.size,
    };
    const dir = join(this.workspace, '.shakedown');
    mkdirSync(dir, { recursive: true });

    const screenshots = this.collectScreenshots(entries, dir);

    writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
    writeFileSync(join(dir, 'trial-report.html'), render(run, screenshots));
    console.log(`\n⚓ Trial report: ${join(dir, 'trial-report.html')}`);
  }

  /**
   * Copy each route's pass-03 baseline into .shakedown/screenshots/ so the
   * report and its images travel together (artifacts, zips, client emails).
   *
   * @returns {Map<string, string>} route url → report-relative image path.
   */
  collectScreenshots(entries, reportDir) {
    const root = join(this.workspace, 'tests', '__screenshots__');
    const shots = new Map();

    if (!existsSync(root)) return shots;
    const platform = readdirSync(root).find((d) => !d.startsWith('.'));
    if (!platform) return shots;

    mkdirSync(join(reportDir, 'screenshots'), { recursive: true });

    for (const entry of entries) {
      if (shots.has(entry.url)) continue;
      // Mirrors snapshotName() in passes/03-visual.spec.mjs — keep in sync.
      const path = new URL(entry.url).pathname.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home';
      const name = `${entry.kind.replace(/\W+/g, '-')}--${path}.png`;
      const source = join(root, platform, name);

      if (existsSync(source)) {
        cpSync(source, join(reportDir, 'screenshots', name));
        shots.set(entry.url, `screenshots/${name}`);
      }
    }

    return shots;
  }
}

/**
 * The final verdict for one route × pass, once every attempt is in.
 *
 * `TestResult.status` is per-attempt and never reports flakiness — that lives
 * on `TestCase.outcome()`, which is only meaningful after the last retry. A
 * flaky route is called out rather than folded into the passes: on a shared
 * server a retry legitimately absorbs load transients, but it can equally hide
 * a race in the theme, and the client's report should not quietly decide which.
 *
 * @param {import('@playwright/test/reporter').TestCase} test
 * @returns {{outcome: string, attempts: number, error: string|null}}
 *     outcome is Playwright's: 'expected' | 'unexpected' | 'flaky' | 'skipped'.
 */
function verdict(test) {
  // The first failing attempt carries the useful message; for a flaky route the
  // LAST attempt passed and has no error at all, which is precisely the
  // evidence that was being dropped.
  const failed = test.results.find((r) => r.status === 'failed' || r.status === 'timedOut');

  return {
    outcome: test.outcome(),
    attempts: test.results.length,
    error: failed?.error ? String(failed.error.message ?? '').split('\n')[0].slice(0, 300) : null,
  };
}

/**
 * @param {{generated: string, target: object, results: array}} run
 * @param {Map<string, string>} screenshots route url → relative image path.
 * @returns {string} HTML (images referenced from the sibling screenshots/ dir).
 */
function render(run, screenshots = new Map()) {
  const passes = [...new Set(run.results.map((r) => r.pass))].sort();
  const routes = new Map();
  for (const r of run.results) {
    if (!routes.has(r.url)) routes.set(r.url, { kind: r.kind, url: r.url, cells: {} });
    routes.get(r.url).cells[r.pass] = r;
  }

  const total = run.results.length;
  const failed = run.results.filter((r) => r.outcome === 'unexpected');
  const flaky = run.results.filter((r) => r.outcome === 'flaky');
  const skipped = run.results.filter((r) => r.outcome === 'skipped').length;
  // Flaky is its own column: "passed" here means passed first time, every time.
  const passedCount = total - failed.length - flaky.length - skipped;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mark = (r) =>
    !r ? '<td class="na">–</td>'
    : r.outcome === 'expected' ? '<td class="ok">✓</td>'
    : r.outcome === 'flaky' ? `<td class="flaky" title="failed, then passed on retry (${r.attempts} attempts)">⚠</td>`
    : r.outcome === 'skipped' ? '<td class="na">–</td>'
    : '<td class="bad">✗</td>';

  const hasShots = screenshots.size > 0;
  const rows = [...routes.values()]
    .map((route) => {
      const path = new URL(route.url).pathname + (new URL(route.url).search || '');
      const shot = screenshots.get(route.url);
      const preview = !hasShots ? ''
        : shot ? `<td class="shot"><a href="${esc(shot)}"><img src="${esc(shot)}" alt="${esc(route.kind)}" loading="lazy"></a></td>`
        : '<td class="shot"></td>';
      return `<tr>${preview}<td class="kind">${esc(route.kind)}</td><td class="url">${esc(path)}</td>${passes.map((p) => mark(route.cells[p])).join('')}</tr>`;
    })
    .join('\n');

  const item = (f, note = '') =>
    `<li><strong>${esc(PASS_NAMES[f.pass] ?? f.pass)}</strong> — ${esc(f.kind)} <code>${esc(new URL(f.url).pathname)}</code>${note}<br>${esc(f.error ?? '')}</li>`;

  const failures = failed.map((f) => item(f)).join('\n');
  const flakes = flaky
    .map((f) => item(f, ` <span class="meta">— passed on attempt ${f.attempts} of ${f.attempts}</span>`))
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
  td.flaky { color: #a8730a; font-weight: 700; }
  td.kind { font-family: ui-monospace, monospace; font-size: .75rem; white-space: nowrap; }
  td.shot img { width: 96px; max-height: 64px; object-fit: cover; object-position: top; border: 1px solid #dde2dc; display: block; }
  td.url { font-family: ui-monospace, monospace; font-size: .75rem; word-break: break-all; }
  ul.failures li { margin-bottom: .7rem; } code { background: #eef1eb; padding: 0 .3em; }
</style>
<h1>⚓ Trial Report — ${esc(run.target.name ?? 'shakedown')}</h1>
<p class="meta">${esc(run.target.baseUrl ?? '')} · generated ${esc(run.generated)}</p>
<div class="strip">
  <div class="stat"><b>${routes.size}</b><span>routes</span></div>
  <div class="stat"><b>${passedCount}</b><span>checks passed</span></div>
  <div class="stat"><b>${failed.length}</b><span>failed</span></div>
  ${flaky.length ? `<div class="stat"><b>${flaky.length}</b><span>flaky</span></div>` : ''}
  <div class="stat"><b>${skipped}</b><span>skipped</span></div>
</div>
${total === 0 ? '' : `<table>
  <tr>${hasShots ? '<th>Preview</th>' : ''}<th>Kind</th><th>Route</th>${passes.map((p) => `<th>${esc(PASS_NAMES[p] ?? p)}</th>`).join('')}</tr>
  ${rows}
</table>`}
${failed.length ? `<h2>Failures</h2><ul class="failures">${failures}</ul>` : ''}
${flaky.length ? `<h2>⚠ Passed only on retry</h2>
<p class="meta">These went green on a second attempt. On a shared server a retry
absorbs load transients, but the same signature can mean a race in the theme —
the first failure is shown so it can be judged rather than assumed.</p>
<ul class="failures">${flakes}</ul>` : ''}
${total === 0 ? `<h2>No checks ran</h2>
<p>This run recorded no derived checks, so there is nothing to report.${run.unreported
  ? ` ${run.unreported} test${run.unreported === 1 ? '' : 's'} from another suite (journeys) did run — those are not covered by this report.`
  : ''}</p>
<p class="meta">Usually a filter that matched no route, an empty route matrix, or
a run that stopped before testing began. This page deliberately replaces any
earlier report rather than leaving one that looks current.</p>` : ''}
${total > 0 && !failed.length && !flaky.length ? '<p><strong>All checks passed.</strong></p>' : ''}
`;
}
