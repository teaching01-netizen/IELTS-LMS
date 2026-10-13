# SAT result: specification as verified

Source requirement: [`docs/sat-result.md`](../../../docs/sat-result.md) (score
conversion, SAT-style score report, Answered Exam PDF, release/authorization,
test table SC-01…REG-01).

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

**Gate.** "Classroom" in this package means an exam whose `sat_score_report_enabled` is on. Migration 0085 backfilled the flag to `TRUE` for every exam that had run a classroom session. A Standard Practice session of such an exam therefore also releases the raw report. REG-01 holds for exams with the flag off (L-4).

**Out of scope:** IRT/official-score validity, conversion-table values, percentiles, PDF pixel fidelity, browser print engine behaviour, capacity.

### What is actually implemented vs. what the plan asks for

The plan asks for **converted** 200–800 / 400–1600 scores and a **server-side**
PDF endpoint. The repository implements:

| Plan item | Implemented as | Consequence for this verification |
| --- | --- | --- |
| Converted section scores + total (§1–2) | `PolicyScorer.ScoreSection` exists and is fail-closed, but **no production path calls it** (`grep ScoreSection(` → only tests). No converter versioning, no publish gate. | The converter *primitive* and the total *contract* are proved; SC-01…SC-05 end-to-end are **NOT ESTABLISHED**. |
| Score report (§3) | **Raw** classroom report: `score_payload.classroomRaw = {rawCorrect, total, sections[], domains?}` materialized at seal, released only when every module is scored and the exam's score-report flag is on. | Fully modeled (Report, ResultMachine, Release). |
| Answered Exam PDF (§4–5) | Client-side: `AnsweredExamPaper` + `window.print()` in the student completion screen, gated by `PrintGate`. No `GET …/answered-exam.pdf`, no staff export. | Paper semantics and print gate proved. Server endpoint, staff export, PDF-08 for that endpoint, and PDF-09 are **NOT ESTABLISHED**. |
| Staff view (§6) | `attachSATModules` nests module rows by `sectionKeys[i]`. | Proved (Attach). |

## Guarantees

The IDs are local to this package. The plan's own IDs are mapped in
[TRACEABILITY.md](TRACEABILITY.md).

### Safety

| ID | Guarantee (exact interpretation) |
| --- | --- |
| CONV-1 | A conversion returns a number **iff** the table holds an integer entry for that `(section, route, raw)` and it lies in `[200, 800]`. A `null`, a missing entry, or an off-scale entry gives *no number* (never 0, never the raw value). |
| CONV-2 | A combined total exists **only** when both sections converted, and then lies in `[400, 1600]`. A single-section exam has no total. |
| SCORE-1 | A module's raw score counts exactly the non-pretest correct rows, and its operational count is exactly the non-pretest rows. Pretest rows are irrelevant to both, and raw ≤ operational. |
| RPT-1 | The report has **one section per section key**, in first-appearance order. Each section's raw and total equal the sum over exactly that key's module rows, and the report totals equal the sum over all rows. This holds even when a section's modules are interleaved with another section's in query order. |
| RPT-2 | A report exists **iff** there is at least one module row and every row has a non-NULL raw score with a non-NULL, positive operational count. Then `0 ≤ raw ≤ total`, `0 < total`, and the same holds per section. |
| REL-1 | A result row is `released` only if it is `scored` and carries exactly `reportOf(modules)` — the report computed from the persisted module rows. |
| REL-2 | A release happens only when the score-report gate is on. The gate is the per-exam `exam_entities.sat_score_report_enabled` flag: migration 0085 made it replace the classroom-session check, default `FALSE`. With the gate off, `classroomRaw` is never produced. |
| REL-3 | Submit is a no-op on an existing row. A repeated terminate by the same actor is a no-op. Repair only acts on a `pending/pending` row. In the model, a released row changes only through a terminate. Production never terminates a sealed submitted attempt (A-RCPT), so there a released row is final (L-2). |
| REL-4 | The student-visible projection exposes score fields only when the exam's flag is on **at read time** and `norm(release_status) = "released"`. The only payload key it can expose is `classroomRaw`. The client renders a report only for the literal `"released"`. So the student sees `classroomRaw` only while the flag is on and the server row is released. Turning the flag off hides an already released report. |
| STAFF-1 | In the staff breakdown each section holds exactly its own module rows, in order — sound and complete — even when two sections share a module key. |
| PAPER-1 | Each question carries exactly one indication: a single circled option, an "unmatched" note, or "Unanswered". The circle is on the option whose id equals the recorded answer. The circle does not depend on correctness (the paper has no key input). |
| PAPER-2 | The paper reads each answer by `(module, exam_question_id)`, given one response per key. A question reused across modules shows each module's own answer. |
| PAPER-3 | The paper is `complete` iff every administered (started) module is present and not withheld. |
| PRINT-1 | Every printed paper meets four conditions. It is complete. All of its figures decoded. No media failure was seen during its flow. It is the current generation, rendered after a successful authoritative re-read that started after the click. |
| PRINT-2 | At most one download flow runs per screen: `busy = false ↔ idle`. |
| PRINT-3 | Once the module is closed, the server's accepted answers never change. A re-read makes the cache equal to the server, and it stays equal. |

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
