# RAM reduction implementation plan

Date: 2026-10-07, Asia/Bangkok. Status: proposed; implementation and deployment have not started.

Reduce server RAM used by authoring and staff administration while preserving student exam behavior. No skills, worktrees, or subagents were used to prepare this plan. Repository inspection was read-only apart from this document. Existing uncommitted work must be preserved.

## Decision and limits

Start with accurate measurement, replace the production TypeScript launcher, then make the authoring co-edit process stop completely when unused. Follow with bounded staff imports/exports and authoring preview cache changes. Keep the existing exam runtime and worker correctness rules.

The attached chart reports **MySQL 732 MB + IELTS-LMS 154 MB = approximately 886 MB** at 2026-10-06 20:12 GMT+7. MySQL is approximately **82.6%** of that point. This is one sample, not an idle baseline, memory allocation breakdown, or proof of a leak. The deployed image/version and traffic at that time are unknown.

With MySQL unchanged, eliminating even the entire application service would save only 17.4% of that sample. Actual application savings will be smaller. A 30–50% reduction in total project RAM cannot be promised from authoring changes alone. Measure MySQL, but treat changes to its global settings as a separate, conditional expansion of scope because the same database serves exams.

## Protected behavior

The main implementation may change authoring process management, authoring-only preview caching, staff import parsing, and administrative read/export paths. Preserve their authorization and data contracts.

Do not change student entry, check-in, tokens, writer ownership/device transfer, answer persistence, autosave, timers, personal/cohort timing, adaptive routing, submit/auto-submit, result sealing, or student media delivery. Preserve IELTS, SAT, and ACT behavior. Live proctor controls, presence, and exam-related background jobs are also protected even though staff operate them.

Do not reduce shared API/worker connection limits, disable student caches, change worker cadence, weaken password hashing, change global Go GC settings, or purge student records as part of this scoped plan. Published versions, import undo checkpoints, receipts, audit records, scoring, and data retention guarantees stay intact.

## Findings from the current working tree

These describe repository code, not verified production settings.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| One application container serves a built SPA and Go API, plus Node co-edit; a separate worker child runs only in continuous mode. | [Dockerfile](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/Dockerfile:48) | Frontend component/bundle size is not the primary explanation for this server RAM chart. |
| Activity-driven background work already exists; parking closes idle database connections. | [Background runtime](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/background_runtime.go:20) | Reuse it; do not rebuild or weaken its exam eligibility rules. |
| Node starts unconditionally through the `tsx` CLI; any supervised child exit currently restarts the whole container. | [Startup supervision](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/Dockerfile:137) | Parking Node leaves its runtime resident. Intentional Node exit needs a new process owner, not a simple kill. |
| Co-edit already unloads disconnected documents and has a safety-aware park operation. | [Co-edit lifecycle](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/services/authoring-coedit/src/main.ts:321) | Build on existing clean-store, socket, retry, and singleton-lock checks. |
| Authoring preview and student delivery share the version cache. The cache is limited to 50 versions, with no time expiry. | [Shared wiring](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/app/app.go:145), [cache](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/versioncache.go:12) | Draft previews can retain trees or evict useful published trees when caching is enabled. Inspect actual usage before changing this. |
| Workbook uploads are capped at 12 MiB but can unzip to 80 MiB, and question rows are materialized through `GetRows`. | [Workbook parser](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authoring/workbook.go:169) | Compressed upload size understates parsing memory; concurrent staff operations multiply peaks. |
| RAWDATA exports build attempts, modules, response maps, legacy rows, two sheet projections, and final XLSX bytes. | [Export projection](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/results/sat_rawdata_export.go:111), [XLSX output](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/results/sat_rawdata_xlsx.go:71) | The existing worksheet stream writer helps, but the complete export is still retained. |
| Staff result groups aggregate schedule/attempt history; attempt detail pages already have pagination. | [Results queries](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/results/service.go:619), [staff client](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/results/api/satResultsQueries.ts:139) | Optimize the measured heavy query; do not redo existing attempt pagination. |
| The old RAM sampler expects `backend_process_*` metrics that the current Go registry does not emit, and it sends no metrics bearer token. | [Sampler](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/scripts/idle-ram-window.js:6), [metrics gate](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/main.go:1051), [registry handler](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/platform/telemetry/registry.go:283) | HTTP 200 plus null memory values must not count as successful measurement. |

