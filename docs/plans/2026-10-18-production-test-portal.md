# Implementation plan: production test portal

**Document type:** requirements, technical specification, implementation plan, and operational acceptance criteria.

**Date:** 2026-10-18, Asia/Bangkok.

**Repository baseline inspected:** 916d8943f51d1cf29c4e267db6e33d3ec4afa042.

**Status:** planning artifact; application code has not been changed and no production tests have been executed for this document.

**Planning approach:** software-implementation-planner, L10-engineer, and production-engineer-mindset. Correctness, explicit ownership, and the smallest complete design take priority over adding infrastructure.

Paths below are repository-relative. Existing paths are evidence; new paths are explicitly marked **proposed**. “Verified” means source was inspected, not that its behavior was demonstrated against a deployed environment.

## 0. Context and current behavior

### 0.1 Goal

Provide one protected web portal from which an operator can select, run, observe, cancel, and inspect every supported application test family, including tests against the real production deployment.

Current behavior is several CLI harnesses and partially overlapping control pages with transient state. Desired behavior is one authenticated, durable controller with an explicit suite catalog, isolated execution environments, reliable outcomes, and production test-data ownership.

### 0.2 Decisions already made with the user

| Decision | Agreed behavior |
| --- | --- |
| Product location | A separate web portal, extending the existing load runner |
| Execution owner | The runner hosts all application suites; GitHub Actions is not the portal execution backend |
| Hosting | Railway |
| Coverage | Frontend checks, unit/coverage tests, coedit, Go tests, browser families, production smoke/journeys, k6, and browser-plus-k6 |
| Production data | Dedicated synthetic data; never real candidate schedules |
| Fixture preparation | Fresh exams, schedules, and rosters per state-changing scenario where the existing APIs support them |
| Advanced fixture exception | Suites requiring pre-admitted attempts, specific adaptive state, or prepared tokens expose explicit prerequisites |
| Production load | Up to 400 concurrent candidate API users, plus a sample of 10–20 real browsers |
| Authentication | A dedicated portal operator login |
| Advanced SAT / scale proof | Preserve staging restrictions |
| Docker image checks | Stay in existing CI; no Docker daemon inside the Railway test service |
| Run all | Block before execution if any selected suite lacks prerequisites |

The 400-user limit concerns concurrent candidate load, not 400 browser windows, 400 requests per second, or a guaranteed application capacity. A hybrid scenario can create 420 candidate identities: 400 API candidates plus 20 different browser candidates. Staff/control requests are reported separately.

### 0.3 Repository evidence

| ID | Behavior / observation | Inspected source and symbols | Evidence status |
| --- | --- | --- | --- |
| E-01 | Existing public Express control page exposes start, stop, logs, and previews; run state is in process memory | [load-runner/ui-server.mjs](../../load-runner/ui-server.mjs), app routes, proc, state, logLines, liveCards | Verified |
| E-02 | Start logs the entire request body, including potential grading passwords; it accepts a caller-supplied k6 script and inherits process.env | Same file, POST /api/start, lines 178–229 at this baseline | Verified |
| E-03 | Start forces K6_CONFIRM_PROD=true; stop signals only the immediate child; a null exit code is converted to zero | Same file, environment construction, POST /api/stop, exit callback | Verified |
| E-04 | Existing hybrid shell command returns the browser status and terminates k6 when the browser command ends | [package.json](../../package.json), e2e:live-with-k6; [load-runner/package.json](../../load-runner/package.json) | Verified |
| E-05 | IELTS browser runner writes failed-candidate counts to JSON without making every candidate failure a nonzero process exit | [e2e/prod-load/live-multi-user-runner.ts](../../e2e/prod-load/live-multi-user-runner.ts), run summary / final exit path | Verified |
| E-06 | SAT browser runner has richer fatal-join and frame metrics; ordinary summary failures still require result inspection | [e2e/prod-load/live-sat-runner.ts](../../e2e/prod-load/live-sat-runner.ts), run, summary, process.exitCode | Verified |
| E-07 | Production target validation currently requires exactly 200 students and 10 proctors; credentials also require 10 proctors | [e2e/support/prodData.ts](../../e2e/support/prodData.ts), prodTargetSchema, prodCredSchema | Verified |
| E-08 | k6 student selection clamps requested count to roster length, so a request for 400 with 200 identities can run fewer than requested | [k6/prod-load-helpers.js](../../k6/prod-load-helpers.js), buildStudentSlice | Verified |
| E-09 | Existing API bootstrap creates, saves, publishes, and schedules an IELTS exam; it requires explicit bootstrap consent | [e2e/support/prodBootstrap.ts](../../e2e/support/prodBootstrap.ts), buildIeltsLikeState, bootstrapExamAndSchedule | Verified |
| E-10 | The production control-plane suite can provision staff and assignments by direct database access when flags enable it | [e2e/prod-load/00-control-plane.spec.ts](../../e2e/prod-load/00-control-plane.spec.ts), ensureStaffCreds, ensureProctorAssignments | Verified |
| E-11 | Current schedule HTTP creation has no assignment collection; inspected route registration exposes no proctor-assignment write route | [backend/go/cmd/api/handlers_admin.go](../../backend/go/cmd/api/handlers_admin.go), schedulesCreateHandler; [backend/go/cmd/api/main.go](../../backend/go/cmd/api/main.go), schedule routes | Verified, within inspected routing |
| E-12 | Staff assignments already have a table and direct provisioning code; current indexes do not enforce unique active grants | [backend/go/migrations/0005_scheduling_and_access.sql](../../backend/go/migrations/0005_scheduling_and_access.sql), schedule_staff_assignments; [backend/go/cmd/e2e_provision_staff/main.go](../../backend/go/cmd/e2e_provision_staff/main.go), ensureProctorAssignment | Verified |
| E-13 | Route authorization denies unknown routes and requires a policy entry plus handler scope enforcement | [backend/go/internal/authz/authz.go](../../backend/go/internal/authz/authz.go); [backend/go/internal/authz/table_staff.go](../../backend/go/internal/authz/table_staff.go) | Verified |
| E-14 | Local E2E starts Go API/worker, coedit, and Vite; production suites have separate configs; local projects include seven browser/device projects | [playwright.config.ts](../../playwright.config.ts); [playwright.prod-load.config.ts](../../playwright.prod-load.config.ts); [playwright.prod-smoke.config.ts](../../playwright.prod-smoke.config.ts) | Verified |
| E-15 | Legacy remote E2E can run destructive seed setup and defaults to a production URL | [playwright.remote.config.ts](../../playwright.remote.config.ts); [e2e/remote-global-setup.ts](../../e2e/remote-global-setup.ts) | Verified; must not be a production portal adapter |
| E-16 | Real database tests require MySQL and can skip when TEST_MYSQL_DSN is absent | [backend/go/integration/integration_test.go](../../backend/go/integration/integration_test.go), testDB; [.github/workflows/ci.yml](../../.github/workflows/ci.yml), MySQL contract jobs | Verified |
| E-17 | Root Vitest separates browser helper tests and coedit tests; helper tests have a dedicated Node config | [vitest.config.ts](../../vitest.config.ts); [vitest.prod-load.config.ts](../../vitest.prod-load.config.ts); [services/authoring-coedit/vitest.config.ts](../../services/authoring-coedit/vitest.config.ts) | Verified |
| E-18 | Canonical and standalone-runner trees contain copies of test harnesses; the standalone tree includes an additional transition-reconciliation script | [load-runner/e2e/prod-load](../../load-runner/e2e/prod-load); [load-runner/k6](../../load-runner/k6); root e2e and k6 trees | Verified inventory; semantic differences require an explicit comparison |
| E-19 | Root Docker exclusions omit e2e, k6, and load-runner; existing runner image does not install Go and installs unpinned k6 | [.dockerignore](../../.dockerignore); [load-runner/Dockerfile](../../load-runner/Dockerfile) | Verified |
| E-20 | Coedit live config constructs a shell MySQL command from a DSN, including a password argument | [playwright.coedit-live.config.ts](../../playwright.coedit-live.config.ts), DB_BOOTSTRAP | Verified; portal must pre-provision safely and bypass this shell bootstrap |
| E-21 | Current production section-transition test needs a schedule permitting overrides; authentic IELTS and adaptive SAT reject that action | [k6/prod-section-transition-200.js](../../k6/prod-section-transition-200.js); [backend/go/internal/proctor/service.go](../../backend/go/internal/proctor/service.go), EndSection-related policy | Verified |
| E-22 | SAT and scale suites include staging-specific requirements and large native proof targets | [k6/README.md](../../k6/README.md); [k6/scale-proof/README.md](../../k6/scale-proof/README.md); SAT scenario sources | Verified |
| E-23 | Current Railway account resources, active production/staging configuration, credentials, and deployed version are not known from source inspection | Deployment environment | Unknown / verify before live enablement |
| E-24 | Standard SAT fixture creation can reuse existing provider creation, complete sample generation, authoring load-sample, publish, and access-link APIs; the local SAT helper also has an optional direct-SQL timing branch that must not be imported into a remote adapter | [src/services/examLifecycleService.ts](../../src/services/examLifecycleService.ts), createProviderExam; [src/features/exam-authoring/providers/sat/sampleExam.ts](../../src/features/exam-authoring/providers/sat/sampleExam.ts), buildCompleteSatSample; [src/features/exam-authoring/api/assessmentAuthoringApi.ts](../../src/features/exam-authoring/api/assessmentAuthoringApi.ts), loadSampleExam; [src/features/exam-authoring/api/assessmentAccessLinksApi.ts](../../src/features/exam-authoring/api/assessmentAccessLinksApi.ts), create; [e2e/support/satStudentSession.ts](../../e2e/support/satStudentSession.ts), createRunningSatSession | Verified contracts; remote fixture success not yet demonstrated |

