# Derived regression contract

`shakedown regression` compares one locally derived PressGang route plan on two
origins. `sitePath` and `baseUrl` retain their existing meaning: the WordPress
installation inspected by WP-CLI, and its public home origin. They are discovery,
not a remote deployment selector. Named references and candidates live under the
same single-target or central `targets` entry.

```json
{
  "sitePath": "/path/to/wordpress",
  "baseUrl": "https://theme.test",
  "regression": {
    "references": { "production": "https://example.org" },
    "candidates": {
      "local": "https://theme.test",
      "staging": "https://staging.example.org"
    },
    "defaultReference": "production",
    "defaultCandidate": "local",
    "viewports": [
      { "name": "desktop", "width": 1280, "height": 900 },
      { "name": "mobile", "width": 390, "height": 844 }
    ],
    "navigationLimit": 40,
    "timeout": 20000,
    "ignoreSelectors": [],
    "accept": [],
    "criticalRoutes": []
  }
}
```

```sh
npx shakedown regression --against=production
npx shakedown regression --against=production --candidate=staging
npx shakedown regression --target=client --candidate=staging
```

Only the named environment flags and `--target` are accepted. Playwright options,
journeys, seeding and baseline updates cannot enter this execution path. The first
release supports origin-root deployments; it rejects credentials, path prefixes,
queries and fragments in environment URLs. Discovery URLs must use the configured
discovery origin; rejected routes are listed, never silently remapped from an
unrelated host. Exact pathname and query are identity; fragments are not.

## Evidence and outcomes

Each invocation creates `.shakedown/regression/run-<unique>/` containing `plan.json`,
`run.json`, `index.html`, runtime PNGs and the original discovery matrix. Zip that
folder to share the report. It never reads or writes `tests/__screenshots__`, nor
replaces the ordinary Trial Report or matrix. Captures are run artifacts, not
committed baselines; the tool does not automatically delete old evidence.

Before browser evidence is collected, each page is scrolled in viewport-sized
steps and returned to the top so native and script-driven lazy images can load.
Scrolling is bounded to 40 steps, followed by a two-second image-settling wait;
the report discloses a reached limit or pending images. Completed but broken lazy
images join candidate health findings when the bottom was reached. This prevents
an unvisited footer from being mistaken for missing logos, without allowing an
infinite-scroll page to turn capture into an unbounded crawl.

The paired plan preserves route kind, expected status, HTML eligibility and
Capstan oracle metadata. Capstan/fallback plus supplementary route families remain
the canonical source. Critical paths supplement that plan and cannot replace it.
One bounded inspection of production's homepage header/nav/footer links can add
reference-derived paths. There is no recursive crawl or sitemap walk. The report
states when the navigation supplement fails, is disabled or reaches its limit.
Absence from this sample is never proof of absence from the site.

Classification uses exact paths and observed responses:

- **Matched:** both endpoints respond and finish at the same path/query.
- **Candidate-only:** reference returns 404/410 and candidate succeeds.
- **Reference-only:** reference succeeds and candidate returns 404/410. This can
  be removal, content drift or a local discovery gap, not automatically a defect.
- **Unmatched:** different redirect destinations, or missing content on both sides.
- **Inconclusive:** transport failure, access denial, rate limiting, server error,
  or a likely maintenance/access interstitial. An interstitial title stops the run
  early and discloses that the remaining routes were not checked.

The 404 probe has separate expected-status semantics. A reference failure never
turns a candidate health failure into a pass. HTTP status, PHP/Twig signatures,
title presence, optional observer headers, browser integrity and serious/critical
WCAG 2.1 A/AA checks share implementation with passes 00–02. There is no observer
installation or expectation of internal headers on production. Feed routes remain
HTTP-only and do not require an HTML title.

Candidate health failures exit **1**. An incomplete, empty or inconclusive/unmatched
run exits **2**, taking precedence over health failures. Complete runs with only
reviewable differences exit **0**. Structural/status differences are advisory in
this first release; promote narrowly defined signals only after field evidence.
Raw screenshots are side-by-side review evidence, not a pixel-equality gate.

There are no automatic retries. Fresh contexts are used for each side, route and
viewport. Failures remain in the report; reruns create separate evidence. This
avoids presenting a successful second capture as an unqualified first-attempt pass.

## Semantics and normalization

Evidence includes title, H1s, landmark structure and positions, form methods,
actions and visible field schemas, images with natural/displayed dimensions,
empty destinations, empty headings and a basic main-content structure sequence.
Empty headings and destinations are defensible generic signals for blank cards;
Shakedown does not guess which CSS class means a card, count expected relationships,
or claim that every empty component is a defect. Image dimensions and landmark
positions expose stretching/displacement without asserting that content must be
identical. Image identity remains its URL path; different media are not paired by
array position as proof of a sizing regression.

Whitespace is collapsed for titles/headings. Same-origin link/image/form URLs
become paths; foreign destinations retain origins. Hidden form fields and their
nonces/values are omitted. Input values and exact body text are not compared.
Other changes, including content order, query values and image dimensions, remain
visible evidence. No implicit date, random-card or text suppression is applied.

Existing `ignore` categories retain their meaning and are printed and reported.
`regression.accept` contains case-sensitive substring signatures such as
`"title on /about/"`; matching differences are kept with `suppressed: true`.
`regression.ignoreSelectors` contains CSS selectors for dynamic regions. They are
excluded from semantic comparison and masked in screenshots on both sides, but
remain subject to candidate health checks. Invalid selectors fail captures.
Policies are reported even if no findings match. `ignore.routes` removes paths
from testing; use it narrowly where an expected route is deliberately unavailable.

## Safety boundary

Both sides are anonymous GET-only observations. HTTP redirects are followed
manually within the selected origin. Browser requests are intercepted below page
JavaScript; methods other than GET, WebSockets, service workers, administrative
endpoints, known action query parameters and cross-origin frame navigations are
blocked. Request cookies and authorization are stripped; response cookies cannot
enter the browser jar. External GET assets may load, but cannot submit writes.
All blocked requests are disclosed because restrictions can affect rendering.
Self-signed TLS is accepted for `.test` candidates only; public certificate errors
are inconclusive, not silently trusted.

No forms are submitted, no login is attempted, no session state is imported, no
Muster seeding runs and no database mutation command is issued. As with attached
mode, WordPress/plugin side effects of booting or serving a GET are outside the
runner's control. Sandbox isolation and deterministic fixture code are unchanged.

## ACF and extension boundaries

ACF location rules can identify post types and page templates needing coverage;
existing route derivation covers those surfaces through registered content and
template state. ACF relationships may be optional, conditional or rendered by
nested flexible content. A field-group schema alone cannot prove that a particular
DOM card should be populated. This release does not claim complete ACF group
coverage or inspect field values. Read-only location-to-route coverage inventories
and explicit PressGang field-to-component markup are the next useful extension.
Muster continues to own generated fixtures, and Capstan continues to own framework
introspection. Shakedown does not introduce a second ORM or framework resolver.

## Deferred work

Bounded sitemap discovery, semantic retry/stability evidence, richer trace capture,
image matching with defensible layout gates, ACF coverage inventories and opted-in
read-only filter/menu interactions remain future work. Authored project journeys
remain separate. CI runtime/action and Muster pin maintenance are separate changes;
the regression implementation does not update an unverified fixture dependency.
