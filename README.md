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
npx shakedown matrix          # 🗺️ just enumerate and print the routes
npx shakedown test            # 🧪 run passes against the existing matrix
npx shakedown ui              # Playwright's watch/UI mode
npx playwright show-report    # browse the last run
```

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

Authored journeys (form submissions, checkout flows) live in your theme's `tests/e2e/` — when present they run alongside the derived passes as the `journeys` project.

**Seeding is convention-first.** If your theme ships [Muster](https://github.com/pressgang-wp/pressgang-muster) seeders (a top-level `muster/` directory), the sandbox runs them via `wp capstan seed` as the baseline — your real menus, terms and pages — then layers the derived populated/minimal ACF state fixtures on top. A theme that ships no seeders is unaffected: the derived layer covers it on its own, so it does a good job out of the box.

Sandbox fixture randomness and time are separate deterministic inputs. `seed`
controls generated values; `epoch` fixes relative dates used by Muster,
including ACF date fields and the fixture posts themselves. It must be a
timezone-qualified ISO 8601 datetime.

**Introspection:** when [Capstan](https://github.com/pressgang-wp/pressgang-capstan) is installed (`wp package install pressgang-wp/pressgang-capstan`), the matrix comes from `wp capstan matrix --resolve` — including each route's expected template and controller. Without it, a bundled fallback derives the same routes minus the oracle data.

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
| Search | `/?s=…` |
| Unknown URLs | a 404 probe |

Add a post type to your theme's `config/custom-post-types.php` and the next run covers it automatically. The matrix is the map; the passes are the inspection. 🔦

## 🧪 The passes

| Pass | Speed | Checks |
| --- | --- | --- |
| **00 · Availability** | ~seconds (HTTP only) | Every route returns its intended status · no PHP/Twig error signatures in the body · a `<title>` is present. The 404 probe accepts a 404 *or* a redirect-away (Redirection-plugin catch-alls are fine). |
| **01 · Integrity** | ~seconds–minutes (real Chromium) | No JS exceptions · no console errors · no failed same-origin requests · no broken images. |

Useful variations:

```bash
npm test -- tests/00-availability.spec.ts   # just the fast pass
npm run test:ui                             # Playwright's watch/UI mode
npm run matrix -- othersite                 # derive for a named target
npx playwright show-report                  # browse the last run's HTML report
```

When something fails you get the exact URL, what was expected, and a Playwright **trace** you can replay step-by-step. 🔍

---

## 💡 Good to know

- **Read-only by design.** The passes only ever GET pages — safe to run against any environment you can reach.
- **Testing a live shared server?** Runs are parallel; a single retry is built in to absorb load transients on one PHP-FPM.
- **Self-signed `.test` certificates** are already handled (`ignoreHTTPSErrors`).
- **True story:** on its very first run, Shakedown found a real bug — category archives returning `200` with an empty body. Zero tests written. That's the pitch. 🐛

---

## 🤖 CI

A reusable GitHub Actions workflow runs the full sandbox suite on every push — no MySQL, no Docker, no site bundle. The theme repo is the only input: WordPress core is downloaded bare, your `composer.json`'s installer-paths provision the parent theme and plugins, and the sandbox brings its own SQLite database and ACF state fixtures.

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
`wp-version`, `node-version`, and `muster-ref`. The workflow pins `muster-ref` to
the exact fixture engine revision it was verified against; override it only as
an intentional compatibility test. The Playwright HTML report and route matrix
upload as artifacts on every run. Suits theme-shaped repos; site-shaped repos
work too once their theme path is passed as `theme`. 🧪

## ⚓ The PressGang fleet

Shakedown is part of the [PressGang](https://pressgang.dev) ecosystem and is designed to compose with its shipmates:

| Package | Role |
| --- | --- |
| [pressgang](https://github.com/pressgang-wp/pressgang) | The parent theme framework (Timber + Twig, config-driven) |
| [capstan](https://github.com/pressgang-wp/pressgang-capstan) | WP-CLI scaffolding & introspection — future source of the route matrix and per-URL controller/template oracle |
| [muster](https://github.com/pressgang-wp/pressgang-muster) | Runs the theme's own seeders as the sandbox baseline, and seeds deterministic populated/minimal ACF states on top |
| [bosun](https://github.com/pressgang-wp/pressgang-bosun) | AI-agent guidelines & skills — future distribution channel for Shakedown's QA skills |

## 🛠️ Roadmap

- `wp capstan matrix --format=json` + **oracle assertions** — assert each URL rendered via its *intended* controller and Twig template, catching silent fallbacks to `index.php`
- **Observer mu-plugin** — PHP notice capture and render telemetry (template/snippet coverage)
- More passes: **accessibility** (axe-core), **visual snapshots**
- **Trial Report** — a client-readable HTML report with screenshots and coverage
- Engines: self-booting **WordPress Playground**, per-PR **InstaWP** CI sites, **wp-env** fidelity lane

## 📋 Requirements

- Node 20+
- WP-CLI on your PATH
- A locally reachable PressGang (or any WordPress) site — the derived passes are actually framework-agnostic; PressGang is where the deeper introspection is headed
