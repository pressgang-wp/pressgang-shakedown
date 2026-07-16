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

---

## Mental Model

- **Target** (`lib/target.mjs`)
  Resolves the site path, base URL, and `shakedown.config.json` for a run —
  including central mode, where one clone drives any registered `--target`.
- **Matrix** (`lib/derive.mjs`, `tests/matrix.mjs`)
  Every route the site serves: front page, each public post type's archive and
  sample singles, taxonomy term pages, pages per registered template, internal
  menu targets, a search probe, and a 404 probe. From `wp capstan matrix
  --resolve` (with the controller/template **oracle**) when Capstan is present,
  or a bundled fallback when it is not.
- **Sandbox** (`lib/sandbox.mjs`)
  A throwaway WordPress in a temp dir: core/theme/plugins symlinked **read-only**,
  its own SQLite database and uploads, WordPress install defaults cleared, then
  seeded, served by `wp server`, isolation-proven, and deleted after the run.
- **Seeding layers** (sandbox only, in order)
  1. **Theme baseline** — the theme's own Muster via `wp capstan seed`
     (`seedThemeMuster`), when the theme ships `muster/` seeders.
  2. **Derived ACF state fixtures** — populated + minimal per field group
     (`seedAcfStates` → `bin/seed-states.php`), where empty-link / missing-image
     bugs live.
  3. **Per-journey scenarios** — `tests/e2e/*.setup.php` (`seedJourneySetups`),
     each arranging the fixtures its paired `*.spec.mjs` asserts on.
- **Passes** (`tests/00`–`03`)
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
- If a theme's `SiteMuster` has no pinned `defaultEpoch()` (falls back to "now"),
  fixture dates drift and visual baselines will fail daily — pin an epoch (in the
  Muster or `sandbox.epoch`) when relying on the visual pass.

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
- `tests/00`–`03`, `tests/matrix.mjs` — the passes and their route source
- `php/observer.php`, `bin/seed-states.php` — the in-WordPress helpers
- `playwright.config.mjs`, `README.md`

---

## Final Rule

If a check cannot be derived from the theme's own declarations, or a write cannot
be proven to land in the disposable sandbox, it does not belong in Shakedown.
