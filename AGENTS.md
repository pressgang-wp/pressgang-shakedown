# Shakedown Agent Guide

## What Shakedown Is

Shakedown is **end-to-end browser testing for PressGang WordPress themes, with
zero tests to write**. Because a PressGang theme declares its post types,
taxonomies, templates, and menus in `config/`, Shakedown derives the whole test
suite from the theme itself: it enumerates every route the site serves, then
checks each one in a real browser.

It runs in one of two **modes**:

- **Attached** — your live local site. Answers "is my site healthy right now?"
  **Strictly read-only** — it only ever GETs pages.
- **Sandbox** — a disposable throwaway WordPress. Answers "is my *theme* correct,
  independent of content?" This is the only mode that writes, and only to a
  database it proves is throwaway first.

Shakedown is a Node + Playwright tool. PHP appears only where it must run inside
WordPress (`bin/*.php`, `php/observer.php`), invoked via `wp eval-file`.

---

## Design Rules (Non-Negotiables)

- **Attached mode never writes.** It only issues GET requests against the
  developer's live site. Seeding, options, fixtures — none of it happens in
  attached mode.
- **The sandbox proves isolation before any test traffic.** Every boot answers
  `/?shakedown_whoami=1` with `ABSPATH`, `WP_CONTENT_DIR`, and the SQLite path;
  if any of them is not inside the temp dir, Shakedown kills the server and
  refuses to run. A sandbox that can reach the real site's config or database is
  never tested against.
- **Config-derived, never hand-written.** The route matrix, the fixtures, and the
  checks all come from the theme's own declarations — never a bespoke spec file
  or a database dump.
- **Suppression is declared and disclosed, never silent.** The strict gates need
  an escape hatch or they get switched off wholesale, so `ignore` in
  `shakedown.config.json` records findings already judged as not the theme's
  (`lib/suppress.mjs`). It declares no checks and invents no routes — it narrows
  existing ones. Every pattern is echoed at derive time and tabled in the trial
  report; a mistyped key throws rather than silently suppressing nothing. Never
  add a gate without a way to narrow it, and never narrow one without saying so.
- **Deterministic.** A fixed seed and epoch make fixtures byte-stable, so a visual
  snapshot diff means the *theme* changed, not the content. Never introduce
  ambient time or unseeded randomness into a fixture path.
- **Degrade gracefully.** Capstan absent → a bundled matrix fallback (minus the
  oracle). Muster absent → skip seeding, still run the derived passes. A theme
  with no fixtures still gets a full suite.
- **No site bundle.** No MySQL, no Docker, no `.sql` dump. The theme repo is the
  only input; the sandbox brings its own SQLite database and uploads.
- **Node ESM (`.mjs`).** Keep the runner in JS; reach for PHP only when the code
  must execute inside a booted WordPress.
