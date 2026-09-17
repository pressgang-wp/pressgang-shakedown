# Derived regression contract

Start in the consumer project with `npx shakedown init`. The interactive setup
detects local WordPress and its home URL, asks for production and optional staging
origins, writes `shakedown.config.json`, and ignores generated `.shakedown/`
artifacts. For non-interactive setup:

```sh
npx shakedown init --site-path=./wp --base-url=https://theme.test \
  --reference=https://example.org --staging=https://staging.example.org --yes
```

Commit the generated config and `.gitignore`. Existing configs are never replaced
or shadowed; edit them to add environments later. Setup does not install packages,
launch tests or write WordPress data. Relative `sitePath` values resolve against
the config directory. See `shakedown init --help` for discovery and flag details.

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
    "defaultLevel": "full",
    "defaultViewports": ["desktop", "tablet", "mobile"],
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

The named environment flags, `--target`, `--level`, `--viewports` and `--coverage` are accepted.
Use `npx shakedown regression --help` for usage. Playwright options,
journeys, seeding and baseline updates cannot enter this execution path. The first
release supports origin-root deployments; it rejects credentials, path prefixes,
queries and fragments in environment URLs. Discovery URLs must use the configured
discovery origin; rejected routes are listed, never silently remapped from an
unrelated host. Exact pathname and query are identity; fragments are not.


## Choose the testing level and viewports

Start with application health, then expand the scope when you are ready:

```sh
npx shakedown regression --level=errors --viewports=desktop
npx shakedown regression --level=core --viewports=desktop
npx shakedown regression --level=full --viewports=desktop,tablet,mobile
```

| Level | What runs |
| --- | --- |
| `errors` | Candidate HTTP status, PHP/Twig error output, title presence, browser JS/console/request failures and broken images. No production requests, axe audit or comparison screenshots. |
| `core` | Application checks plus serious/critical axe findings, status/redirect comparisons, form definitions and empty-link differences. Accessibility findings retain element highlights. |
| `full` | Core checks plus all axe findings, title/heading/image/layout/structure differences and paired screenshots. |

Levels are cumulative in check coverage. Core changes are review priorities, not
proof of a severe regression. Forms are inspected, never submitted; these levels
do not claim to test interactive workflows. All profiles retain existing route,
request and rule suppressions. Core reports disclose omitted minor/moderate axe
findings; the underlying axe engine may still evaluate those rules.

The **Review** filter narrows observations to application errors, serious
accessibility, core changes, other changes/advisories, inconclusive observations,
or observations with no findings in the selected checks. **Viewport** further
narrows the report. Filters do not change totals, exit status or saved evidence.

Built-in viewport presets are desktop **1280×900**, tablet **768×1024** and mobile
**390×844**. These are Chromium viewport dimensions, not device/touch emulation.
Custom `viewports` entries override preset dimensions or add named sizes. Unknown
or duplicate names fail early. Selection order is preserved; feeds run once.

Save defaults inside the existing `regression` object:

```json
"defaultLevel": "core",
"defaultViewports": ["desktop"]
```

CLI flags override defaults for one run without editing configuration. New
`init` configurations and configs with no viewport settings select desktop,
tablet and mobile. Explicit `defaultViewports` or `viewports` selections are
preserved; the example above deliberately narrows the default to desktop. The level defaults to full to preserve existing check coverage.

Each command creates a separate report. Limited runs prominently show omitted
checks; an errors-only pass does not mean the site passed full regression.
Candidate-only errors runs use the derived route matrix without the production
navigation supplement, and classify visited routes as `candidate-checked`.
The errors level still uses the regression environment configuration.

## Evidence and outcomes

The selected level limits what is collected; skipped checks are disclosed.
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
In core/full runs, one bounded inspection of production's homepage header/nav/footer links can add
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

## Identifying accessibility elements

Under **Accessibility: element details**, expand a rule and then an element.
Each element includes its selector, escaped HTML, axe's explanation and check
data. Contrast checks include measured and required ratios and foreground and
background colours when axe provides them.