## Execution sequence

### S0 — Establish the actual baseline

**Dependencies:** none. **Deliverable:** baseline report and working capture script.

1. Record deployed commit/image, replica count, process tree, background mode, co-edit flags, database version, and service memory accounting. Record only an allowlist of non-secret settings; never dump deployment environments or DSNs.
2. Capture 30 minutes with no students/authors, one representative exam session, one authoring session, and the same exam workload alongside staff imports/exports. Capture after workload completion and after 60 seconds, 5 minutes, and 30 minutes. Compare warm systems using the same fixtures, limits, and traffic.
3. Use platform/container memory for the service total and Linux `/proc` for the API and complete co-edit process subtree. Capture RSS, proportional memory where available, anonymous/file-backed memory, process counts, Go live heap, released heap, and goroutines. Do not add process RSS or MySQL instrument bytes to container totals: they are diagnostic breakdowns with different accounting.
4. Reuse the current sampler, adding private metrics authentication, explicit missing-metric errors, and supported Go measurements only where container/process data is insufficient. Use standard-library Go runtime metrics rather than a new monitoring dependency. Missing data stays unknown. Keep `/metrics` private and collect memory without waking authoring or application background work.
5. Sample MySQL allocations, connections, buffer-pool activity, statement digest summaries, and temporary-table activity. Use aggregate data without candidate names, answer text, tokens, or SQL parameter values.

Read-only database discovery, using a separately supplied metrics connection:

```sql
SELECT VERSION();

SHOW GLOBAL VARIABLES
WHERE Variable_name IN (
  'innodb_buffer_pool_size', 'innodb_buffer_pool_instances',
  'max_connections', 'thread_cache_size', 'table_open_cache',
  'tmp_table_size', 'max_heap_table_size', 'temptable_max_ram',
  'sort_buffer_size', 'join_buffer_size', 'performance_schema'
);

SHOW GLOBAL STATUS
WHERE Variable_name IN (
  'Threads_connected', 'Threads_running', 'Max_used_connections',
  'Created_tmp_tables', 'Created_tmp_disk_tables',
  'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads',
  'Innodb_buffer_pool_pages_data', 'Innodb_buffer_pool_pages_free'
);

SELECT EVENT_NAME,
       CURRENT_NUMBER_OF_BYTES_USED,
       HIGH_NUMBER_OF_BYTES_USED
FROM performance_schema.memory_summary_global_by_event_name
ORDER BY CURRENT_NUMBER_OF_BYTES_USED DESC
LIMIT 20;
```

