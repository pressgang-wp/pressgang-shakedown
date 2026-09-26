# CI and deployment checks

Status: proposed; not implemented. This specification defines regression CI
integration in addition to the existing reusable sandbox workflow. Configuration,
output names and approval mechanisms below are proposed contracts, not commands
or settings users can use today.

## Purpose

Help a developer decide whether a PR or deployed release needs intervention.
Present application failures, changes needing review and missing evidence
separately. A successful run means the selected checks completed successfully;
it is not a guarantee of deployment safety.

Shakedown owns discovery, browser checks and evidence. The workflow owns preview
provisioning, publishing artifacts, enforcing repository policy and notifications.
It must not require Slack, a hosted visual service or an AI model to run.

## Workflows

### Pull request

1. Check out an identified PR revision and provision a preview through the
   consuming project's deployment tooling. The preview must attest which revision
   it serves; record whether testing the PR head or a synthetic merge revision.
2. Wait for bounded readiness checks. An unavailable preview produces an
   inconclusive result, not a passing check or an application regression.
3. Derive routes from that theme and its available WordPress installation using
   the existing Capstan/fallback path. CI needs WP-CLI access to that installation
   or a validated discovery artifact from the same preview revision. A URL alone
   is not a replacement for discovery. Artifact import is a future capability.
4. Compare the preview with the selected reference using the same browser,
   viewport and capture settings on both sides.
5. Upload the complete report bundle, publish a GitHub job summary and check, and
   create or update one identifiable PR comment. Publish available evidence even
   when testing fails.
6. Evaluate the gate policy for the exact tested revision. A newer commit makes
   the old gate result and review approvals inapplicable.

The preview needs representative content supplied by project infrastructure.
Shakedown does not import a production database or provision a site bundle.
Existing sandbox tests remain a separate lane for deterministic fixtures in a
proven disposable WordPress installation. Do not conflate sandbox correctness
with fidelity to production content.

### Production deployment

Run candidate application-health checks after the deployment tool confirms the
release identity and readiness. Tie the result to its deployment ID and revision.

Visual verification requires an independent reference: either a retained
pre-deployment capture or an explicitly reviewed capture artifact. Capturing
production twice after deployment does not establish release regressions.
Retained-reference comparison requires new artifact import and compatibility
validation; the current paired-origin runner does not provide it.

A retained capture is an observation, never automatically an approved baseline.
Record capture time, release identity, routes, browser version, viewport,
Shakedown version and effective configuration. Reject incompatible artifacts as
inconclusive. Disclose content drift and reference age; do not label every
content change a code defect. Preserve reference-only routes and discovery gaps
when comparing inventories from different releases.

Scheduled production checks may reuse the health lane. Deployment rollback,
issue creation and incident escalation are external policies; Shakedown does not
perform them automatically.

## Outcomes and gate policy

Execution state, findings and gate decision are separate fields.

| Outcome | Meaning | Default gate |
| --- | --- | --- |
| `passed` | Complete selected checks, no blocking failures or outstanding review findings | `allow` |
| `failed` | Complete run with policy-blocking findings | `block` |
| `review_required` | Complete run with unapproved visual/behaviour changes or advisory findings | `review` |
| `inconclusive` | Required evidence unavailable, empty, interrupted or incompatible | `block` |

Inconclusive takes precedence over failed in the headline; failures already
observed remain counted and visible. A cancelled/superseded run must never allow
promotion. Missing/malformed output or artifact-publication failure must not
produce an all-clear.

Policy is independent of check selection. Proposed category policies:

- Application health: `block` by default.
- Visual and behavioural differences: `review` by default; projects can choose
  advisory-only notification or require explicit approval before promotion.
- Accessibility: `advisory` by default in this proposed CI policy, with `block`
  available. Audit execution remains separately selectable. Axe severity is
  accessibility impact, not evidence of a newly introduced regression.
- Required coverage/capture failures: `block`. A declared sampled scope is not
  itself an incomplete run; missing required routes or captures is.

Every override, excluded check, accepted difference and suppression must appear
in the output. Existing CLI exit codes (0/1/2) remain backward compatible. The
workflow adapter must use the versioned gate result rather than treating exit 0
as visual approval. Introducing advisory accessibility policy requires separating
its findings from the current aggregated health-failure gate, without losing raw
severity or changing default CLI behaviour silently.