- **`passes/` is the product; `tests/` is ours.** The shipped checks live in
  `passes/` (published, run against the consumer's site). This repo's own unit
  tests live in `tests/unit/` and are never published. Never put a unit test in
  `passes/`: Playwright's `testDir` scans it recursively, and a `node:test` file
  there executes during test *collection* — before any route is checked — which
  can abort the whole run. A third `tests/` exists and is not ours at all: the
  consumer theme's `tests/e2e/` journeys and `tests/__screenshots__/` baselines,
  always reached via `workspace`, never `pkgRoot`.

---

## Mental Model

- **Target** (`lib/target.mjs`)
  Resolves the site path, base URL, and `shakedown.config.json` for a run —
  including central mode, where one clone drives any registered `--target`.
- **Matrix** (`lib/derive.mjs`, `passes/matrix.mjs`)
  Every route the site serves: front page, each public post type's archive and
  sample singles, taxonomy term pages, pages per registered template, internal
  menu targets, a search probe, and a 404 probe. From `wp capstan matrix
  --resolve` (with the controller/template **oracle**) when Capstan is present,
  or a bundled fallback when it is not.
  **Supplementary families** (`bin/matrix-supplement.php`) add author and date
  archives, page 2, feeds, and an empty search. They live in their own script and
  are merged into whichever source produced the base matrix, because only the
  ORACLE should differ between Capstan and the fallback — never the coverage. Base
  routes win a URL collision (their labels are more specific), `ignore.routes`
  applies after the merge, and a route marked `html: false` (feeds) is checked by
  pass 00 but skipped by the browser passes via `browsableRoutes()`.
- **Sandbox** (`lib/sandbox.mjs`)
  A throwaway WordPress in a temp dir: core/theme/plugins symlinked **read-only**,
  its own SQLite database and uploads, WordPress install defaults cleared, then
  seeded, served by `wp server`, isolation-proven, and deleted after the run.
  Boot acquires two things — the temp tree and the server — and a single
  `destroy()` releases both, on the failure path, as the returned `stop()`, and
  from a `SIGINT`/`SIGTERM` handler (signals bypass `try`/`finally`, so Ctrl-C
  would otherwise leak both). The server is spawned `detached: true` and killed
  by **process group** (`process.kill(-pid)`) because `wp server` launches
  `php -S` as a child: signalling `wp` alone leaves the built-in server holding
  its port. `destroy()` also deregisters the handlers, so repeated boots don't
  stack listeners. Don't "tidy" any of that away — teardown stops working
  silently.
- **Seeding layers** (sandbox only, in order)
  1. **Theme baseline** — the theme's own Muster via `wp capstan seed`
     (`seedThemeMuster`), when the theme ships `muster/` seeders.
  2. **Derived ACF state fixtures** — populated + minimal per field group
     (`seedAcfStates` → `bin/seed-states.php`), where empty-link / missing-image
     bugs live.
  3. **Per-journey scenarios** — `tests/e2e/*.setup.php` (`seedJourneySetups`),
     each arranging the fixtures its paired `*.spec.mjs` asserts on.
- **Passes** (`passes/00`–`03`)
  `00` Availability (HTTP: status, no PHP/Twig error output, a `<title>`),
  `01` Integrity (Chromium: no JS exceptions, console errors, failed requests,
  broken images), `02` Accessibility (axe-core WCAG 2.1 A/AA),
  `03` Visual (per-platform full-page snapshots). Theme **journeys**
  (`tests/e2e/`) run alongside as the `journeys` project.
- **Observer** (`php/observer.php`)
  A sandbox-only mu-plugin exposing template/controller and PHP-issue headers per
  request, for the oracle assertions and notice capture.
- **Trial report** (`lib/trial-reporter.mjs`)
  A self-contained, client-readable HTML summary at `.shakedown/trial-report.html`.
  It reports what happened, not the tidiest reading of it: flaky routes are called
  flaky (with the first failure), suppressions are tabled, a failing journey stops
  the all-clear even though journeys aren't detailed, a failing visual route shows
  what actually rendered rather than the baseline it didn't match, and a run that
  checked nothing says so instead of leaving the last one looking current.

---

## Commands

```bash
npx shakedown            # derive the matrix, then run every pass (attached)
npx shakedown matrix     # print the route matrix only
npx shakedown sandbox    # boot the disposable WordPress, seed, run every pass
npx shakedown test [...] # run passes; extra args pass through to Playwright
npx shakedown ui         # Playwright UI / watch mode
```

The invocation directory is the workspace: the matrix, reports, traces, and the
theme's `tests/e2e/` journeys all resolve against it.

---

## Determinism and Fixtures

- `shakedown.config.json` `sandbox.seed` fixes Muster's generated values;
  `sandbox.epoch` (a timezone-qualified ISO 8601 datetime) fixes relative dates.
  Together they make the seeded site byte-identical across runs.
- Visual baselines live in the **theme** at `tests/__screenshots__/{platform}/`
  and are committed there; regenerate with `npx shakedown sandbox --update-snapshots`.
- **Baselines are only ever written on purpose.** `updateSnapshots: 'none'` is
  pinned in `playwright.config.mjs`, so a route with no baseline fails instead of
  quietly minting one (Playwright's default would write it, fail once, then pass
  on the retry). `--update-snapshots` is the only way to write, and the CLI
  rejects it outside sandbox mode — an attached run cannot touch the theme's
  baselines, which would otherwise capture that day's live content.
- If a theme's `SiteMuster` has no pinned `defaultEpoch()` (falls back to "now"),
  fixture dates drift and visual baselines will fail daily — pin an epoch (in the
  Muster or `sandbox.epoch`) when relying on the visual pass.
- **Everything under a baseline is pinned, not floating.** The SQLite drop-in
  (`SQLITE_PLUGIN_VERSION` + `SQLITE_PLUGIN_SHA256` in `lib/sandbox.mjs`, archive
  verified on download) and WordPress core (`wp-version` in the CI workflow) are
  exact versions, alongside `muster-ref`. `latest-stable` and `latest` meant an
  upstream release could change rendering, or break boot, with no change on our
  side — ambient variation sitting underneath every visual baseline. Bump the
  version and its checksum together, deliberately.

---

## CI

A reusable GitHub Actions workflow (`.github/workflows/shakedown.yml`) runs the
full sandbox suite on every push — no MySQL, no Docker, no site bundle: WordPress
core is downloaded bare and the theme's `composer.json` provisions the parent
theme and plugins. The package publishes to npm via OIDC Trusted Publishing on a
GitHub Release (`.github/workflows/publish.yml`) — no stored token, no OTP.

---

## Non-Goals

- **Not a unit-test framework.** Shakedown is browser E2E; PHP fixtures/scenarios
  are set up via Muster, not asserted in Shakedown's own JS layer.
- **No site bundle, MySQL, or Docker requirement.**
- **Not framework-locked.** The derived passes are WordPress-generic; PressGang is
  where the deeper introspection (Capstan oracle, config-derived matrix) lives.
- **Never writes to a real database.** Only the isolation-proven sandbox writes.

---

## Where to Look

- `bin/shakedown.mjs` — the CLI and mode dispatch
- `lib/sandbox.mjs` — sandbox assembly, isolation witness, seeding layers
- `lib/derive.mjs` — matrix derivation, Capstan oracle/doctor, route merge
- `lib/target.mjs` — target/config resolution
- `passes/00`–`03`, `passes/matrix.mjs` — the passes and their route source
- `lib/suppress.mjs` — the `ignore` policy: matching, validation, disclosure
- `tests/unit/` — this repo's own unit tests (never published)
- `bin/matrix.php`, `bin/matrix-supplement.php` — the derived route families
- `php/observer.php`, `bin/seed-states.php` — the in-WordPress helpers
- `playwright.config.mjs`, `README.md`

---

## Final Rule

If a check cannot be derived from the theme's own declarations, or a write cannot
be proven to land in the disposable sandbox, it does not belong in Shakedown.