The close-up outlines the element on a saved screenshot. Expand **Show location
on full page** for context, or **Open original screenshot** for the unaltered
image. Highlights are report overlays; they do not modify the tested page or
visual baselines. Missing, hidden or ambiguous elements retain their details with
an explicit explanation when a highlight cannot be captured.

These are candidate accessibility findings, not proof of a change from production.
Existing rule suppressions still apply and remain disclosed. Trial reports also
include element evidence, retaining each retry attempt separately. Share the
report directory with its images, not just the HTML file.

Older reports cannot recover details that were not saved. Run Shakedown again
with the updated version to capture this evidence.

Reports open on **Needs attention**, hiding passed observations from the route
index and page cards. Choose **Passed pages** or **All observations** to inspect
coverage. Every card carries a Passed, Failed, Review needed or Inconclusive
badge. Summary totals always include all observations, independent of filters.

## Supplementary archive discovery

For pretty permalinks, author and date samples require a matching archive rule
in WordPress's currently generated, filtered rewrite rules. Generic page rules
and dated single-post rules do not establish an archive. Discovery exclusions
are recorded with the URL and reason in the matrix and reports. Other route
sources, such as explicit menu links, remain eligible for testing.

Rules are generated in memory; Shakedown never flushes or updates stored rules.
A difference from stored rules produces a warning for separate review. Plain
permalinks and explicit query-string URLs retain the previous sampling behavior.
Generation failures retain samples with a warning. Runtime-only 404 guards cannot
be interpreted as intentional exclusions from rewrite rules alone.

This checks routing availability, not a declaration of expected 404 behavior.
A matching archive rule retains the sample even if another rule might shadow it;
the browser test still determines whether that route actually works.

## Semantic differences and comparison limits

Empty-link comparisons ignore captured position and dimensions. A link moving
down the page, or changing its box size, does not by itself create an empty-link
difference. Link content, count and order still participate in comparison.
The original captured geometry remains in each side's evidence; genuine image
dimensions, landmarks and other layout evidence continue to be compared.

Full captures record the selector and number of structural content regions.
Structural comparison requires exactly one captured `<main>` on each side.
Missing, multiple or unknown regions produce **Structural comparison unavailable**
with both scopes and raw structural arrays retained. The report counts this
separately as a comparison limitation, keeps it visible for review, and does not
describe the candidate's entire structure as newly added. With one `<main>` on
each side, structural changes are compared normally.

For older saved evidence, the comparator can infer the number of main elements
from captured landmarks. If that evidence is missing too, it reports an unknown
scope rather than assuming the structural arrays are comparable.

## Coverage and exhaustive content discovery

Every regression run reads an inventory of published, publicly viewable singles
and public taxonomy terms from the discovery WordPress installation. Empty terms
are included: a term with no assigned posts can still have a substantial landing
page. The report lists **known routes not selected**, exclusions with reasons,
and selected route/viewports that were **not visited**. Those are distinct from
pages that were visited and failed. Inventory failure is displayed as unknown
coverage, never as zero omitted routes.

Sampling remains the default. To include the whole finite content inventory:

```sh
npx shakedown regression --level=full --coverage=exhaustive
```

Use `--viewports=desktop` to start with one viewport, or save
`"coverage": "exhaustive"` inside `regression`. Exhaustive runs can be much larger
than sampled runs. The inventory limit is 20,000 entries; exceeding it or failing
to read the inventory stops an exhaustive run with an incomplete report.

“Exhaustive” applies to the discovery site's published public content and terms,
not every possible URL or interaction. Author/date archives, feeds, pagination
and search probes retain their existing derived samples. Reference-only content
not present in the discovery installation remains outside this inventory.
Runtime guards that deliberately return 404 cannot be inferred from registration
alone; use disclosed `ignore.routes` policies for intentional exclusions.
Additional content routes have no invented Capstan template oracle. Discovery
uses reads only and does not change WordPress data or rewrite rules.