### 0.4 Boundaries and non-goals

In scope: a separate control surface, durable orchestration, test adapters, necessary harness corrections, a small authenticated proctor-assignment capability, Railway packaging, and evidence-backed verification.

Out of scope: arbitrary shell execution, arbitrary git checkout or branch execution, SSO, recurring schedules, production database access from the runner, creating production staff credentials, deleting production test records automatically, Docker image validation, distributed 400-browser execution, and changing exam security or timing policies to make tests pass.

No Redis, message broker, new control database, distributed scheduler, or production application tables are needed for the portal itself.

## 1. Requirements

### 1.1 Functional requirements

| ID | Priority | Observable behavior | Acceptance criterion |
| --- | --- | --- | --- |
| FR-1 | P0 | An authenticated operator can browse every supported application test family and understand where it executes | Every discovered entrypoint is cataloged as executable, an alias, a helper, or an explicitly explained legacy/excluded command; no production-only behavior is presented as a local mock test |
| FR-2 | P0 | The operator can configure, preflight, and enqueue a suite selection or Run all | Every selected canonical suite is validated before acceptance; one missing prerequisite yields a complete blocker list and zero fixture creation or workload launch; duplicate creation requests return the original run |
| FR-3 | P0 | State-changing production tests create and use fresh, owned synthetic fixtures through application APIs | Every mutated schedule is linked to the current suite execution's recorded exam/schedule creation; production DB mutation flags are forced off; fresh proctors are assigned through the scoped API, not SQL |
| FR-4 | P0 | The operator can run production k6 at the requested candidate concurrency, including 400, with an independent browser sample | A 400-requested profile has at least 400 distinct API identities, up to 20 disjoint browser identities, no silent count clamping, and recorded requested/configured/achieved figures |
| FR-5 | P0 | The operator sees accurate live progress and terminal results | A run passes only when all selected suites execute and pass their native assertions, required reports exist, mandatory contracts execute, and hybrid components both succeed |
| FR-6 | P0 | The operator can cancel queued or active work, reconnect, and inspect history after a restart | Cancellation is idempotent; no subsequent suite starts after accepted cancellation; restart preserves records, marks in-flight work interrupted, and never replays production side effects |
| FR-7 | P0 | The operator can inspect and download protected evidence for 14 days | Logs and artifacts are authenticated, bound to their run, bounded in size, protected from path traversal and report-script execution, and expiration is explicit |

P1 enhancements, outside the required initial delivery: run-to-run comparison charts, named custom presets, multiple operator accounts, and external artifact storage. The P0 delivery must not depend on these.

### 1.2 Non-functional requirements

| ID | Constraint | Target / chosen default | Design or verification consequence |
| --- | --- | --- | --- |
| NFR-1 | Security and environment isolation | Unauthenticated control access is denied; production has no DB credentials; only configured origins and owned fixtures are permitted | Auth/CSRF tests, negative target tests, environment allowlist tests, role/scope API tests, restricted artifact serving |
| NFR-2 | Durable and ordered control decisions | An acknowledged run or cancellation survives a process restart; one controller and one workload run at a time | Atomic manifest replacement with sync, serialized mutations, exclusive volume lock, crash-boundary tests |
| NFR-3 | Load fidelity and bounded work | Production candidate cap 400 k6 + 20 browsers; pending queue cap 20; actual load is reported separately from intent | Validate rosters and effective k6 options, cap every candidate scenario rather than only total VU fields, measure pilot runs |
| NFR-4 | Honest outcomes and recoverability | No pass from null exits, failed summaries, missing reports, partial suites, unresolved fixture outcomes, or ambiguous cleanup | Normalize reports, preserve failure categories, fence dispatch after cleanup/storage faults, document manual reconciliation |
| NFR-5 | Operability and usable control UI | 14-day evidence retention; bounded logs/SSE; keyboard-accessible run/config/cancel/results flow | Fake-clock quota/retention tests, slow-client tests, browser/a11y checks, observable health and degraded state |

No new production application latency SLO is invented. Existing script thresholds remain authoritative. Generator responsiveness and resource budgets are measured in rollout rather than claimed from configuration.

## 2. Core entities and invariants

### 2.1 Entities and authority

| Entity | Owner / source of truth | Important fields and lifecycle |
| --- | --- | --- |
| OperatorSession | Portal auth module; in-memory session registry | Random opaque session ID hash, operator ID, CSRF secret, issued/expiry timestamps; restart invalidates sessions but does not cancel a valid running workload |
| TargetProfile | Trusted server configuration | Stable ID, explicit environment class, approved HTTPS origin, test organization/account bindings, credential reference, profile revision, staging fixture references; API exposes only non-secret fields |
| SuiteDefinition | Versioned catalog bundled with the image | Stable ID, adapter, environment policy, prerequisites, parameter schema, canonical entrypoints, control owner, timeout, mandatory outputs, native capacity requirement |
| PreflightResult | Derived snapshot; not execution authority | Canonical suite list, parameters, target revisions, catalog/image revision, blockers, effect summary, confirmation digest; no exam/schedule creation |
| RunRecord | One durable manifest per accepted run | Schema version, run ID, idempotency key/digest, admission sequence, operator ID, approved selection, target snapshots, status/revision, suite records, audit decisions, result/evidence references |
| SuiteExecution | Nested in RunRecord | Execution ID, suite ID, target ID, status, fixture ledger, control owner, process identities, requested/effective load, deadlines, normalized result |
| FixtureOperation | Nested durable intent/result ledger | Operation ID, kind, deterministic correlation, planned/requested/confirmed/unknown status, returned resource IDs; remote system remains authoritative about remote commits |
| Artifact | Manifest metadata plus immutable completed file | Generated artifact ID, suite/run owner, allowlisted relative path, media type, size, SHA-256, availability/expiry; never user-selected filesystem paths |

The authoritative queue is the set of committed queued RunRecords, ordered by admission sequence. Any in-memory map, listing index, SSE event, dashboard card, or JSONL log is derived and rebuildable.

### 2.2 State transitions

Run states:

~~~text
queued -> preparing -> running -> finalizing -> passed | failed
queued -> cancelled
preparing | running | finalizing -> stopping -> cancelled
preparing | running | finalizing | stopping -> interrupted   [restart / lost execution ownership]
queued | preparing -> blocked                              [dispatch-time prerequisite drift]
~~~

Terminal states are passed, failed, cancelled, interrupted, and blocked. A terminal run is immutable except artifact availability/expiration metadata and an appended reconciliation note. Rerun creates a new run ID and new fixture identities.

Suite states additionally include pending and not_run. A failure stops the remaining batch by default; unstarted suites become not_run with a reason. This makes a partial Run all visibly unsuccessful. There is no silent “skip and pass.”

Queued records surviving restart remain held until an operator releases the queue. Release re-runs preflight for held records; it does not resume an interrupted suite. Records from another image/catalog revision stay blocked and must be recreated.

### 2.3 Invariants

| ID | Invariant |
| --- | --- |
| INV-1 | At most one controller can hold the attached portal volume lock, and at most one run can own dispatch within that controller |
| INV-2 | Within the 14-day retained-record window, the same operator and idempotency key identify one canonical creation payload and one run; a different payload under that key is a conflict |
| INV-3 | HTTP acceptance is returned only after the authoritative decision is durably committed; failed persistence never authorizes a workload |
| INV-4 | Remote workload host, credential binding, exam IDs, and schedule IDs come from approved profiles plus the current execution's ledger, never caller-supplied paths or inherited production defaults |
| INV-5 | Local test processes cannot receive production credentials, and remote test processes cannot receive database credentials or seed/provisioning authority |
| INV-6 | Requested counts cannot be silently reduced; API and browser candidate identities are distinct; production caps include all candidate scenarios and leave staff/control VUs explicitly accounted for |
| INV-7 | Each schedule has one designated runtime controller; hybrid execution never races two independent start/end/complete controllers |
| INV-8 | Pass requires valid required evidence and all selected assertions; cancellation, signal termination, failed candidates, dropped load, and missing mandatory tests are never passes |
| INV-9 | Once cancellation is committed, no new fixture mutation or child launch can begin for that run; an already in-flight remote request may still commit and must be recorded as confirmed or unknown |
| INV-10 | Late process events can update only their matching run/execution/generation; terminal result callbacks cannot be overwritten by stale or duplicate events |
| INV-11 | After restart, in-flight remote mutations and workloads are not automatically retried; uncertain outcomes remain explicit until reconciled |
| INV-12 | The portal serves only authenticated, manifest-listed artifacts; raw reports cannot execute scripts with the portal's origin privileges |
| INV-13 | Secrets do not enter persisted run configuration or ordinary logs; secret files are ephemeral and removed after execution or stale-workspace recovery |
| INV-14 | Database suite credentials can modify only the disposable test schema namespace; production DB endpoints are not configured in this service |
| INV-15 | The new proctor-grant HTTP path is idempotent under concurrent retries, derives the grantor from auth context, and cannot grant across actor/organization scope |

INV-15 applies to the new HTTP grant path. Existing direct SQL provisioning tools do not share its locking protocol and must not run concurrently against the same schedules. No global exactly-once guarantee is claimed for remote API effects or manual database writes.

## 3. API / interface changes

All interfaces in this section are **proposed**, except the application APIs explicitly identified as existing. The separate portal owns a versioned /api/v1 namespace; it does not add runner endpoints to the public exam application's server.

### 3.1 Authentication and control endpoints

