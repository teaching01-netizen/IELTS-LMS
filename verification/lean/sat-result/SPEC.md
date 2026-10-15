# SAT result: specification as verified

The source document previously referenced as `docs/sat-result.md` is not present
in this checkout. This file records the SAT result and release properties that
this Lean package models. Current global score-conversion behavior is specified
and modeled separately in [`../sat-score-conversion/SPEC.md`](../sat-score-conversion/SPEC.md).

## Scope (Phase 0)

**Feature.** What happens after a SAT attempt in a classroom session completes:
- the server computes and persists the attempt's result row;
- the student sees a score report only once it is released;
- the student can print the answered exam paper.

**Authoritative state.**
- `assessment_results`, unique on `(attempt_id, provider_key)`, holding `outcome_status`, `release_status` and `score_payload.classroomRaw`.
- `assessment_section_results`, unique on `(assessment_result_id, section_key)`.
- `assessment_module_attempts`: `raw_correct` and `operational_question_count`, written at module close. Unique on `(attempt_id, module_id)`.
- Saved responses, unique on `(module_attempt_id, exam_question_id)`.

**Actors.**
- Student submit.
- Timer / timeout sweep.
- Proctor terminate.
- Late module scoring.
- The `RepairClassroomResults` sweep, with any number of instances.
- The student browser: reload, render, media loads, print.

**Observable outcomes.**
- The student-safe result projection returned by bootstrap.
- The rendered score report.
- The printed paper.

**Fault boundary.**
- Transactions abort atomically.
- Any number of concurrent sweepers.
- Lost close-ack / delayed save.
- Media load failure.
- Re-read failure.
- Timeout.

**Gate.** A report is released only when the exam's `sat_score_report_enabled` flag is on and the attempt's schedule has `sat_session_mode = 'classroom'` (`results.SATScoreReportOpenSQL`). Migration 0085 backfilled the flag for exams that had run a classroom session; the session-mode check still withholds Standard Practice sittings.

**Out of scope:** IRT/official-score validity, conversion-table values, percentiles, PDF pixel fidelity, browser print engine behaviour, capacity.

### What is actually implemented vs. what the plan asks for

The plan asks for **converted** 200–800 / 400–1600 scores and a **server-side**
PDF endpoint. The repository implements:

| Plan item | Implemented as | Consequence for this verification |
| --- | --- | --- |
| Converted section scores + total | Migration 0087 adds a global, versioned policy. Student and staff result reads apply its active revision to released `classroomRaw` module scores; exact topology/count mismatches are unavailable, and a total is emitted only for two converted full sections. Before the first global publish, any conversion already stored at seal remains visible. | The active-policy model and the result/release model are separate. The current Go paths are reviewed and tested, but no Lean refinement composes policy lookup, topology resolution, total construction, and release gates end to end. See [`../sat-score-conversion/TRACEABILITY.md`](../sat-score-conversion/TRACEABILITY.md). |
| Score report (§3) | **Raw** classroom report: `score_payload.classroomRaw = {rawCorrect, total, sections[], domains?}` materialized at seal, released only when every module is scored and the report gate is on. In production the gate requires both the exam's score-report flag and classroom session mode. | The release model captures the gate abstractly; its full SQL correspondence is reviewed and tested, not mechanized. |
| Answered Exam PDF (§4–5) | Client-side: `AnsweredExamPaper` + `window.print()` in the student completion screen, gated by `PrintGate`. No `GET …/answered-exam.pdf`, no staff export. | Paper semantics and print gate proved. Server endpoint, staff export, PDF-08 for that endpoint, and PDF-09 are **NOT ESTABLISHED**. |
| Staff view (§6) | `attachSATModules` nests module rows by `sectionKeys[i]`. | Proved (Attach). |

## Guarantees

The IDs are local to this package. The plan's own IDs are mapped in
[TRACEABILITY.md](TRACEABILITY.md).

### Safety