## Image checks and actionable element evidence

All regression levels now check visible image elements for a missing source,
including images with no `src` attribute. This is a candidate health failure.
Existing broken-image checks remain in place. Possible aspect-ratio distortion
and document-wide horizontal overflow are advisory findings, including at the
errors level. They are candidate observations, not proof of a change from production.

Distortion checks compare natural dimensions with the rendered CSS content box
for `object-fit: fill` images of at least 32×32 pixels. A discrepancy must exceed
10% and two pixels. Intentional `contain`/`cover` cropping is excluded. Overflow
requires the document to exceed the viewport by more than two pixels; a wide
carousel clipped inside its container does not alone establish page overflow.
The report highlights up to 20 possible overflow contributors and discloses any
omitted contributors; it does not claim these elements are proven causes.

Use top-level `ignore.imageIssues` to narrowly suppress an issue ID, message or
selector substring. For example, `"image-aspect-ratio"` suppresses that advisory
category; a specific selector is narrower. Suppressed findings retain raw
evidence and are labelled in the report. Existing `regression.ignoreSelectors`
continues to mask screenshots and exclude comparison data, without disabling
health checks. Accessibility rules are unchanged.

Under **Images, links and forms: element details**, expand an element to see its
selector, HTML excerpt, and screenshot close-up with an outline. Form and link
evidence is available at core/full levels; image comparison evidence at full.
Candidate image-health findings retain evidence at every level. HTML excerpts
are capped at 6,000 characters with an explicit truncation notice. Capture failures
and elements with no visible box retain an explanation instead of a guessed highlight.

The reference and candidate sections show the captured elements in a changed
group; not every listed element necessarily changed. Selectors, HTML and highlight
coordinates are stored separately from semantic comparison values. Movement alone
does not create an empty-link difference. Image-size and layout differences are
still compared. No carousel controls are clicked and no form is submitted; this
cannot establish that a carousel advances correctly. A rerun is needed to collect
new evidence; existing saved reports are unchanged.
# Reviewing and focusing a run

Use `--routes=/path/,/other-path/` to select exact discovered paths, including
eligible public content omitted by sampling. Unknown, ignored and unsafe paths
fail explicitly. Encode literal commas in URLs as `%2C`. The report discloses
the focused selection; remove `--routes` to restore broader coverage.
Reference homepage discovery may still run to resolve navigation routes.

Repeated identical changes, title separator changes, uniquely matched image
source changes and landmark role/label changes are grouped for review. Grouping
does not suppress differences or declare improvements. Per-page evidence remains.

Each comparison difference offers a JSON fragment for `regression.accept`.
Merge it into the existing array after review. Matching is case-sensitive substring
matching across viewports and future runs; it may match longer paths. Acceptance
does not clear health failures. Intentionally removed routes require a separate,
explicit `ignore.routes` policy, which excludes their checks altogether.

Full runs compare matched captures using Playwright's public `toMatchSnapshot`
matcher (perceptual threshold 0.2; no differing pixels allowed after that threshold).
An **Appearance changed** finding links to Playwright's HTML comparison viewer,
including expected/reference, actual/candidate and diff evidence. A mismatch is
advisory; it does not fail candidate health or establish that production is correct.
The expected PNG is a disposable copy of this run's reference capture, with snapshot
updates disabled. Consumer baselines remain untouched. Comparisons exceeding
16 million pixels are disclosed as unavailable. The viewer is stored inside the
run folder; share that folder intact. If the browser restricts opening its assets
from a file URL, serve the folder through your editor's local HTTP preview.
Capture timing and moving content can still produce differences; this comparison
does not exercise controls or guarantee a stable carousel state. Each pair runs
an isolated Playwright comparison worker, adding processing time to full runs.

`summary.md` accompanies `index.html` and `run.json` for sharing health failures,
behaviour changes, accepted differences, repeated changes and coverage limits.