| Method and route | Contract |
| --- | --- |
| POST /api/v1/auth/login | JSON username/password; exact-origin check; verify configured scrypt hash; rotate session; return operator and session-bound CSRF token |
| GET /api/v1/auth/session | Return authenticated operator, expiry, CSRF token, controller readiness, queue-hold reason; no secret config |
| POST /api/v1/auth/logout | Revoke session and clear cookie; authenticated mutations require CSRF |
| GET /api/v1/suites | Catalog and parameter schemas, native environment/capacity rules, aliases, and current readiness explanations |
| GET /api/v1/targets | Approved non-secret profiles and their readiness; never credentials, secret paths, or bearer tokens |
| POST /api/v1/runs/preflight | Validate complete selection without creating fixtures or launching tests; return canonical plan, blockers, and a short-lived confirmation digest |
| POST /api/v1/runs | Validate/commit an approved run using Idempotency-Key; return 202 with the durable run ID, revision, status, and status URL |
| GET /api/v1/runs | Cursor-paginated history, ordered by admission sequence, maximum 100 rows per page |
| GET /api/v1/runs/:runId | Authoritative sanitized run snapshot and result/evidence metadata |
| POST /api/v1/runs/:runId/cancel | Idempotent durable cancellation; return committed snapshot with 202 while stopping, 200 if already terminal |
| POST /api/v1/controller/release-queue | Explicitly release restart-held queued work after revalidation; cannot resume interrupted work or bypass blockers |
| GET /api/v1/runs/:runId/events | Authenticated SSE with revisioned state snapshots, bounded log replay, progress, and monitor updates |
| GET /api/v1/runs/:runId/artifacts/:artifactId | Resolve an artifact ID through its manifest; streamed attachment by default; 410 after known expiration |
| GET /healthz | Minimal public liveness, no config/run details |
| GET /readyz | 200 only when controller recovery/locking/storage initialization completed; workload admission issues are reported to authenticated clients |

Request example; IDs are illustrative configured identifiers, not discovered production targets:

~~~json
{
  "selection": {
    "mode": "selected",
    "suiteIds": ["quality.frontend", "prod.ielts.hybrid-start"]
  },
  "targetBindings": {
    "isolated": "railway-disposable",
    "production": "production-test-account"
  },
  "parameters": {
    "apiCandidates": 400,
    "browserCandidates": 20,
    "browserConcurrency": 20
  },
  "approval": {
    "preflightDigest": "server-issued-digest",
    "confirmProduction": true,
    "confirmSyntheticFixtures": true
  }
}
~~~

For Run all, the server expands the canonical catalog and returns that exact ordered list during preflight. The accepted manifest freezes that list. Changes to catalog/profile/parameters invalidate approval. The digest expires after 10 minutes for initial admission; queued work still receives dispatch-time revalidation. This expiration is a proposed portal safety default, not an existing repository policy.

Unknown fields are rejected. The client cannot send shell text, raw environment overrides, filesystem locations, proctor actor/grantor fields, workload URLs, passwords after login, or arbitrary schedule IDs.

### 3.2 Error and retry semantics

Use a portal-local JSON envelope:

~~~json
{
  "error": {
    "code": "PREREQUISITES_MISSING",
    "message": "The selection is not ready.",
    "details": [{"suiteId": "staging.sat.module-entry", "requirement": "prepared-attempts"}],
    "requestId": "generated-correlation-id"
  }
}
~~~

| Status | Meaning |
| --- | --- |
| 400 | Invalid shape, unknown suite/parameter, forbidden path/URL/env input, invalid range |
| 401 | Missing, expired, or invalid operator session |
| 403 | Invalid CSRF/origin, environment policy violation, disabled production execution |
| 404 | Unknown run/artifact; application assignment scope also collapses unauthorized resources to 404 |
| 409 | Idempotency payload conflict, stale approval/profile, queue limit, controller drain/hold |
| 410 | Artifact known to have expired |
| 422 | Selection is well formed but prerequisites or fixture capabilities are missing |
| 429 | Login/control rate limit, with Retry-After |
| 503 | State storage unavailable, controller ownership unavailable, or recovery incomplete |

Client creation retries reuse the same Idempotency-Key and identical payload. A lost 202 response is recovered by retrying that request, not creating another run. Deduplication is serialized inside the sole controller and rebuilt from manifests on startup.

No automatic retry is permitted for an ambiguous remote create/control operation unless that particular application endpoint has a verified idempotency/revision contract. Network timeout is not evidence that a remote mutation failed.

### 3.3 Required application capability: scoped proctor grant

**Proposed additive endpoint:** PUT /api/v1/schedules/{scheduleId}/staff/proctors/{userId}.

This closes the verified gap between fresh schedules and the existing multi-proctor browser suite without giving the runner production SQL access.

- Caller: authenticated application admin used by the dedicated fixture adapter, with normal application session/CSRF requirements.
- Body: empty JSON object; role is fixed to proctor. Grantor is the authenticated actor. Caller cannot set actor_id, role, granted_by, organization, or an assignment ID.
- Scope: schedule must belong to the caller's organization and have been created by that admin. Preserve the application's existing null-organization semantics: a null-scoped actor may grant only to a null-scoped owned schedule and null-scoped user.
- Target user: an existing active application user with role proctor and the same organization as the schedule. Do not create staff, change roles, reset passwords, or use admin accounts as proctor substitutes.
- Success: 201 for a new grant; 200 with the same active assignment on replay. Return only assignment ID, schedule ID, user ID, and fixed role.
- Transaction: lock the schedule row; enforce scope; lock/read the target user; check active assignments by user_id and the existing actor_id convention; return the one existing grant or insert one. Existing duplicate active rows are a 409 integrity blocker, not an excuse to insert another.
- All requests to this endpoint use the same schedule-row lock, making its concurrent retries idempotent. The endpoint is additive, not a replace/revoke collection API.
- No live-state restriction is introduced as an authorization mechanism. The portal calls this only during its own fresh-fixture preparation; a separate schedule-start transaction protocol is unnecessary for an additive authorized grant.
- Register the route through authzRoute and add its precise mount-relative policy in table_staff.go. Enforce owner/organization scope in the handler/service, not only middleware.
- Use existing application error conventions and tx.Runner; do not reuse the portal error envelope in Go.

Existing production accounts and their credentials remain an operator provisioning prerequisite. A profile needing the original ten-proctor test must contain ten distinct, active proctor accounts; one credential repeated ten times is invalid.

### 3.4 Internal adapter contracts

**Proposed types**, implemented under the runner; identifiers are design contracts:

~~~typescript
type ExecutionEnvironment = "isolated" | "staging" | "production";
type ControlOwner = "suite" | "k6" | "portal";

interface NormalizedResult {
  outcome: "passed" | "failed" | "cancelled" | "interrupted";
  failureKind: "assertion" | "infrastructure" | "capacity" | "precondition" | null;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  requestedCandidates: number | null;
  configuredCandidates: number | null;
  achievedCandidates: number | null;
  evidenceComplete: boolean;
  thresholdFailures: string[];
}
~~~

Every adapter has validate, prepare, execute, collect, and cleanup responsibilities. Only the orchestrator changes authoritative run state; adapters return events/results tagged with execution ID. Cleanup failure is separately reported and fences further dispatch when workload ownership cannot be proven clean.

## 4. Critical data flow

### 4.1 Preflight and durable acceptance

1. Operator authenticates and selects suites/parameters/approved profile IDs.
2. Preflight validates catalog coverage, environment compatibility, credentials/binaries, native options, prepared fixture freshness, roster requirements, storage, and current controller readiness. Authentication probes may create normal application login sessions; they do not create exam fixtures or start workloads.
3. UI renders exact scenarios, environments, candidate counts, staff/control overhead, required mutations, native capacity claims, and all blockers.
4. Operator submits the approved canonical payload and idempotency key.
5. The controller's mutation lane checks duplicate key/payload, approval digest, queue size, and target/catalog revisions.
6. It creates a RunRecord containing the decision, admission sequence, actor, and immutable selection; writes a same-directory temporary file, syncs it, renames atomically, and syncs the parent directory.
7. Only after commit does it update derived indexes and return 202. A response lost after this point is deduplicated. A failed write returns 503 and cannot authorize execution.

### 4.2 Dispatch and fixture preparation

1. Dispatcher selects the oldest eligible committed queued record and revalidates prerequisites. A failed revalidation produces blocked, with no fixture effects.
2. Commit preparing and a unique SuiteExecution before any child launch or remote mutation.
3. Create a suite-specific scratch workspace from the immutable image source, with read-only shared dependency resolution and isolated generated files. Secret material stays outside persisted artifacts.
4. For local suites, create a disposable schema on the dedicated test MySQL service, migrate it, generate test-only runtime environment, and start the configured local stack.
5. For remote scenarios, resolve API credentials server-side; verify principal/organization and approved origin; commit each fixture intent before invoking its existing application API.
6. Persist returned exam, published-version, schedule, grant, registration, and link IDs before proceeding. A suite may mutate only this ledger's resources. A different scenario gets a different schedule.
7. Validate the final fixture mode and readiness against the scenario, then generate absolute target/credential/roster paths in the scratch secret directory.

### 4.3 Spawn, observation, and outcome commit

1. Commit launching intent with execution token, deadline, and expected reports.
2. Attach spawn error/exit/close listeners and launch fixed binary/argument arrays with shell disabled at the portal boundary. Checked-in test tooling may itself start subprocesses; it receives no caller-provided shell values.
3. Record PID plus Linux process start identity; tag the workload environment with run/execution IDs; commit running.
4. Stream redacted logs and revisioned snapshots. Browser monitor traffic stays on loopback internally and is exposed only through authenticated portal endpoints.
5. On close, drain output, parse required reports, compare configured/achieved work, gather artifact metadata, and clean up owned processes/ephemeral secrets.
6. Commit finalizing, then the terminal suite/run result. Artifacts must be fully written and synced before a passing manifest references them.
7. Start the next suite only if the run is still authorized, not cancelled, and the prior execution left no uncontrolled processes.

