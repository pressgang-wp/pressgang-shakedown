# 🚢 Shakedown

**Shakedown** is end-to-end browser testing for **PressGang WordPress themes** — with **zero tests to write**.

A shakedown cruise is the sea trial of a new vessel: take her out, push every system, find what rattles before the passengers board. Shakedown does the same for your theme. Because PressGang themes declare their post types, taxonomies, templates and menus in `config/`, Shakedown can **derive the whole test suite from the site itself** — enumerate every route, then check each one in a real browser.

Point it at a running site and in under a minute you'll know: does every page render, error-free, with nothing broken aboard? ⛵

---

## ⚡ Quick start

You need Node 20+, WP-CLI, and a PressGang site running locally (any server — Herd, Valet, DDEV, MAMP… it's just a URL). From inside your theme:

```bash
npm i -D @pressgang-wp/shakedown
npx playwright install chromium   # once per machine
npx shakedown                     # ⚓ derive the matrix, run every pass
```

That's it. Shakedown walks up from your theme to find `wp-config.php`, asks WP-CLI for the site URL, enumerates every route, and checks them all — **no config, no specs written**.

Other commands:

```bash
npx shakedown init            # create project configuration interactively
npx shakedown matrix          # 🗺️ just enumerate and print the routes
npx shakedown test            # 🧪 run passes against the existing matrix
npx shakedown ui              # Playwright's watch/UI mode
npx playwright show-report    # browse the last run
```

### Set up a project for regression

Run `npx shakedown init` from the project directory where you want the config and
reports to live. It detects WordPress in the current directory, an ancestor, or
common locations (`wp`, `wordpress`, `web/wp`, `public/wp`, `public`), reads the
local home URL through WP-CLI, and asks for the production URL and optional staging
URL. Leave production blank for attached-only setup. For scripted setup:

```sh
npx shakedown init --site-path=./wp --base-url=https://mysite.test \
  --reference=https://example.org --staging=https://staging.example.org --yes
npx shakedown regression --against=production --candidate=local
```

Setup creates `shakedown.config.json` and adds `/.shakedown/` to `.gitignore`.
Commit both files with your project. Paths in the config are relative to the
config's directory. Existing configs (including an ancestor's central config)
are never overwritten or shadowed; edit them directly. Ambiguous installations
require `--site-path` or an interactive choice. Non-interactive runs never wait
for input; `--yes` uses detected values without asking questions in a terminal.
Use `npx shakedown init --help` for options.

`init` only sets up local project files. It does not install dependencies, run
tests, create baselines or modify WordPress data. If WP-CLI cannot read the home
URL, supply `--base-url`. Regression URLs must be HTTP(S) origins without paths
or credentials; authenticated staging is not supported. Each regression run prints
the `.shakedown/regression/run-…/index.html` path to open in your browser. Share the
whole run folder, including its paired screenshots.

Optional `shakedown.config.json` in the theme, for overrides only:

```json
{
  "baseUrl": "https://mysite.test",
  "samplesPerType": 2,
  "searchTerm": "bikes",
  "sandbox": {
    "seed": 42,
    "epoch": "2026-01-01T09:00:00+00:00"
  }
}
```

### 🔇 Suppressing what isn't yours

The passes are strict on purpose — zero console errors, zero PHP notices, no
serious axe violations. On a real site some of that noise belongs to somebody
else: a tag manager logging to the console, a deprecation raised inside ACF on a
newer PHP, a contrast rule your palette loses deliberately. An `ignore` block
records what's already been judged, so you don't have to choose between the
noise and switching a whole pass off:

```json
{
  "ignore": {
    "routes":        ["/private-area", "/wp-json/"],
    "consoleErrors": ["googletagmanager", "ERR_BLOCKED_BY_CLIENT"],
    "requests":      ["/wp-json/"],
    "phpIssues":     ["wp-content/plugins/advanced-custom-fields-pro/"],
    "errorSignatures": ["on https://mysite.test/alerts/"],
    "a11yRules":     ["color-contrast"]
  }
}
```