Map Shakedown outcomes to supported GitHub check conclusions in the adapter.
There is no custom GitHub conclusion called `review_required`. Advisory visual
checks can be non-blocking; a required promotion gate must remain unsatisfied
until review is approved. Do not hold a runner open while waiting for a person:
a separate trusted approval event reevaluates the gate.

## Machine-readable contract

Add `ci-summary.json`, distinct from detailed `run.json`, with an explicit
`schemaVersion`. Publish it atomically and validate it before downstream use.
Initialize a non-passing record early so setup failures can also be reported.
Unknown schema versions fail closed in the adapter.

Example (proposed schema):

```json
{
  "schemaVersion": 1,
  "runId": "run-example",
  "state": "complete",
  "outcome": "review_required",
  "gate": { "decision": "review", "policyDigest": "sha256:..." },
  "identity": {
    "repository": "organisation/theme",
    "testedRevision": "full-commit-sha",
    "prHeadRevision": "full-commit-sha",
    "deploymentId": "preview-123",
    "candidateOrigin": "https://preview.example.org",
    "referenceOrigin": "https://www.example.org"
  },
  "scope": {
    "level": "full",
    "coverage": "sampled",
    "browsers": ["chromium"],
    "viewports": ["desktop", "tablet", "mobile"],
    "accessibility": "off",
    "configDigest": "sha256:..."
  },
  "counts": {
    "observations": 207,
    "applicationFailures": 0,
    "unapprovedChanges": 2,
    "accessibilityFindings": 0,
    "inconclusive": 0
  },
  "findings": [
    {
      "id": "stable-logical-finding-id",
      "evidenceDigest": "sha256:...",
      "category": "visual",
      "path": "/about/",
      "browser": "chromium",
      "viewport": "desktop",
      "summary": "Appearance changed",
      "reportAnchor": "finding-stable-logical-finding-id"
    }
  ],
  "artifacts": {
    "reportPath": "index.html",
    "summaryPath": "summary.md",
    "rawPath": "run.json"
  }
}
```

The full schema must additionally specify timestamps, tool/browser versions,
reference capture identity, discovery coverage, skipped checks, accepted findings,
suppressions and structured errors. Counts describe explicit units: observations
are route/browser/viewport combinations; findings are not unique root causes.
A disabled audit is disclosed as skipped, not implied healthy by a zero count.

Finding IDs identify category/rule, normalized route, browser, viewport and a
stable element identity where available. Coordinates and timestamps must not
create new logical IDs. Separate evidence digests change when the actual finding
changes; logical deduplication must never carry an approval to new evidence.

The adapter adds actual uploaded artifact URLs and optional hosted report URLs.
Do not fabricate a browsable HTML link when the platform only offers a downloadable
artifact. Proposed workflow outputs: `outcome`, `gate`, `run-id`, `summary-artifact`,
`report-artifact`, and `report-url` when publishing is configured.

## Human-readable output

Use the same summary data for the GitHub check, job summary and PR comment:

> **Shakedown — review required**  
> Revision abc123 · Preview → Production  
> 69 routes · 207 observations · Chromium · Desktop/tablet/mobile  
> 0 application failures · 2 changes needing review · 0 inconclusive  
> Coverage: sampled · Accessibility: disabled  
> Review changes · Download report

List blocking failures first, then grouped review findings and coverage limits.
Each item needs a plain-language description, affected route(s), browser/viewport,
and a stable link to its evidence. Group repeated template-wide changes while
retaining all affected observations. Keep raw selectors, JSON and transport
restrictions behind details. Show original and changed screenshots at readable
scale. Do not invent a cause from a pixel mismatch.

Update one PR comment per workflow purpose using a stable marker. Identify stale
results explicitly; late completion of an older run must not overwrite the current
head's comment or gate. Use artifacts by default; report hosting is optional and
must preserve access controls. Set and disclose retention; expired evidence must
not leave a misleading review link or permit a fresh approval.

## Review approvals