### 4.4 Cancellation, crash, and ambiguous external commits

- Serialize cancellation with admission/dispatch transitions; commit cancelRequestedAt before acknowledging it.
- Check cancellation immediately before each remote mutation and each child spawn. If cancellation wins that order, do not launch; if launch wins, stop and reconcile the launched work.
- Stop both hybrid components; allow 10 seconds for graceful termination, then force-stop owned workload processes and wait up to 5 further seconds for verified cleanup.
- A process receiving a signal is not proof it has exited. Chromium may have additional process groups; process-group signaling alone is insufficient.
- On startup, take the exclusive volume lock, rebuild records, quarantine corrupt manifests, remove stale secrets, mark nonterminal in-flight runs interrupted, and hold surviving queued runs.
- A create request can commit remotely before a crash prevents the returned ID from being saved. Record the operation as unknown, stop preparation, and expose its deterministic correlation for reconciliation. Never blindly replay it or claim rollback.
- Cancellation stops generated traffic; it does not undo submitted answers, started schedules, or other already committed application effects.

## 5. Recommended design

### 5.1 Smallest complete topology

~~~mermaid
flowchart LR
    O[Operator browser] --> P[Railway portal controller]
    P --> V[(Attached volume: run manifests and artifacts)]
    P --> W[Bounded child workload: one run]
    W --> T[(Private disposable test MySQL)]
    W --> L[Local API / worker / coedit / Vite]
    W --> S[Approved staging app]
    W --> R[Approved production app APIs]
~~~

Use the existing Express dependency and a separately built React frontend. The controller and child workload share one dedicated Railway service/container. This avoids introducing worker RPC, shared-volume coordination, or another control database. The test MySQL service is a separate resource from the production database.

