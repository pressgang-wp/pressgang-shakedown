# Testing roadmap

These are proposals, not available configuration options or delivery commitments.
The priority is clearer evidence for deployment decisions, with optional audits
kept separate from regression findings. Prefer existing Playwright capabilities
before adding dependencies or hosted services.

## CI and deployment integration

See the [CI and deployment specification](CI-DEPLOYMENT-SPEC.md) for proposed PR
and production workflows, structured outcomes, review gates, artifacts and
notification policy. The initial scope is a stable result contract and PR reporting;
retained-reference production comparisons follow separately.

## Priorities

1. **Optional Firefox and WebKit regression coverage.** Use Playwright's built-in
   browser engines. Compare reference and candidate within the same engine and
   viewport; disclose browser coverage in the report. Start with focused routes
   to manage runtime. This would help investigate Chromium/Firefox differences
   such as the PenARC overflow observations. [Browser documentation](https://playwright.dev/docs/browsers)
2. **Failure diagnostics linked from regression findings.** Evaluate retaining
   Playwright traces for failed or inconclusive captures, with DOM snapshots,
   screenshots and network evidence. Bound artifact size and keep anonymous,
   read-only transport protections. Ordinary attached/sandbox tests already
   retain failure traces; this proposal concerns regression-report integration.
   [Trace Viewer](https://playwright.dev/docs/trace-viewer)
3. **Evaluate ARIA snapshots for structural comparison.** Compare meaningful
   headings, links and controls using Playwright's accessible-tree snapshot
   support. Trial against saved examples before replacing existing collectors;
   disclose missing or incomparable evidence. This is structural regression
   evidence, distinct from an axe WCAG audit, and does not establish visual
   correctness. Production observations must not become approved baselines.
   [ARIA snapshots](https://playwright.dev/docs/aria-snapshots)

## Optional integrations to evaluate later

| Integration | Potential value | Boundary |
| --- | --- | --- |
| [playwright-lighthouse](https://github.com/abhinaba-ghosh/playwright-lighthouse) | Performance, SEO and best-practice audits | Separate opt-in audit; avoid turning variable scores into default deployment gates. Verify compatibility and transport protections before integration. |
| [Percy](https://www.browserstack.com/docs/percy/playwright/get-started) | Managed visual comparison and collaborative review | Consider only if team review needs justify a hosted service; overlaps with current visual reporting. |
| [Checkly](https://www.checklyhq.com/product/start-monitoring-with-playwright/) | Scheduled browser checks from multiple locations | Post-deployment monitoring, separate from local regression testing. |

No additional integration is required for ordinary Shakedown runs. Assess any
service's cost, artifact handling and maintenance burden before adopting it.

## Deferred exploration

Generic JavaScript interaction discovery remains deferred. A future experiment
could evaluate Stagehand/Jev for selecting carousel, tab or accordion controls,
initially in the isolation-proven sandbox. Selecting an action does not determine
whether its result is correct: repeatable state capture and explicit comparison
criteria remain necessary. Do not replace deterministic Playwright comparisons
with unconstrained exploration or introduce writes against real sites.

Background: [TypeSafe's Jev introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
and [Browserbase's Stagehand/Jev experiment](https://www.browserbase.com/blog/what-is-jev).
