# pressgang-shakedown
Sea trials for PressGang themes – A repeatable end-to-end testing harness for every theme built on the framework — derived from theme config, seeded deterministically, AI-crewed, and cheap to run.

The route matrix is enumerated from the running site (post types, taxonomy terms, page
templates, menus, search, 404) and every route is checked automatically — **zero authored
tests** to get value. Strategy: see RFC-001 "Sea trials for PressGang themes".

## Usage

```bash
npm install
npm run matrix          # derive .shakedown/matrix.json via WP-CLI (default target)
npm test                # run all passes
npm run matrix -- bhp   # derive for a named target
```

Targets are defined in `shakedown.config.json` (`sitePath` for WP-CLI, `baseUrl` for the browser).

## Test passes

| Pass | File | Checks |
|---|---|---|
| 00 availability | `tests/00-availability.spec.ts` | HTTP status matches intent; no PHP/Twig error signatures in the body; `<title>` present. The 404 probe accepts a 404 or a redirect-away (Redirection-plugin catch-alls). HTTP-only — no browser. |
| 01 integrity | `tests/01-integrity.spec.ts` | Renders each 200 route in Chromium: no JS exceptions, no console errors, no failed same-origin requests, no broken images. |

## Roadmap (from RFC-001)

- Matrix via `wp capstan matrix --format=json` + controller/template oracle assertions
- Muster-seeded deterministic fixtures; observer mu-plugin (PHP notice capture, render telemetry)
- Further passes: accessibility (axe), visual snapshots; Trial Report + coverage output
- Engines: playground self-boot, per-PR InstaWP CI, wp-env fidelity lane