| ID | Guarantee (exact interpretation) |
| --- | --- |
| CONV-1 | The live global policy returns an estimate only for an assigned table matching the administered topology and operational counts, with an in-range raw score and valid cell. Missing or invalid mappings are unavailable, never fabricated. |
| CONV-2 | A combined total exists only when Reading & Writing and Math both convert from full two-module topologies. Single-subject and standalone Module 2 sittings have no combined total. |
| SCORE-1 | A module's raw score counts exactly the non-pretest correct rows, and its operational count is exactly the non-pretest rows. Pretest rows are irrelevant to both, and raw ≤ operational. |
| RPT-1 | The report has **one section per section key**, in first-appearance order. Each section's raw and total equal the sum over exactly that key's module rows, and the report totals equal the sum over all rows. This holds even when a section's modules are interleaved with another section's in query order. |
| RPT-2 | A report exists **iff** there is at least one module row and every row has a non-NULL raw score with a non-NULL, positive operational count. Then `0 ≤ raw ≤ total`, `0 < total`, and the same holds per section. |
| REL-1 | A result row is `released` only if it is `scored` and carries exactly `reportOf(modules)` — the report computed from the persisted module rows. |
| REL-2 | A release happens only when the score-report gate is on. In production, `SATScoreReportOpenSQL` requires both `exam_entities.sat_score_report_enabled` and `exam_schedules.sat_session_mode = 'classroom'`; with the gate off, `classroomRaw` is never produced. The Go/SQL correspondence is reviewed and tested, not mechanized. |
| REL-3 | Submit is a no-op on an existing row. A repeated terminate by the same actor is a no-op. Repair only acts on a `pending/pending` row. In the model, a released row changes only through a terminate. Production never terminates a sealed submitted attempt (A-RCPT), so there a released row is final (L-2). |
| REL-4 | The student-visible projection exposes score fields only when the score-report gate is on **at read time** and `norm(release_status) = "released"`. In production the gate also requires classroom session mode. The only payload key it can expose is `classroomRaw`. The client renders a report only for the literal `"released"`. Turning the report flag off or changing the session out of classroom mode hides an already released report. |
| STAFF-1 | In the staff breakdown each section holds exactly its own module rows, in order — sound and complete — even when two sections share a module key. |
| PAPER-1 | Each question carries exactly one indication: a single circled option, an "unmatched" note, or "Unanswered". The circle is on the option whose id equals the recorded answer. The circle does not depend on correctness (the paper has no key input). |
| PAPER-2 | The paper reads each answer by `(module, exam_question_id)`, given one response per key. A question reused across modules shows each module's own answer. |
| PAPER-3 | The paper is `complete` iff every administered (started) module is present and not withheld. |
| PRINT-1 | Every printed paper meets four conditions. It is complete. All of its figures decoded. No media failure was seen during its flow. It is the current generation, rendered after a successful authoritative re-read that started after the click. |
| PRINT-2 | At most one download flow runs per screen: `busy = false ↔ idle`. |
| PRINT-3 | Once the module is closed, the server's accepted answers never change. A re-read makes the cache equal to the server, and it stays equal. |

The `ConvertTopo` theorems in this package state topology, operational-count,
standalone-module, and combined-total contracts for the per-exam converter
interface. They do not refine the current global `Content` read overlay. The
separate global policy model proves its stated lookup, publish, and display
properties, but is not composed with `ConvertTopo` or the result-release model.
The complete production path therefore still relies on code review and tests
for its correspondence to Go and SQL.

### Liveness (conditional)

| ID | Guarantee |
| --- | --- |
| LIVE-1 | If the gate is on and every module row is scored with operational count > 0, then a fresh submit releases the report. Repair of a `pending/pending` row also releases it. It is conditional on the repair job eventually running (fairness, assumption A-FAIR). |
| LIVE-2 | A polling print flow can always end, returning to idle without printing. |

**Not guaranteed (proved counterexamples).**
- A module with zero operational questions blocks release forever (L-1). The publish gate makes this unreachable for gated releases (A-PUB).
- Turning the flag on later releases older pending results (L-3). The settings panel documents this as intended: "a change applies to past attempts too".

Limitation IDs L-1…L-9 are defined in [ASSUMPTIONS.md](ASSUMPTIONS.md#known-limitations).

## Initial conditions

- `ResultMachine.Init`: any attempt (any module rows, flag, started flag) that has no result row and is unsealed. The theorems quantify over **all** such states, not a handpicked one.
- `PrintGate.init`: idle, generation 0, nothing printed.
- `CloseAck`: arbitrary server / cache contents with the module open.

## Exclusion boundary

These are not claimed:
- that raw scores or any converter represent College Board scores;
- the domain/skill breakdown (best-effort, not modeled);
- KaTeX/image visual fidelity in the printed output;
- browser print-dialog behaviour;
- the server PDF endpoint and staff export (not implemented);
- concurrent-download capacity;
- deployment topology (instance count, DB isolation level in production: **UNKNOWN**).