Collect counter deltas across each workload rather than comparing cumulative counters between unrelated uptimes. Permissions or disabled instrumentation can make the memory table incomplete; do not interpret zeros as zero RSS. MySQL documents this allocation view in [Monitoring MySQL Memory Usage](https://dev.mysql.com/doc/refman/8.4/en/monitor-mysql-memory-use.html).

**Gate:** identify how much idle RAM belongs to co-edit, how much peak RAM belongs to staff operations, and whether MySQL RAM is buffers, instrumentation, query work, or unaccounted resident memory. Lock savings targets from these measurements. No fixed MB forecast before this gate.

### S1 — Build co-edit JavaScript ahead of deployment

**Dependencies:** S0. **Deliverable:** the same co-edit behavior running directly under Node.

At image build time, compile the co-edit entrypoint and repository-local imports into an ESM artifact using the existing Bun toolchain. Initial candidate:

```bash
bun build services/authoring-coedit/src/main.ts \
  --target=node --format=esm --packages=external \
  --outfile=services/authoring-coedit/dist/main.js
```

Run that artifact with Node 22, removing the production `tsx` launcher. Validate this command against the pinned Bun 1.3.14 builder. Bun documents the Node target and external-package option in its [bundler reference](https://bun.sh/docs/bundler).

Keep dependencies resolving from the existing single root dependency graph. Preserve one ProseMirror/Yjs instance; do not introduce another install tree or lockfile. Initially keep the existing dependency copy to isolate the RAM experiment. Pruning packages is an optional image-size task, with no assumed RAM saving from files that are never loaded.

Update the manifest generator and architecture/image tests to verify the compiled artifact and its required runtime imports. Preserve their protection against missing shipped modules. Verify direct-entry startup and signal handling in the final Docker image, not just in the checkout.

**Files:** `backend/Dockerfile`, root/service package scripts, `backend/scripts/coeditRuntimeManifest.ts`, `backend/coedit-runtime-manifest.json`, architecture/image tests.

**Gate:** editor, document codec, persistence, lifecycle and singleton-lock tests pass against the production artifact; process tree and memory are captured before/after. Report the observed launcher saving, including zero if negligible.

### S2 — Fully stop unused authoring co-edit

**Dependencies:** S1. **Deliverable:** no co-edit process while authoring is unused, including during an active student exam.

Add one Go-owned co-edit child manager at the API composition boundary. It owns spawning, startup readiness, authoring reservations, parking, exit collection, and shutdown. Keep control signing and document persistence in their existing owners. Do not rewrite Hocuspocus in Go or add another always-running supervisor.

Add `AUTHORING_COEDIT_PROCESS_MODE=always_on|on_demand`, defaulting to existing always-on behavior for rollback. In on-demand mode:

1. Start with the child absent. Existing student requests, exam worker activation, `/healthz`, `/readyz`, metrics, and routine freeze-recovery scans must not spawn it.
2. Start it after an existing authoring role/tenant check passes for token issuance or an authorized lifecycle operation that actually needs Node. Coalesce concurrent starts into one child. Use the process lifetime context, not one request's cancellable context.
3. Wait for the local listener, activate using the existing signed control call, and wait for singleton ownership/readiness. Bound startup by the existing control timeout; return a retryable authoring error on failure.
4. The public WebSocket proxy must not become an unauthenticated cold-start trigger. A stopped service returns its existing retryable unavailable response; the authoring client renews through its authenticated token endpoint. Confirm reconnect behavior; add an authoring-only token renewal/retry if necessary. Keep Node's existing frame authentication and admission limits.
5. Hold reservations through authoring lifecycle operations and complete proxied socket lifetimes. Reuse the 60-second grace initially. When only authoring becomes idle, call the existing signed `Park` operation. Do not wait for students or exam background work to become idle.
6. Exit Node only after parking succeeds: no sockets, dirty documents, pending stores, loading/unloading, seed operations, retries, or freeze/flush operations. A failed park, failed store, or unknown state keeps the child resident. If activity arrives while stopping, serialize the transition and restart before admitting it.
7. Reap the child and its descendants. A clean intentional exit must not reach the shell's whole-container failure path. Unexpected co-edit failure fails authoring closed, with bounded restart backoff on authoring demand; it must not restart an otherwise healthy student API.
8. On container termination, reject new authoring admissions and flush/stop Node while Go's private persistence endpoints still serve. Only then finish API shutdown. Keep the existing exam background drain semantics.

The manager must distinguish a known clean stopped child from an unavailable or failed child. Existing global background drain calls may treat the former as already parked; they must retain errors for unknown/dirty state. Wrap this distinction at the co-edit control/runtime boundary. Do not remove the exam eligibility checks in `background/idle.go` or change activity middleware/auth ordering.

**Files:** new `backend/go/cmd/api/coedit_runtime.go` and tests; limited composition/shutdown wiring in `main.go`; co-edit parts of `background_runtime.go`; `internal/authoringcoedit/control.go`; co-edit proxy/token/lifecycle entrypoints; `services/authoring-coedit/src/main.ts`; Docker startup; config/example; authoring client only if reconnect requires it.

**Required scenarios:** concurrent cold starts; invalid socket while stopped; student-only traffic; active exam while authoring parks; last disconnect racing a new author; failed store/park; publish freeze racing idle; child crash and lock loss; readiness timeout; both background modes; SIGTERM during dirty edits; always-on rollback. Reopen the editor and verify durable document content, revisions, epochs, and singleton ownership.

**Gate:** zero Node/tsx descendants after successful authoring idle, no authoring data loss, no student API restart caused by co-edit exit, and the measured authoring runtime allocation is reclaimed. A dirty editor is allowed to stay resident for correctness.

### S3 — Bound concurrent staff imports and exports

**Dependencies:** S0; can follow S2 independently of cache work. **Deliverable:** bounded administrative memory spikes.

Introduce one process-local heavy-staff-operation gate, initially allowing one operation. Apply it after existing authorization/rate checks and before workbook multipart parsing or RAWDATA projection/encoding. Cover workbook preview/import and staff RAWDATA JSON/XLSX export, not student media upload/download or student answer operations.

Use a nonblocking admission check rather than retaining an unbounded queue of request bodies. Busy requests receive the existing 429 envelope with a short retry hint. Release the slot on every error, cancellation and completion. Hold it through output writing so slow clients cannot leave multiple completed workbooks resident. Existing per-user rate limiting remains: request rate and in-flight allocation solve different problems.

Within the workbook parser, replace `GetRows` materialization with Excelize row iteration where equivalent, enforce the existing row/cell/image limits during iteration, and close iterators/temp resources on every outcome. Keep the 12 MiB compressed and 80 MiB expanded limits and the preview/commit/undo contract. Profile the asset/base64 response before attempting any asset API redesign.

For XLSX, feed the existing worksheet stream writers from bounded attempt/module batches inside the existing read-only consistent snapshot, instead of building the unused legacy JSON projection and the complete response map. Keep the JSON format's contract unchanged. Do not silently truncate large exports. Keep snapshot transactions short enough to avoid excessive undo retention; measure that cost too.

**Library ceiling:** installed Excelize v2.11.0 `WriteTo` itself calls `WriteToBuffer`. Merely replacing `WriteToBuffer` with `Write`, `WriteTo`, or `SaveAs` does not remove final ZIP allocation. See the [installed implementation](/Users/rd-cream/go/pkg/mod/github.com/xuri/excelize/v2@v2.11.0/file.go:117). Bound concurrent allocations and remove duplicated projection work first. Treat true constant-memory ZIP output as a later task only if its measured cost warrants changing the serialization implementation. Do not claim fully streaming exports from the existing worksheet stream writer.

**Files:** API heavy-operation gate and handler wiring in `handlers_authoring.go`/`handlers_grading.go`; `internal/authoring/workbook.go`; `internal/results/sat_rawdata_export.go` and `sat_rawdata_xlsx.go`; focused import/export tests.

**Gate:** multiple simultaneous staff requests cause at most one heavy operation per replica; slots recover after cancellation; identical import validation and export cell data/order/types; complete candidate groups; formula-safe string cells; tenant isolation; snapshot consistency. Demonstrate lower mixed-workload peak memory. A single valid large operation can still allocate substantially—record its ceiling.

### S4 — Keep draft previews out of the student cache

**Dependencies:** S0 cache measurements. **Deliverable:** authoring-only memory reduction when this cache is actually used.

If draft preview trees are a material retained allocation, add an independent authoring-preview cache switch. On the low-memory setting, pass nil to `Authoring.SetPreviewCache` and reuse the existing bulk-load fallback in `preview.go`. Keep `VERSION_CACHE` and student delivery cache limits/singleflight/revision checks unchanged.

Do not create a second cache immediately. Repeated previews might trade retained memory for database work; compare mixed exam/preview load before enabling the setting. Skip this step if production caching is off or the measured allocation is negligible. Previously retained entries may persist until normal eviction or a planned deployment; disabling future preview inserts is not immediate cache clearing.

**Files:** authoring-preview config and example; `internal/app/app.go` authoring wiring; existing preview/cache equivalence tests. No student cache algorithm change.

**Gate:** draft trees are no longer inserted by preview; preview output remains identical after edit, revision change, publish and undo; student cache still hits under authoring traffic; MySQL work and student latency do not regress enough to erase the benefit.

### S5 — Reduce measured staff query and polling work

**Dependencies:** S0 query evidence. **Deliverable:** fewer/bounded administrative allocations where evidence justifies it.

Inspect `ListSATAccessGroups`, administrative dashboard analytics, and RAWDATA query plans against representative history. Use statement summaries first and `EXPLAIN` on the confirmed staff query; run `EXPLAIN ANALYZE` only against isolated staging because it executes the query.

Only implement the measured need: reduce selected columns/duplicate work, or add group-level pagination plus client continuation when returned history is too large. Maintain complete group counts, search, tenant scope, sort order, pending/invalidated results, and deleted-access-link history. Do not add a bare global `LIMIT` to the current full-history contract. A result `LIMIT` after aggregation does not necessarily reduce the database's aggregation memory.

The staff answer viewer already avoids background polling. Only stop its 15-second refresh for terminal attempts if traffic measurements show it keeps unnecessary work active; continue refresh for live/paused attempts and keep manual refresh. Leave student and live proctor polling alone.

Do not add shared-table indexes just to save RAM: indexes can increase buffer-pool usage and student write cost. Require a demonstrated overall benefit before a separate migration.

**Files:** measured functions in `internal/results/service.go`/export reader; staff result API/UI if pagination or terminal polling changes. Skip unmeasured rewrites.

**Gate:** reduced staff allocation/query work at realistic history size; older records remain reachable; no change to result state or release behavior; no regression under concurrent exam saves.

### S6 — Rehearse, roll out separately, and retain evidence

**Dependencies:** each accepted implementation step. **Deliverable:** before/after report, rollback configuration, verified production artifact.

Run narrow tests as each step changes, then the shared-runtime regressions before deployment. Example commands from the repository root:

```bash
bun run coedit:typecheck
bun run coedit:test
bunx vitest run src/test/architecture/coedit-runtime-manifest.test.ts \
  src/test/architecture/coedit-transport-boundary.test.ts
bun run typecheck
bun run build
```

Backend commands run with `backend/go` as the working directory:

```bash
go test ./cmd/api ./cmd/worker ./internal/background \
  ./internal/authoring ./internal/authoringcoedit ./internal/results \
  ./internal/platform/config ./internal/platform/db -count=1

go test -race ./cmd/api ./internal/background \
  ./internal/authoring ./internal/authoringcoedit ./internal/results -count=1

go test ./integration/... -count=1
```

Real-DB API/integration tests require `TEST_MYSQL_DSN` pointing to a migrated disposable MySQL database. Skipped tests are not passing database evidence. Existing documentation's TiDB compose shortcut does not reproduce the production MySQL container.

Build and run the final Docker image in staging. Rehearse IELTS/SAT/ACT entry, save/reload, pause/resume, module transition, final submit and timed completion while authoring repeatedly starts/stops and imports/exports compete. Include an offline student whose server timeout must complete without another request. Keep all existing exam SLOs, including branch confidentiality and acknowledged-answer durability.

Use the current V2 workload in `k6/sat-module-entry-2000.js` with `K6_SAVE_LOOP=1` where appropriate, plus browser first-answerable-frame checks and the existing exam lifecycle scenarios. Choose concurrency matching the supported cohort and its planned burst, not an arbitrary 2,000-student capacity claim. `k6/sat-exam-day.js` alone uses the legacy save route and cannot certify the V2 save path. Supply an explicit isolated staging target and freshly seeded fixtures; some existing harness defaults reference production.

Soak mixed traffic and at least 20 authoring start/stop cycles; sample idle recovery and then a representative full-day window. Reject linear growth in child processes, document counts, pending retries, or post-idle retained memory. Report container median/p95/peak, co-edit breakdown, Go heap, MySQL allocation breakdown, connection wait deltas, and exam latency/durability results.

Release S1, S2, and later reductions separately. Roll out/restart outside active exams. Keep the previous image plus `always_on` mode as the S2 rollback, and preserve authoring data across both modes. Any lost edit, lost acknowledged answer, deadline/route change, confidentiality failure, or API restart from child parking blocks release. Compare the same warm workloads against baseline; a reboot's temporarily low RAM is not evidence of a lasting saving.

## Conditional MySQL tuning — outside the strict implementation

This is investigation-only until the deployed version, memory allocation, peak exam workload, and operator-controlled configuration are established. There is no production MySQL configuration in this repository; the local compose file declares TiDB and does not specify the Railway service's settings.

MySQL retains shared buffers and other allocations that cannot be cleanly assigned to “admin” versus “student.” Its documented memory behavior explains why a high resident plateau is not sufficient evidence of a leak. [How MySQL Uses Memory](https://dev.mysql.com/doc/refman/8.4/en/memory-use.html).

If S0 shows meaningful excess, prepare a separate staging configuration experiment:

| Measured allocation | Candidate experiment | Exam protection |
| --- | --- | --- |
| Oversized buffer pool with headroom after warm exam load | Reduce one supported size step, capture actual effective size, then rewarm and replay the same workload. | Keep flush/durability settings; reject increased save/entry latency or excessive physical-read/IO pressure. |
| Oversized performance-schema history/digest storage | Bound only the observed expensive history capacities while retaining memory, statement and lock diagnostics. | Do not disable all diagnostics; record restart requirements and rollback values. |
| Staff query temporary/sort work | First optimize/bound the measured staff query; investigate a staff-only statement setting if supported. | Do not set session state on a shared connection without guaranteed reset; do not globally shrink exam query buffers. |
| Excess connections | Reconcile every replica's API + worker pool limits, one co-edit lock connection, migrations and monitoring. | Do not lower `max_connections` below worst-case demand plus operational reserve; lowering its ceiling alone is not a measured RSS saving. |

Do not choose blind 128/256 MB pool values, enable database sleep, restart MySQL for cosmetic savings, disable binary logging without the backup/recovery contract, or change `innodb_flush_log_at_trx_commit`/durability settings. A MySQL change requires the same exam regression/load gates and a restore/rollback path. If the student-independent constraint remains absolute, stop after the scoped application work and report the remaining database baseline honestly.

## Completion criteria

- Working authenticated memory capture with no silent null values and explicit deployed-version attribution.
- Co-edit runtime absent during authoring idle while exams continue normally; complete durable authoring recovery on reopen.
- Staff allocations bounded by per-replica admission and reduced duplication, with preserved import/export/history contracts.
- Protected student/proctor/worker behavior exercised against real MySQL and the final image.
- Actual before/after savings reported separately for idle, authoring, exams and mixed peaks. Count image-size reductions separately from RAM.
- Scope-sensitive options accepted only when measurements show benefit; no forecast presented as a verified reduction.

Recommended first implementation batch: **S0 → S1 → S2**, then measure again before taking on S3–S5. This attacks resident authoring overhead first without expanding into exam logic or speculative database tuning.