Patterns are plain **substrings**, case-sensitive — not regex, not globs. Paste
the text out of a failure message and it's the pattern that silences it.
`a11yRules` is the exception: exact axe rule IDs, handed to axe's own
`disableRules()`.

`phpIssues` matches the whole signature — `<message> in <path>:<line>`, path
relative to the WordPress root — so a pattern can name an **origin**
(`wp-content/plugins/…/`) just as easily as a message. Filtering happens inside
the observer, so the count a route reports is what's genuinely outstanding.

`errorSignatures` is for the one page whose *content* legitimately reads
"Warning: ". It matches `<signature> on <url>`, so naming the URL suppresses the
scan just for that page rather than everywhere.

**Nothing is suppressed quietly.** Every active pattern is printed when the
matrix is derived, ignored routes are counted, and the Trial Report ends with a
*Suppressed by configuration* table — a clean run can be read for what it is. A
mistyped key (`consoleError`) is an error rather than a silent no-op.

Authored journeys (form submissions, checkout flows) live in your theme's `tests/e2e/` — when present they run alongside the derived passes as the `journeys` project.

**Seeding is convention-first.** If your theme ships [Muster](https://github.com/pressgang-wp/pressgang-muster) seeders (a top-level `muster/` directory), the sandbox runs them via `wp capstan seed` as the baseline — your real menus, terms and pages — then layers the derived populated/minimal ACF state fixtures on top. A theme that ships no seeders is unaffected: the derived layer covers it on its own, so it does a good job out of the box.

Sandbox fixture randomness and time are separate deterministic inputs. `seed`
controls generated values; `epoch` fixes relative dates used by Muster,
including ACF date fields and the fixture posts themselves. It must be a
timezone-qualified ISO 8601 datetime.

**Introspection:** when [Capstan](https://github.com/pressgang-wp/pressgang-capstan) is installed (`wp package install pressgang-wp/pressgang-capstan`), the matrix comes from `wp capstan matrix --resolve` — including each route's expected template and controller. Without it, a bundled fallback derives the same routes minus the oracle data.

**Static analysis stays in Composer.** PressGang themes should run
`composer check` when they provide it; that local alias is `test:compat` plus
`phpstan`. Shakedown does not run or configure PHPStan — it proves runtime and
browser behaviour after the static PHP checks have passed.

**Central mode** (many sites from one clone): a `shakedown.config.json` with a `targets` map lets one checkout drive any registered site — `npx shakedown --target=mysite`.

---

## 🗺️ What gets tested

`npm run matrix` asks the **running site** (via WP-CLI) for everything it serves:

| Derived from | Routes |
| --- | --- |
| Front page | `/` |
| Every public post type | its archive + sample singles |
| Every public taxonomy | sample term pages |
| Page templates | every published page using one |
| Menus | every internal menu target |
| Authors | archives for authors with published posts (`author.php`) |
| Dates | year and month archives of the newest post (`date.php`) |
| Pagination | page 2 of any archive with more posts than fit |
| Feeds | the main feed and per-post-type feeds |
| Search | `/?s=…`, plus a term that matches **nothing** |
| Unknown URLs | a 404 probe |

Author and date archives are templates most themes ship and nothing was ever
opening; pagination is where off-by-one and empty-page bugs live; and the
no-results search exercises a branch the configured `searchTerm` never reaches.
Feeds are checked by pass 00 only — a feed that fatals matters, but running axe
or a visual snapshot over XML measures nothing.

Page 2 is only emitted when a post type has more published posts than
`posts_per_page`. A theme that *raises* that for a particular archive can drop
the route with `ignore.routes` (below).

Add a post type to your theme's `config/custom-post-types.php` and the next run covers it automatically. The matrix is the map; the passes are the inspection. 🔦

## 🧪 The passes

| Pass | Speed | Checks |
| --- | --- | --- |
| **00 · Availability** | ~seconds (HTTP only) | Every route returns its intended status · no PHP/Twig error signatures in the body · a `<title>` is present. The 404 probe accepts a 404 *or* a redirect-away (Redirection-plugin catch-alls are fine). In a sandbox, also the **oracle** — each URL rendered via its intended template and controller, catching silent fallbacks to `index.php` — and a count of **PHP notices** raised, which a page can be doing on every request while looking perfect. |
| **01 · Integrity** | ~seconds–minutes (real Chromium) | No JS exceptions · no console errors · no failed same-origin requests · no broken images. |
| **02 · Accessibility** | ~seconds–minutes (axe-core) | WCAG 2.1 A/AA. `serious` and `critical` fail the route; `moderate` and `minor` are reported but don't (promote them once the top tier is clean). |
| **03 · Visual** | ~minutes | Full-page snapshots against per-platform baselines committed in your theme. Deterministic fixtures are what make these stable — see below. |

Theme **journeys** in `tests/e2e/` run alongside as a separate project. A
**Trial Report** — client-readable HTML, route × pass, with screenshots and
plain-English failures — lands at `.shakedown/trial-report.html`, alongside
`run.json` for anything that wants to consume a run.

Useful variations:

```bash
npx shakedown test 00-availability      # just the fast pass
npx shakedown ui                        # Playwright's watch/UI mode
npx shakedown matrix --target=othersite # derive for a named target
npx playwright show-report              # browse the last run's HTML report
```

When something fails you get the exact URL, what was expected, and a Playwright **trace** you can replay step-by-step. 🔍

---

## 💡 Good to know

- **Read-only by design.** The passes only ever GET pages — safe to run against any environment you can reach. That extends to your repo: a run never writes visual baselines as a side effect. Creating or updating them takes `npx shakedown sandbox --update-snapshots`, and it's refused outside sandbox mode, because a baseline captured from a live site records that day's content rather than your theme.
- **Testing a live shared server?** Runs are parallel; a single retry is built in to absorb load transients on one PHP-FPM.
- **Self-signed `.test` certificates** are already handled (`ignoreHTTPSErrors`).
- **True story:** on its very first run, Shakedown found a real bug — category archives returning `200` with an empty body. Zero tests written. That's the pitch. 🐛

---

## 🤖 CI

A reusable GitHub Actions workflow runs the full sandbox suite on every push — no MySQL, no Docker, no site bundle. The theme repo is the only input: WordPress core is downloaded bare, your `composer.json`'s installer-paths provision the parent theme and plugins, and the sandbox brings its own SQLite database and ACF state fixtures.

Keep static PHP checks as separate CI jobs or steps before/alongside Shakedown:
`composer test:compat`, `composer phpstan`, or the local convenience alias
`composer check`. Shakedown's reusable workflow intentionally remains the
browser/runtime gate so Actions can show which layer failed.

In your theme repo, `.github/workflows/shakedown.yml`:

```yaml
name: Shakedown
on: [push, pull_request]
jobs:
  shakedown:
    uses: pressgang-wp/pressgang-shakedown/.github/workflows/shakedown.yml@main
    secrets:
      COMPOSER_AUTH: ${{ secrets.COMPOSER_AUTH }}   # ACF Pro credentials, if composer-managed
```

Inputs (all optional): `theme` (defaults to the repo name), `php-version`,
`wp-version`, `node-version`, and `muster-ref`.

**Versions are pinned, not floating.** `wp-version` and `muster-ref` are exact —
as is the SQLite drop-in, whose archive is checksum-verified on download. A
visual diff is supposed to mean your theme changed, and `latest` anywhere in that
stack meant an upstream release could rebreak every baseline on its release day.
Bump them deliberately, or pass `latest` explicitly to test forward
compatibility on purpose.

The Playwright HTML report, the Trial Report and the route matrix upload as
artifacts on every run. Suits theme-shaped repos; site-shaped repos work too once
their theme path is passed as `theme`. 🧪

## ⚓ The PressGang fleet

Shakedown is part of the [PressGang](https://pressgang.dev) ecosystem and is designed to compose with its shipmates:

| Package | Role |
| ------- | ---- |
| [pressgang](https://github.com/pressgang-wp/pressgang) | The parent theme framework (Timber + Twig, config-driven) |
| [capstan](https://github.com/pressgang-wp/pressgang-capstan) | WP-CLI scaffolding & introspection — when installed, it's the source of the route matrix and the per-URL controller/template oracle |
| [muster](https://github.com/pressgang-wp/pressgang-muster) | Runs the theme's own seeders as the sandbox baseline, and seeds deterministic populated/minimal ACF states on top |
| [bosun](https://github.com/pressgang-wp/pressgang-bosun) | AI-agent guidelines & skills — tells agents when to use `composer check`, PHPStan, Capstan, and Shakedown |

## 🛠️ Roadmap

Shipped since the first cut: the Capstan-sourced matrix and **oracle assertions**,
the **observer** mu-plugin (PHP notice capture and render telemetry), the
**accessibility** and **visual** passes, and the **Trial Report**.

Still ahead:

- **Render telemetry** — which Twig templates and snippets a run actually
  exercised, so coverage is measurable rather than assumed
- More engines: self-booting **WordPress Playground**, per-PR **InstaWP** CI
  sites, a **wp-env** fidelity lane
- Journeys in the Trial Report — authored `tests/e2e/` results are currently
  counted but not detailed there
- Wider matrix families: attachment pages, deeper pagination, multi-page posts

## 📋 Requirements

- Node 20+
- WP-CLI on your PATH
- A locally reachable PressGang (or any WordPress) site — the derived passes are actually framework-agnostic; PressGang is where the deeper introspection is headed

## Production versus an updated theme

`shakedown regression` derives the same local route matrix, then compares those
exact paths on a production reference and a local or staging candidate. Candidate
health failures remain independent of production differences. Desktop/mobile
screenshots and semantic comparisons appear in a separate Regression Report;
production captures never become committed visual baselines.

```json
{
  "sitePath": "/path/to/wordpress",
  "baseUrl": "https://theme.test",
  "regression": {
    "references": { "production": "https://example.org" },
    "candidates": {
      "local": "https://theme.test",
      "staging": "https://staging.example.org"
    }
  }
}
```

```sh
npx shakedown regression --against=production
npx shakedown regression --against=production --candidate=staging
```

Both sides use anonymous GET-only traffic, with browser writes blocked. No seeding,
journeys, form submissions or baseline updates run. A bounded production navigation
supplement exposes possible reference-only paths without replacing derived coverage.
Reports live in `.shakedown/regression/run-*/index.html`, alongside JSON and paired
screenshots. Exit 1 means candidate health failures; exit 2 means incomplete or
inconclusive/unmatched evidence. Differences alone are advisory in this release.

See [the regression contract](docs/REGRESSION.md) for policies, matching rules,
normalization, safety boundaries and limitations.

Accessibility findings in regression and trial reports include per-element selectors,
HTML, axe explanations and highlighted screenshot close-ups. Expand a rule under
**Accessibility: element details**, then select an element. See
[reviewing accessibility evidence](docs/REGRESSION.md#identifying-accessibility-elements).


Regression scope can be selected per run:

```sh
npx shakedown regression --level=errors --viewports=desktop
npx shakedown regression --level=core --viewports=desktop
npx shakedown regression --level=full --viewports=desktop,tablet,mobile
```

Regression defaults to desktop, tablet and mobile; explicit selections are preserved.
Reports disclose skipped checks and offer finding-category and viewport filters.
See [testing levels and viewports](docs/REGRESSION.md#choose-the-testing-level-and-viewports).

Regression reports also disclose known content routes omitted by sampling. Include
all published public singles and public terms (including empty landing pages) with:

```sh
npx shakedown regression --level=full --coverage=exhaustive
```

This can be a large run; `--viewports=desktop` limits it to one viewport.
See [coverage and evidence details](docs/REGRESSION.md#coverage-and-exhaustive-content-discovery)
for scope, exclusions and suppression policy.