An approval records the reviewer, time, tested revision, candidate deployment,
reference identity, scope/config/policy digests and exact evidence digests approved.
Only authorised repository reviewers can approve. New code, redeployment with
changed content/evidence, changed scope/policy or a changed reference invalidates
approval. Approval acknowledges specific review findings; it cannot waive an
incomplete run or application failure under a blocking policy.

Use a trusted GitHub approval mechanism or a validated workflow dispatch. Ordinary
PR comment text and a check emitted by untrusted PR code are not authorisation.
Retain an audit trail. Existing broad `regression.accept` patterns are disclosed
policy exceptions, not equivalent to this commit-bound approval mechanism.

## Notifications and downstream actions

Shakedown emits results; the consuming workflow owns Slack/webhook credentials,
channel selection, issue management and promotion actions. Keep these integrations
out of the browser runner and optional for all projects.

| Event | Default notification |
| --- | --- |
| PR result | Update GitHub check, job summary and single PR comment |
| PR newly blocked | Optional developer-channel message with owner and evidence |
| Visual review requested | Notify assigned reviewer if configured |
| Production healthy → failed | One alert to the deployment owner/developer channel |
| Unchanged production failure | Update existing incident/thread; no repeated alert |
| Production failed → healthy | One recovery message after a comparable successful run |
| Inconclusive | Distinct CI/environment alert; never a recovery |

Persist notification state outside ephemeral runners, keyed by repository,
environment and check scope. Use run/event IDs for delivery idempotency and stable
finding IDs plus evidence digests to detect changes. Record changed incidents as
updates; a reduced scope or disabled failing check must not claim recovery.
A new scheduled run is not an automatic retry hidden within the old report.

Slack messages should contain outcome, release/PR identity, a short reason, owner
and evidence link. Sending failure must be reported separately from the testing
result. Bound delivery retries; do not trigger an endless workflow/notification
loop. Downstream automation consumes validated structured output, not prose.
Automatic rollback is out of initial scope.

## Trust and operational constraints

- Preserve anonymous GET-only transport for attached/regression runs, including
  any new browser engines or capture mechanisms. Writes remain sandbox-only.
- Never expose deployment, publishing or notification secrets to untrusted fork
  PR code. Separate privileged reporting from test execution; validate artifacts,
  repository, revision and event identity before granting authority to results.
- Keep gate policy under trusted control. A PR cannot silently weaken the policy
  that authorises its own promotion.
- Use least-privilege workflow permissions. Treat page text, branch names, report
  content and artifact paths as untrusted data; escape output and prevent shell
  interpolation/path traversal.
- Private previews must be reachable by the chosen runner. Existing anonymous
  access restrictions remain; authenticated testing is not introduced by this spec.
- Pin runtime dependencies and record browser versions. Serialize production
  deployment verification; cancel superseded PR runs without discarding evidence.
- Bound duration, coverage and artifact sizes; disclose truncation. Upload report
  dependencies together. Do not publish sensitive screenshots or traces publicly
  merely to make an HTML link convenient.

## Delivery sequence and acceptance criteria

1. **Summary contract and gate evaluator.** Versioned schema and fixtures cover
   pass, failure, review, disabled audit, suppression, empty/incomplete runs and
   mixed failures. Invalid data never yields `allow`; legacy CLI exits remain.
2. **PR integration.** Add a separate reusable regression workflow, leaving the
   existing sandbox workflow intact. Demonstrate a provisioned preview, readiness
   failure, artifact upload on failure, one updated comment and stale-run handling.
3. **Review gate.** Prove approval applies only to authorised reviewers and exact
   revision/evidence; new evidence invalidates it. Advisory and required-review
   policies both have documented GitHub mappings.
4. **Production health and notifications.** Test initial alert, deduplication,
   recovery, inconclusive results, scope changes and failed notification delivery.
   Document a downstream Slack example without embedding credentials in Shakedown.
5. **Retained-reference visual checks.** Add capture import/compatibility checks
   and deployment identity binding before claiming post-deployment visual coverage.
   Test missing, expired, mismatched and stale reference evidence.

Documentation must distinguish shipped features from these proposed contracts.
Browser expansion and richer diagnostics remain tracked in the
[testing roadmap](ROADMAP.md); they are not prerequisites for the first CI release.