Railway documents that volumes do not support replicas and prevent simultaneously active deployments from mounting the same service volume. This makes the selected single-controller design appropriate and means portal redeployment has brief downtime. Add an OS exclusive lock for same-container/operator mistakes; do not represent the lock as a general distributed lease. [Railway volume reference](https://docs.railway.com/volumes/reference)

### 5.2 Responsibility ownership

| Responsibility | Single owner |
| --- | --- |
| Session, CSRF, login throttling, HTTP policy | Portal auth/HTTP boundary |
| Permitted commands, parameters, environment class, native proof capacity | Suite catalog |
| Profile/fixture ownership, secret references, remote host binding | Target/fixture adapter |
| Authoritative transitions, cancellation ordering, queue selection | Orchestrator |
| Durable decisions and derived-index rebuild | Run store |
| Spawn/error/signal handling, process identities, deadlines | Process supervisor |
| Framework output interpretation and workload completion checks | Result adapters |
| Log redaction, monitor backpressure, artifact serving/retention | Evidence subsystem |
| Application-side staff authorization and assignment transaction | Existing Go schedule/authz boundary |
| UI selection/confirmation/status presentation | Separate portal frontend; never authorization authority |

### 5.3 Proposed module layout and compatibility

Use these **proposed** locations; keep modules focused rather than growing the current inline-HTML server:

~~~text
load-runner/
  portal/
    server.ts                  # Express composition and HTTP routes
    contracts.ts               # Zod schemas and shared sanitized types
    auth.ts                    # dedicated operator sessions and CSRF
    catalog.ts                 # fixed suite definitions and aliases
    targets.ts                 # trusted profile resolution and preflight
    run-store.ts               # atomic manifests and recovery
    orchestrator.ts            # sole state transition / dispatch owner
    process-supervisor.ts      # processes, deadlines, cancellation
    evidence.ts                # safe logs, streams, artifacts, retention
    adapters/                  # framework results and fixture integration
    __tests__/                 # contracts, failure boundaries, integration
  web/                         # separate React entrypoint and views
  vite.portal.config.ts        # separate assets, no exam-router integration
  tsconfig.portal.json          # explicit runner/frontend checking
  vitest.portal.config.ts      # Node and UI test ownership
  Dockerfile.dockerignore      # root-context runner-specific exclusions
  start-portal.sh              # init / exclusive lock / Node entrypoint
~~~

Modify inspected load-runner/ui-server.mjs into a narrow authenticated-compatible entrypoint or retire it with a documented replacement; do not keep a second unauthenticated mutation surface. Legacy /api/start and /api/stop return 410 with replacement guidance. Existing CLI scripts remain usable.

The new image builds from repository root and uses root package.json and bun.lock. The portal must not resolve duplicated standalone-runner scripts. Compare copied harnesses first; port meaningful standalone-only behavior into the canonical tree with verification, or catalog the one distinct scenario through a verified canonical adapter. Do not blindly delete copied files or break a separate deployment.

Add proposed root scripts portal:dev, portal:build, portal:start, portal:typecheck, and portal:test. Bun owns installation/script invocation; Node executes the server via the already installed tsx loader. Use a dedicated portal typecheck because root tsconfig excludes e2e. Keep portal output outside root dist and update ESLint/Vitest exclusions so generated portal assets are not treated as application source. Explicitly exclude the runner's Node/UI test trees and runtime code from the root product coverage gate; the dedicated portal config owns their tests and coverage. Keep root and portal TypeScript ownership explicit so Node-only modules do not become part of the product typecheck/bundle by accidental discovery.

### 5.4 Canonical suite catalog

| Catalog family | Existing source / executable ownership | Environment and important policy |
| --- | --- | --- |
| quality.frontend | Root typecheck, lint, build, test:student-bundle; coverage as the canonical full frontend unit run | Isolated; unit-only is an alternative to coverage, not a second identical Run all execution |
| quality.coedit | coedit:typecheck and coedit:test | Isolated Node service tests |
| unit.runner | test:live-runner using vitest.prod-load.config.ts | Isolated Node helper tests |
| unit.portal | Proposed portal:test | Isolated; controller integration uses fixture children, never recursive production dispatch |
| performance.frontend | test:performance | Isolated; preserve assertions and report test scope |
| backend.go | CI-aligned format check, vet, build, JSON test output, real-MySQL integration/contracts, and internal race tests | Isolated schema; migrations first; required MySQL contracts must execute, not skip |
| browser.local | playwright.config.ts, all seven configured projects | Isolated local stack; no retargeting the destructive seed to production |
| browser.specialized | SAT accessibility, adaptive reading, annotations, answered print, authoring, auto-fit, code start, results, screen zoom, spectrum, staff UX, transition, touch selection, and coedit-live configs | Isolated; preserve each config's test matching, browser projects, and test doubles |
| prod.smoke | playwright.prod-smoke.config.ts | Explicit staging/production profile and test staff credentials |
| prod.ielts.browser | playwright.prod-load.config.ts plus the live IELTS runner as distinct journey modes | Fresh owned fixtures; proctor roles preserved; portal does not use DB staff provisioning |
| prod.ielts.k6 | prod-start-exam, section-transition, submit-storm, resume, auto-submit, and exam-day | Explicit production confirmation, per-scenario fixture capability and count checks |
| prod.ielts.hybrid | Canonical IELTS browser runner plus an explicitly compatible k6 scenario | k6 owns runtime control; browser runner follows the same schedule on disjoint identities; incompatible pairs rejected |
| remote.sat.browser | live-sat-runner, ordinary journey mode, optional frame assertions | Standard journeys support staging and production with fresh portal-created SAT sample/link/schedule; advanced entry/adaptive timing rehearsals remain staging-only |
| staging.sat.k6 | sat-exam-day, device-transfer, module-entry modes, and M1/M2 handoff | Staging only; mode-specific credentials/deadlines; production cannot be selected |
| staging.scale | Seven executable scale-proof scenarios: entry wave, bootstrap herd, staggered bootstrap, contention, one-shot arrival, pollers, staff WS soak | Staging only; preserve native proof cardinality and required prepared files |
| legacy / helpers | playwright.remote.config.ts; UI/debug/watch commands; CSV/JSON/example data; imported k6 helper files | Explicit classification, never arbitrary executable entries |

Completeness uses every root Playwright config, application test script, relevant Go test family, and k6 source entrypoint. Imported k6 helpers and .test.js unit files are not separate load scenarios. The standalone-only transition-reconciliation script must be compared and classified before the catalog is considered complete.

Local regression is the canonical coverage for the legacy destructive remote config; that legacy launcher is excluded from Run all with an explicit reason and coverage mapping. Storybook dev/watch, deployment, backup/recovery scripts, and visual authoring utilities are operational tools, not automatically runnable application test suites. Build-storybook may be exposed as an optional isolated build check; it is not a production test.

Run all means all canonical application suites above, including staging requirements. It can legitimately remain blocked until staging/prepared-fixture prerequisites exist. The UI must not redefine it to mean “whatever happens to be ready.”

Native 2,000/5,000-candidate staging proofs are not silently scaled to 400 and still called proofs. Keep their native target requirements and require a separately configured staging capacity limit sufficient for that proof. Default staging admission is also limited to 400 until an operator explicitly configures and validates a larger budget. A reduced rehearsal, if selected as a separate catalog profile, must say that it does not satisfy the native capacity gate.

### 5.5 Production fixtures and harness corrections

1. Extend the existing IELTS bootstrap helper with explicit supported scenario templates, preserving the current default for legacy CLI callers.
2. Separate ordinary authentic IELTS journeys from section-override rehearsals. The latter must create a supported simulated fixture and label that coverage; do not weaken authentic/adaptive backend policy.
3. Provision stable staff accounts outside the portal. During preparation, log in with each configured proctor to resolve its real user ID, call the new scoped grant endpoint, and verify access to the newly created schedule.
4. Relax the shared production target's exact 200-student constraint to a nonempty roster with unique wcodes/emails. Preserve the existing ten-proctor shape for the original multi-proctor suite. Keep production caps in the portal catalog, not as a global limit on all CLI/staging fixtures.
5. Reuse applyProdRosterOverrides and its threshold clamping for small smoke variants; validate that the fixture's expected check-in count fits the actual candidate set. Do not retain a 95-check-in prerequisite for a 10-student run.
6. Change buildStudentSlice to reject noninteger, nonpositive, insufficient, or out-of-range requests rather than reducing them. Preserve valid 100/200-user CLI calls.
7. Generate run-unique JSON browser rosters and k6 targets from one synthetic identity set. For a maximum hybrid, API slice is indices 0–399 and browser slice 400–419.
8. Full production Playwright control-plane coverage creates multiple simultaneous staff contexts. Its concurrency adapter must reserve student capacity so total real browser contexts, including staff/editor contexts, stay within 20. The live hybrid sample uses its own explicit budget.
9. The current single-worker production Playwright ordering can run control-plane before candidates. Add a portal-specific coordinating adapter/config: hold a fixture-ready barrier, start control and student shards concurrently with disjoint student slices, budget actual contexts, and collect both reports. Do not “fix” this by dropping control-plane assertions or substituting admin roles.
10. Set E2E_PROD_PROVISION_STAFF_DB=false and E2E_ALLOW_PROD_DB_MUTATIONS=false for every remote suite. Supply generated secret/target/runtime file paths explicitly; never fall back to checked-in target URLs.
11. Normalize IELTS/SAT browser summary failures into failed results even when the process exit is zero. When changing CLI exit behavior to reflect failures, add contract tests and document the corrected behavior.
12. Make the shared dashboard bind to loopback when launched by the portal, and adapt both canonical runners to publish run-scoped monitor events using a per-execution secret. Retain optional standalone behavior.
13. Bypass coedit-live's shell DB bootstrap after the controller has provisioned its schema through mysql2; use an explicit trusted pre-provisioned-database option, not a password on a shell command line.
14. Add an ordinary SAT API fixture adapter using the inspected provider creation contract, explicit draft opening, buildCompleteSatSample payload generation, load-sample API, normal publish revision/operation fencing, and typed access-link creation. Record exam/version/link/backing schedule IDs before admitting synthetic candidates. Use the normal supported SAT start mode with one declared portal/API controller; close any preparation browser before the candidate workload to preserve the context budget. Do not reuse the local helper's SQL timing mutation or shorten production module clocks. Exercise this path in staging before enabling ordinary SAT production journeys.

### 5.6 Durable store and bounded evidence

Proposed volume layout:

~~~text
/data/test-portal/
  controller.lock
  runs/<runId>/run.json
  runs/<runId>/logs/<executionId>.jsonl
  runs/<runId>/artifacts/<artifactId>/<generated-filename>
~~~

Use atomic per-run JSON manifests with schemaVersion and monotonic revision. Run creation, admission sequence assignment, cancellation, and terminal commits share one serialized controller mutation lane. There is no independently authoritative queue file or idempotency index to update atomically with a run.

Startup scans valid manifests, rebuilds indexes, ignores incomplete temp files, and quarantines invalid records without inventing success. A corrupt state affecting active-work ownership holds dispatch. A record using a newer unknown schema is read-only and blocks mutation; rollback must never overwrite it.

Defaults are proposed implementation policy: at most 20 queued records, 14-day terminal-record/artifact retention, 100 MiB ordinary logs per execution, 1 GiB artifacts per run, and at least 256 MiB reserved free space. Refuse new work if projected quota/reserve cannot be met. If evidence storage fails during execution, stop the workload and enter degraded mode; do not discard evidence quietly and report pass.

Only completed, expired data is pruned automatically. Reserve space for terminal-state persistence before admitting a run. Artifact expiration is recorded before deletion and recovered idempotently if deletion is interrupted. Known expired downloads return 410 while their retained tombstone exists.

Latest preview images are transient, not continuously archived. At an assumed 20 KiB JPEG, 20 browsers, and 5-second interval, one viewer receives approximately 80 KiB/s; persisting every frame would consume approximately 281 MiB/hour. This estimate justifies latest-frame caching and failure-only screenshot retention; actual JPEG size must be measured.

Use per-client bounded SSE queues; coalesce preview frames, disconnect lagging clients, and retain at most 5,000 ordinary log lines in memory. State snapshots are authoritative for reconnection; log event replay may report a gap without changing the test result. SSE reconnect never creates or resumes a workload.

### 5.7 Security, processes, and report interpretation

- Use a server-configured operator username and scrypt password hash, random opaque sessions, an HttpOnly/Secure/SameSite=Strict cookie in hosted mode, 8-hour expiry, and session-bound CSRF checks.
- Limit failed logins to five attempts per 15 minutes per trusted client identity, with a bounded registry. Configure the known Railway proxy hop; do not trust arbitrary forwarded-IP headers.
- External target origins must be explicitly configured HTTPS origins without embedded credentials. Local HTTP is allowed only for generated loopback stacks. Reject redirects of authenticated fixture/control requests outside the approved origin.
- Construct child environments from allowlists. Set local PORT/API_PORT explicitly; never inherit the portal's public PORT into a local API. Explicitly set every DSN alias a local config reads.
- Test DB users get grants only on their disposable schema/namespace, not the MySQL root credential. A controller-only test provisioner credential may create/drop that namespace and is never passed to test processes.
- Known secrets are redacted across chunk boundaries before logging. Disable raw HTTP/body debug modes for hosted production runs. Ephemeral files use mode 0600, are outside artifact collection, and are deleted in finally/recovery paths.
- Structured controller audit records include operator, run ID, target ID, selected suites/counts, confirmation, cancellation, and outcome; never passwords, session cookies, tokens, or DSNs.
- Serve HTML reports as downloads by default. The portal's normalized results are the inline view. Do not serve generated HTML or trace assets with executable same-origin privileges; raw traces may contain credentials and remain restricted operator downloads.
- Use a minimal init/reaper and a Linux process supervisor. Signal tracked process groups, track descendants/process start identity, and verify Chromium/worker cleanup. PID reuse and spawn error/exit races require tests.
- If descendants escape cleanup or ownership is uncertain, stop dispatch and require dedicated-service restart; do not pretend a parent exit proves all load stopped. [Node child-process behavior](https://nodejs.org/api/child_process.html#subprocesskillsignal)
- Remove arbitrary server runtime module hooks from portal inputs. The checked-in live runner's optional custom scenario capability is not exposed through the web API.

k6 results must export complete structured summary data through a shared handleSummary integration while preserving any existing answer-diff output, particularly prod-submit-storm's current custom handler. Never replace that handler and lose its correctness evidence. Dashboard HTML export is optional evidence, not the pass/fail authority. [k6 custom-summary contract](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/)

Pass/fail policy:

| Condition | Required outcome |
| --- | --- |
| Nonzero process exit | Failed; preserve native code and category |
| Null exit code or unexpected signal | Failed infrastructure or interrupted; never convert to zero |
| Zero exit plus failed/aborted browser summary | Failed assertion/precondition, based on summary |
| Missing/malformed/stale/wrong-execution report | Failed infrastructure |
| k6 threshold/check failure or missing required correctness metric | Failed assertion |
| Fewer candidate identities/VUs than requested, insufficient arrivals, or dropped required iterations | Failed capacity; report configured/achieved counts |
| Both hybrid components pass with complete evidence | Hybrid can pass |
| One hybrid component fails, is killed, or has no report | Hybrid fails; stop sibling safely |
| A mandatory MySQL contract skips or is undiscovered | Failed precondition/evidence; not pass |
| Native intentional skips outside mandatory contracts | Explicitly reported with their native reason; never concealed |
| Reduced staging rehearsal of a larger native gate | May pass only its explicitly named reduced profile; cannot satisfy the larger proof |

Do not infer simultaneous live candidate activity from total userCount or aggregate HTTP RPS. Record the effective candidate scenario options and instrument distinct active candidate operations/phases where the adapter needs to claim achieved concurrency. Native sequential per-VU scenarios may establish a 400-candidate wave rather than a sustained 400-user plateau; the UI must name that distinction. Add a separately named sustained profile only if its lifecycle is actually implemented and tested.

## 6. Production and failure-mode deep dives

| Risk | Consequence | Safeguard / enforcement location | Verification | Residual risk |
| --- | --- | --- | --- | --- |
| Duplicate click / lost 202 | Two production waves | Serialized idempotent admission in run store | Concurrent identical and conflicting requests | Deduplication ends with documented record retention |
| Crash between commit and response | Operator retries accepted work | Durable record before acknowledgment | Kill after rename/sync and before HTTP send | Volume loss is outside process-crash recovery |
| Crash between launch intent and PID save | Untracked work | Execution token, startup reconciliation, interrupted outcome, queue hold | Kill at both boundaries | No automatic external side-effect replay |
| Two controllers / deployment overlap | Duplicate dispatch and file corruption | Railway single attached volume plus exclusive OS lock | Second process cannot acquire lock; redeploy rehearsal | Separate independent services with separate volumes are not coordinated |
| Cancellation versus dispatch | Work starts after Stop | One mutation lane; launch-time cancel check | Barrier-controlled cancel/spawn race | An already in-flight HTTP mutation may commit |
| Parent dies but browser survives | Hidden production traffic | Group and descendant cleanup; dispatch fence until clean | Real browser/setsid child cleanup tests | Unprovable cleanup requires service restart |
| Script clamps 400 to 200 | False production capacity result | Strict roster validation plus effective/achieved count evidence | Short roster and forced partial-start cases | Generator resources still need live measurement |
| Hybrid controls collide | Premature start/complete or invalid results | Catalog control-owner declaration; compatible pair validation | Duplicate-controller negative test | Existing script protocol defects surface as failures |
| Original full browser control runs without candidates | Long wait / false environment diagnosis | Coordinated control/student launch and barrier | Real local miniature schedule | Browser timings differ from API load timings |
| Fresh schedule lacks proctors | Access denied or direct-DB shortcut | Scoped grant endpoint and access probe | Real MySQL endpoint/concurrency/scope tests | Ten-proctor account availability is an operator prerequisite |
| Production target defaults leak into local tests | Real data changes | Explicit target profiles, no .env files, allowlisted child env, legacy remote exclusion | Poison inherited env/defaults | Approved production credentials still authorize real API effects |
| Remote create commits but ACK is lost | Orphan or duplicate fixture | Intent ledger; no blind retry; read-only reconciliation | Drop ACK after successful create | Some orphans require manual application inspection |
| Reporter says success despite failures | False green | Native report validation and mandatory metric checks | Fabricated zero-exit failed summary | Native tests can still omit an assertion; portal does not prove product correctness |
| Logs/frames saturate memory/disk | Controller unresponsive or lost final state | Quotas, reserve, latest-frame cache, SSE backpressure | Flood output and stall viewer/storage | Underprovisioned service can still be OOM-killed |
| Artifact path/report injection | Secret read or operator-session attack | Artifact IDs, realpath/symlink checks, attachment-only HTML | Traversal, symlink, malicious HTML tests | Downloaded raw traces require operator care |
| New/old manifest versions | Corrupt rollback/replay | Schema versioning, read-only unknown records, explicit migration | Old reader/new manifest test | Incompatible downgrade needs backup restore or forward fix |
| Target deploy changes during a long run | Mixed-version evidence | Record target version when exposed and recheck at suite boundaries | Simulated target revision change | Without a trustworthy version endpoint, report target revision unknown |
| Staging proof lacks native cardinality | Misrepresented release gate | Native proof metadata and staging budget preflight | Reduced count cannot satisfy native gate | Hardware capacity is unverified until measured |
| Assignment retries or wrong organization | Duplicate or unauthorized grant | Schedule-row lock, role/state validation, owner/org scope | Simultaneous grants and cross-org users | Manual SQL writers are outside the HTTP locking contract |

No formal proof is required for v1. A deterministic state-machine transition test plus fault-injection tests directly exercises the controller implementation. Such tests do not prove Railway storage durability or production application capacity.

## 7. Ordered implementation phases

Each phase is required for the complete P0 release unless explicitly identified as an optional build check. Do not call an early vertical slice the finished “all tests” portal.

| Phase | Files / components | Specific change | Coverage / dependencies | Done when |
| --- | --- | --- | --- | --- |
| 1. Freeze catalog ownership | Existing package.json, Playwright configs, root/standalone k6/e2e; proposed portal/contracts.ts and catalog.ts | Compare duplicates; register canonical suites, helpers, aliases, environment/capacity policy, control owner, outputs, and per-suite deadlines | FR-1; E-07/E-18/E-21; no runtime prerequisite | Catalog contract accounts for every discovered entrypoint and flags new unmapped entries |
| 2. Durable controller foundation | Proposed run-store.ts, orchestrator.ts, start-portal.sh | Atomic manifest commits, idempotent admission, admission ordering, OS lock, cancellation states, schema-version recovery, queue hold | FR-2/6, INV-1/2/3/9/10/11; phase 1 | Fault-injected requests/restarts cannot acknowledge lost decisions or replay work |
| 3. Authenticated API boundary | Existing ui-server.mjs; proposed server.ts, auth.ts, targets.ts | Dedicated login/session/CSRF, configured profiles, strict request schemas, preflight digests, rate limits, legacy mutation-route retirement | FR-1/2/7, INV-4/5/12/13; phases 1–2 | All control/read/evidence APIs enforce session scope; unauthenticated legacy routes cannot launch work |
| 4. Necessary Go capability | Existing main.go, handlers_admin.go, internal/schedules/service.go, internal/authz/table_staff.go; proposed proctor-grant handler/service test files | Add the scoped additive proctor grant route and transaction; preserve existing authz/CSRF/error conventions | FR-3, INV-15; phase 1; needed before full fresh multi-proctor production runs | Active same-scope proctor gets one grant under concurrent replay; forbidden roles/scope fail; actual proctor can read only assigned schedule |
| 5. Process and evidence substrate | Proposed process-supervisor.ts, evidence.ts, adapter result modules | Fixed argv/environment allowlists, error/close handling, process identities, cancellation/deadlines, redaction, authenticated SSE, artifact IDs/quotas | FR-5/6/7, INV-5/8/9/10/12/13; phases 2–3 | Real child-tree/browser cleanup, slow streams, storage faults, and malformed outputs produce the specified outcomes |
| 6. Isolated suite adapters | Existing local Playwright/Vitest/Go configs; coedit-live config; proposed adapters | Disposable MySQL namespace, migrations, local runtime env/ports, safe coedit bootstrap bypass, complete code/unit/race/browser execution and reports | FR-1/2/5, INV-5/14; phases 1/5 | Each canonical local family runs against test infrastructure and produces a normalized result; DB contracts cannot silently skip |
| 7. Production fixture and browser adapters | Existing prodBootstrap.ts, prodData.ts, prodOrchestration.ts, control-plane suite, canonical live runners/dashboard, inspected SAT sample/authoring/access-link contracts; proposed adapters and coordinating config | Fresh IELTS and ordinary SAT API fixtures, strict roster sizing, proctor grants, owned-resource ledger, controller/student barrier, truthful live summaries | FR-3/4/5, INV-4/6/7/8/11; phases 4–6 | Miniature real-API runs create only owned fixtures, use actual proctor roles, start candidates and control coherently, and fail on any candidate/report defect; standard SAT works without importing SQL timing helpers |
| 8. k6 / hybrid / staging adapters | Existing canonical k6 scripts/helpers; proposed shared summary utility and adapters | Reject count clamping; export complete summaries without dropping answer-diff outputs; supervise compatible pairs; preserve staging gates and native capacity requirements | FR-1/3/4/5, INV-6/7/8; phases 5/7 | k6-only and hybrid report both native outcomes; a short roster, failed sibling, or undersized native proof cannot appear green |
| 9. Separate web application | Proposed load-runner/web and Vite/TS/test configs; existing shared UI primitives | Catalog/readiness, parameter form, effect confirmation, live monitor, queue/history, result/evidence views, accessible cancel/reconnect/release flows | FR-1–7; phases 3/5 and stable API contracts | Browser flow covers preflight block, run, reconnect, inspect, download, cancel, and held-queue release without exposing secrets |
| 10. Railway packaging and delivery | Existing runner Dockerfile/railway.json/package metadata/README; proposed Dockerfile.dockerignore and deployment runbook | Root-context reproducible image with toolchains/browsers/k6/init/lock; explicit single replica, mounted volume, private test DB, healthchecks and configuration | NFR-1–5; phases 1–9 | Image contains canonical sources, excludes credentials, starts securely, survives restart, and passes isolated deployment smoke before production enablement |

Implementation details to lock in phase 1:

- Normal code/unit/build suites: proposed 60-minute outer deadline; Go/MySQL/race group: 120 minutes; live browser scenarios: 180 minutes; full local browser matrix: 24 hours. k6 outer deadline derives from declared setup/scenario/teardown maxima plus five minutes. Catalog entries may choose a larger explicit value only when their checked-in configuration requires it; values are shown before launch.
- Continue to use native framework timeouts inside these controller bounds. A deadline failure remains a failure, not a skipped/pass result.
- Sequential runs and sequential local suites avoid fixture/port contention. Hybrid and the control/student coordinator are the explicit bounded concurrent exceptions.
- Hosted production workload retries are off. Local assertion retries may retain their checked-in policy and are reported as flaky/retried rather than hidden.

## 8. Test matrix

All tests below are **planned**. This documentation task has not run the application suites, launched browsers against production, applied migrations, or executed k6 load.

| Case | Setup / stimulus | Expected persisted and external outcome | Level | Coverage |
| --- | --- | --- | --- | --- |
| TC-01 | Discover every root test script/config/k6 entrypoint and the standalone-only scenario | Every entry has canonical ownership or explicit classification; a newly added unmapped entry fails the contract test | Unit/contract | FR-1 |
| TC-02 | Select Run all with missing staging profile, prepared tokens, and proctor credentials | One blocker response lists all missing requirements; zero fixture mutations, child starts, or accepted run | Integration/API | FR-2, INV-3/4 |
| TC-03 | Submit two simultaneous identical creation requests | One committed run, one admission sequence, same returned run ID | Integration/barrier | FR-2, INV-1/2/3 |
| TC-04 | Reuse a key with different candidates/target/suite list | 409 and no second record/workload | Integration | INV-2 |
| TC-05 | Kill after manifest sync/rename but before 202 reaches the client | Retry returns original committed run; no duplicate fixture wave | Fault injection | FR-2/6, INV-2/3/11 |
| TC-06 | Fail sync/rename or exhaust reserved storage before admission | 503; no acknowledged run and no spawned child | Fault injection | NFR-2/4, INV-3 |
| TC-07 | Start a second controller against the same mounted directory | Second process fails lock acquisition before recovery/dispatch | Linux integration | INV-1 |
| TC-08 | Restart with queued, launching, running, finalizing, and stopping records | In-flight records become interrupted; queued records are held; sessions expire; no remote replay | Integration/crash | FR-6, INV-10/11 |
| TC-09 | Load malformed or newer-schema manifests | Preserve/quarantine data; mutation/dispatch held where ownership is uncertain; no invented success | Integration | NFR-2/4 |
| TC-10 | Access catalog/run/log/SSE/dashboard/artifact without session | 401 or login page; no run metadata, frames, secrets, or control side effects | API/e2e | FR-7, INV-12 |
| TC-11 | Valid session with wrong CSRF, cross-origin JSON POST, or poisoned forwarded identity | Mutations rejected; rate limiting uses trusted identity only | Security/API | NFR-1 |
| TC-12 | Five failed logins, then further attempts; advance fake clock | Bounded lockout returns 429/Retry-After; allowed after configured window | Unit/API | NFR-1/5 |
| TC-13 | Inject arbitrary script path, custom module, URL, env key, or schedule ID | 400/403; no executable resolution or network request to supplied location | Contract/security | INV-4/5 |
| TC-14 | Poison parent environment with production DSNs, PORT, credentials, and mutation flags | Local env contains only disposable DSNs/ports; remote env has no DB credential and DB mutation flags false | Unit/integration | INV-5/14 |
| TC-15 | Select staging-only SAT/scale script with production target | 403 before setup; no remote mutation | API/contract | FR-1/3, INV-4 |
| TC-16 | Request 400 with 200 identities, duplicate identities, or invalid fractional/negative count | Preflight/helper rejects rather than clamping; zero candidate execution | Unit/integration | FR-4, INV-6 |
| TC-17 | Prepare 400 API plus 20 browser identities | Exactly 420 distinct candidates; correct non-overlapping slices; staff/control not counted as candidates | Unit/integration | FR-3/4, INV-6 |
| TC-18 | Run 10-candidate fixture with original check-in threshold 95 | Effective expected threshold is valid for the prepared cohort; start does not wait for nonexistent students | Integration | FR-3/4 |
| TC-19 | Two concurrent PUT proctor-grant requests for the same user/schedule | One active grant from the new HTTP path; replay returns same ID | Real MySQL/barrier | FR-3, INV-15 |
| TC-20 | Grant with builder/proctor actor, foreign-owned schedule, wrong organization, disabled user, or wrong user role | 403/404/422 per application conventions; no grant row | Real MySQL/API | NFR-1, INV-15 |
| TC-21 | Existing duplicate active grants encountered by new endpoint | 409 integrity blocker; no silent role/account change or new duplicate | Real MySQL | INV-15 |
| TC-22 | Fresh fixture setup with real dedicated proctor credentials | Grants applied by API; actual proctor sees the new schedule; unassigned proctor remains denied | API/e2e/MySQL | FR-3, INV-4/15 |
| TC-23 | Attempt production DB provisioning through flags/default target paths | Portal denies/omits authority; control-plane consumes supplied credentials and never launches provision_staff | Integration/spawn spy | FR-3, INV-5/14 |
| TC-24 | Drop response after remote exam/schedule creation commits | Intent becomes unknown; no automatic second create; reconciliation references exact correlation | Fault injection/API stub | INV-11 |
| TC-25 | Attempt to substitute a real candidate schedule into generated target/runtime data | Ownership validation rejects before runtime control | Integration/security | FR-3, INV-4 |
| TC-26 | Run authentic IELTS fixture with section-override scenario, or select two runtime controllers | Preflight blocks incompatible capability/pair; backend policy stays unchanged | Unit/API | INV-7 |
| TC-27 | Launch full production control-plane/student miniature together | Barrier opens only when fixtures exist; expected students join concurrently with control; total browser budget stays within 20 | Local real-stack e2e | FR-4/5, INV-6/7 |
| TC-28 | Browser exits zero with failed=1 or aborted/skipped required candidates | Failed normalized result; run cannot pass | Unit/adapter | FR-5, INV-8 |
| TC-29 | k6 fails but browser passes; reverse; one report absent | Hybrid failed; both statuses preserved; sibling stopped when needed | Process integration | FR-5/6, INV-7/8 |
| TC-30 | Child spawn emits error, or child exits by signal/null code | Failed infrastructure/interrupted; never zero/pass; one terminal commit | Process integration | INV-8/10 |
| TC-31 | Deliver late close/log/result events from an old execution after cancel/rerun | No mutation of the new run or terminal outcome | Unit/barrier | INV-10 |
| TC-32 | Race cancellation against next fixture mutation and spawn | Ordered winner determines behavior; committed cancellation prevents later launches | Deterministic integration | FR-6, INV-9 |
| TC-33 | Cancel a nested real Chromium workload and a helper creating a new process group | Workload and descendants stop within bounded stop policy or dispatch is fenced as cleanup-incomplete | Linux/browser integration | FR-6, INV-9/11 |
| TC-34 | Kill controller while child is producing load against a local stub | Recovery does not replay; leftover workload is cleaned or service is blocked; stub receives no hidden continuing wave after verified cleanup | Crash integration | FR-6, INV-11 |
| TC-35 | Zero/malformed/wrong-execution k6 or browser report; required threshold metric absent | Failed infrastructure/assertion; no inferred pass from console text | Unit/adapter | FR-5, INV-8 |
| TC-36 | Request 400 but force partial VU initialization, dropped required arrivals, or fewer active candidates | Capacity failure with requested/configured/achieved distinction; no false 400-user evidence | Controlled load/local | FR-4/5, INV-6/8 |
| TC-37 | Run submit-storm summary integration | Native correctness thresholds and answer-diff artifact preserved alongside complete portal summary | Contract/local k6 | FR-5, INV-8 |
| TC-38 | Mandatory MySQL contract skips or is not discovered | Backend group fails evidence/precondition; genuine mandatory execution required | Go/adapter integration | FR-1/5, INV-8/14 |
| TC-39 | Test process attempts to access another schema or receives production-like DSN aliases | MySQL grants deny cross-schema modification; preflight/env validation rejects wrong authority | Real MySQL/security | INV-5/14 |
| TC-40 | Secrets split across stdout chunks; dynamic token fields; debug body attempt | Redacted log/SSE output; scratch secret file absent from artifacts and removed on finally/recovery | Unit/integration | INV-13 |
| TC-41 | Flood logs/frames, stall an SSE viewer, hit artifact quota or disk reserve | Memory bounded; frames coalesced; viewer disconnected if necessary; evidence failure stops run instead of green result | Stress/fault | NFR-3/4/5 |
| TC-42 | Artifact traversal, symlink escape, foreign run ID, and script-bearing HTML | Access denied or attachment-only safe response; no portal-origin script execution | Security/e2e | FR-7, INV-12 |
| TC-43 | Advance fake clock beyond 14 days and crash during pruning | Only eligible terminal data expires; active data remains; partial deletion recovers idempotently | Unit/integration | FR-7, NFR-2/5 |
| TC-44 | Disconnect/reconnect UI during running/stopping/terminal states | Snapshot restores accurate status without creating or replaying work; log gaps explicit | Browser e2e | FR-5/6 |
| TC-45 | Expire portal session while run is active | Stream/read access ends; run continues under accepted record; re-login restores controls | API/e2e | FR-5/6/7 |
| TC-46 | Target/catalog/image revision changes before dispatch or queued-work release | Block stale execution and require a new matching plan; no silent use of changed script/profile | Integration | FR-2, INV-4/11 |
| TC-47 | Native 2,000/5,000 proof selected with only 400 approved staging capacity | Preflight blocks native proof; explicitly reduced profile cannot claim native gate | Contract | FR-1/4/5, INV-6/8 |
| TC-48 | Fresh runner image starts with root-context sources and generated local fixtures | All canonical entrypoints/dependencies present; .env, private credentials, prior reports, and duplicate execution trees excluded | Image integration | FR-1, NFR-1/5 |
| TC-49 | Keyboard-only login, configure, inspect blockers, confirm, cancel, and inspect results | Labeled controls, visible focus, announced status, accessible dialog and non-color-only results | Browser/a11y | NFR-5 |
| TC-50 | Canary 10 -> 100 -> 200 -> 400 API users with browser sample | Measured actual load and generator health recorded; promotion stops on native assertion, capacity, or evidence failure | Operator-triggered production load | FR-3/4/5, NFR-3/4 |
| TC-51 | Create a fresh ordinary SAT sample, publish, create a room/link, join synthetic browsers, and start through normal APIs | Real authored/published/link/backing-schedule IDs recorded; no direct SQL or clock override; browser failures propagate; advanced staging-only modes remain blocked in production | Staging real-API/e2e, then operator-triggered production smoke | FR-1/3/5, INV-4/5/7/8 |

Use barriers, injected filesystem/process adapters, fake clocks, and local HTTP fault servers for race/failure tests. Use real MySQL for assignment transactions/grants and real Linux child/browser processes for cleanup. Do not substitute mocks for these guarantees.

### 8.1 Implementation verification commands

Planned commands use Bun as required by AGENTS.md:

~~~bash
bun install --frozen-lockfile
bun run portal:typecheck
bun run portal:test
bun run typecheck
bun run lint
bun run test:live-runner
bun run coedit:test
bun run portal:build
bun run build
~~~

The portal:* commands are proposed additions and do not exist at this baseline. Add focused production helper tests, the shared k6 summary contract test, and the dedicated portal browser config during their corresponding phases. Run changed Go packages and the new grant route's real-MySQL tests with a generated isolated TEST_MYSQL_DSN, then the affected integration/authorization regression suites.

The full local browser matrix, real image startup, Railway restart drill, and staged live load are release evidence; unit checks alone cannot establish those properties.

## 9. Rollout and recovery

### 9.1 Deployment inputs

The following are **proposed configuration names**, not claims about currently configured secrets:

| Input | Purpose / default |
| --- | --- |
| PORT | Railway public listening port; never inherited into local application test ports |
| PORTAL_PUBLIC_ORIGIN | Exact hosted origin for origin/CSRF/proxy policy |
| PORTAL_OPERATOR_USERNAME / PORTAL_OPERATOR_PASSWORD_HASH | Dedicated operator credentials; hash only in deployment configuration |
| PORTAL_DATA_DIR | /data/test-portal on the attached volume |
| PORTAL_TARGETS_JSON | Non-secret approved profile definitions, explicit environments/origins, credential reference names, profile revisions |
| PORTAL_CREDENTIALS_JSON | Server-only secret bundles for configured test staff profiles; never emitted through APIs |
| PORTAL_TEST_DB_ADMIN_URL | Private dedicated test-MySQL provisioner; never a production DB, never passed to suites |
| PORTAL_PRODUCTION_ENABLED | false until isolated/staging verification and operator setup complete |
| PORTAL_MAX_STAGING_CANDIDATES | 400 by default; higher native proofs require deliberate capacity configuration and validation |
| PORTAL_RETENTION_DAYS | 14 |
| PORTAL_MAX_QUEUED_RUNS | 20 |
| PORTAL_LOG_LIMIT_BYTES / PORTAL_ARTIFACT_LIMIT_BYTES | 100 MiB per execution / 1 GiB per run |
| PORTAL_MIN_FREE_BYTES | 256 MiB reserved free space |

The 400 production candidate and 20 browser caps are validated server-side. Changing these limits is a reviewed configuration/code change, not a request-body override. Private fixture files for advanced staging cases are administrator-supplied trusted inputs referenced by profiles; the API does not accept arbitrary server paths.

The production profile is never auto-populated from the repository's current hardcoded URL. Operator configuration must explicitly designate the live origin and dedicated synthetic-data principal/organization.

### 9.2 Build and schema compatibility

1. Build the dedicated runner image using repository-root context, root frozen Bun lockfile, exact Go toolchain from go.mod, Playwright/browser versions matching bun.lock, and an explicitly pinned k6 release validated against all scenario syntax. Do not retain the current unpinned package installation.
2. Ensure all runtime tools required by application tests exist: Node 20+, Bun 1.3.14+, Go 1.26.3 at this baseline, browsers, a C toolchain for Go race tests, minimal init/reaper, and OS file-lock support. Use mysql2 for safe controller provisioning; avoid shell password arguments.
3. Exclude .env files, private credential JSON, storage-state files, generated test data, .git history, prior reports, and persisted volumes from the image. Include safe example/config defaults only when required by tests, with explicit execution env overrides.
4. Deploy the additive Go proctor-grant route and authz tests before enabling the portal's full fresh multi-proctor scenarios. No table migration is required for the chosen row-lock HTTP contract; existing assignment data is not rewritten.
5. Preserve valid legacy 100/200-user fixtures and CLI behavior except intentional corrections to invalid count clamping and failed-run exit reporting. Document those corrections.
6. Version manifest schemas. Prefer additive optional fields. An older portal image must fail closed on unsupported manifests rather than overwriting them.

### 9.3 Enablement stages and evidence

| Stage | Required evidence | Promotion condition |
| --- | --- | --- |
| A: secure bootstrap | Auth/API tests, mounted-volume lock/recovery, image source/tool checks | No unauthenticated control route; durable acceptance and no duplicate controller |
| B: isolated suites | Real disposable MySQL, all local families, mandatory contracts, full browser families, process cleanup | Catalog complete; failures/skips truthful; no production credentials in local processes |
| C: staging workflows | Fresh fixtures, grant endpoint, hybrid, advanced fixtures, cancellation and restart drill | No uncontrolled descendants, no silent count reduction, no missing reports; native proof blockers enforced |
| D: production smoke | Explicit operator profile, actual test principal/org verification, 1–10 synthetic candidates | No real-user fixtures selected; correct owned-resource ledger and normalized result |
| E: production load | Separate fresh scenarios at 100, 200, then 400 API candidates with up to 20 browsers | Existing assertions pass; actual load achieved; generator is not the limiting resource; target version recorded or explicitly unknown |

These stages are operator-triggered. This plan does not authorize running production load while writing documentation or automatically running a 400-user wave immediately after deployment.

Capture generator CPU, memory, process count, elapsed/deadline, dropped work, achieved candidate activity, artifact usage, and controller/event-loop health. Target-side latency/error thresholds come from the native scenarios. Capture production application/DB telemetry when available; absence of that telemetry limits the capacity conclusion and must be stated.

If 400 candidate VUs cannot be generated faithfully on the selected Railway allocation, report capacity failure and size the dedicated service using measured evidence. Do not compensate by silently serializing candidates, lowering count, weakening thresholds, or claiming 400-browser capability.

### 9.4 Recovery actions

| Incident | Required action |
| --- | --- |
| Assertion failure | Stop remaining suites; preserve reports/fixtures; rerun only as a new run with fresh scenario data after investigation |
| Operator cancellation | Commit cancellation, stop owned processes, retain partial evidence; do not delete or “undo” production answers |
| Cleanup incomplete / unexpected traffic | Fence dispatch, inspect process evidence, restart the dedicated runner service, revalidate before queue release |
| Portal crash/redeploy | Recover manifests; mark active work interrupted; purge stale scratch secrets; hold queued work until explicit revalidation/release |
| Ambiguous remote create/control | Inspect exact operation correlation and application state through authorized reads; attach reconciliation note; never blindly replay |
| Volume full/unavailable | Stop admission and work if evidence cannot be persisted; preserve reserve/metadata; prune eligible expired data or expand volume, then revalidate |
| Volume lost | Stop and rebuild with production disabled; reconcile known remote fixtures from operator/application records; do not claim run history or deduplication survived |
| Credential leak | Disable production admission, revoke/rotate exposed application/portal credentials and sessions, restrict artifacts, inspect audit records |
| Broken new portal release | Drain/cancel work, preserve a volume snapshot/backup, deploy a compatible prior image; unknown newer manifest schemas remain read-only |
| Broken Go grant endpoint | Disable dependent portal suites; roll back the additive route if necessary; existing granted rows remain authorized state to review, not automatically erased |

Application rollback does not reverse production fixture creation, grants, schedule starts, saved answers, or submissions. Deleting production test data is a separate explicitly reviewed operation outside this v1.

## 10. Open decisions and final gap review

### 10.1 Release prerequisites, not hidden design assumptions

| Item | Status / default | Required validation |
| --- | --- | --- |
| Actual production/staging origins and dedicated organization | Unknown / operator supplied | Explicitly configured profile and authenticated organization/resource probes |
| Production staff accounts, including ten real proctors where selected | Unknown / pre-provisioned | Resolve active IDs/roles/org; ensure unique credentials and API grant capability |
| Advanced SAT prepared attempts, keys, waves, timing, and worker settings | Unknown / required per suite | Validate mode-specific identity/cardinality/deadline requirements; stale fixture blocks |
| Railway CPU, memory, storage, and plan limits | Unknown / measure | Image boot, process/restart drill, gradual generator capacity tests |
| Exact pinned k6 version | To select from an available supported release during image implementation | k6 inspect plus scenario syntax/result-contract tests; record version in every run |
| Existing standalone-only scenario equivalence | Verified inventory gap; semantic behavior not yet compared | Read/compare root and copied implementations in phase 1; add unique coverage or record a justified alias |
| Target deployed commit identity | Unknown unless target exposes a trustworthy source | Capture when available; otherwise mark unknown, never substitute runner SHA |
| Complete production bootstrap template validity | Source helper exists; deployed publish/readiness not proven | Exercise publish/create/register/grant against isolated/staging app before production |
| Descendant cleanup under Railway's Linux container | Design specified, runtime not proven | Real Chromium/process-group tests and service restart drill are a release gate |

No product preference remains unresolved. These are factual deployment/verification inputs; missing inputs block the affected suite or release stage rather than causing unsafe defaults.

### 10.2 Requirement-to-delivery traceability

| Requirement | Implementation phases | Required acceptance evidence |
| --- | --- | --- |
| FR-1 complete truthful catalog | 1, 6, 8, 9, 10 | TC-01, TC-15, TC-38, TC-47, TC-48 |
| FR-2 preflight / Run all / idempotent acceptance | 1, 2, 3, 9 | TC-02 through TC-06, TC-13, TC-46 |
| FR-3 fresh owned production fixtures | 4, 7, 8 | TC-17 through TC-26, TC-50/51 |
| FR-4 requested 400-user load plus browser sample | 7, 8, 10 | TC-16/17/18/27/36/47/50 |
| FR-5 live truthful results | 5, 6, 7, 8, 9 | TC-27 through TC-31, TC-35 through TC-38, TC-44/45/50 |
| FR-6 cancel / recovery / reconnect | 2, 5, 9, 10 | TC-07/08/09/29/30/31/32/33/34/44/45/46 |
| FR-7 protected retained evidence | 3, 5, 9, 10 | TC-10/11/12/40/41/42/43 |

Every invariant has direct negative/failure testing in section 8. The severe guarantees use real MySQL or Linux processes where those mechanisms matter. Source inspection and mocked tests alone are not accepted as evidence for production capacity, remote fixture correctness, or complete process termination.

### 10.3 Definition of done

- All seven P0 requirements have implementation and acceptance evidence.
- Catalog coverage is complete; no suite disappears because it is difficult to prepare.
- No legacy unauthenticated web route can launch workloads.
- The Go grant endpoint preserves role/organization/owner boundaries and passes concurrent retry tests.
- A request for 400 cannot silently execute 200, and a 400-candidate wave is not mislabeled as 400 sustained browsers.
- Hybrid and browser-summary failures cannot produce a passing run.
- Crash/restart/cancellation preserve decisions, prevent replay, and leave no unaccounted workload before dispatch resumes.
- Local suites demonstrably cannot use production database or API credentials.
- Required reports, secret handling, evidence quotas, expiration, and unsafe HTML serving are verified.
- Railway isolated/staging drills and the relevant operator-triggered production stages have recorded evidence before claiming live readiness.
- The handoff includes actual commands, captured tool versions, run IDs, target identity, known residual risks, and the recovery runbook.

This document is complete as a planning/specification artifact. Implementation and live readiness remain to be demonstrated by the phases and tests above.
