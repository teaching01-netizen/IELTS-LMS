# SAT Import Workbook Specification

## Target

Preserve the SAT workbook import contract while expanding the Guide and AI Instructions sheets. The primary input is the workbook returned by buildSATWorkbookTemplate. The import acceptance boundary is ParseSATWorkbook and its preview.Valid result.

This scope includes the optional initial active sheet and the copy-only hint beside the existing download action. It does not change persistence, commit transactions, import idempotency, exam authorization, or database behavior.

## Required workbook contract

The generated workbook has these sheets in this order:

1. Questions
2. Guide
3. Assets
4. AI Instructions
5. _SAT, hidden

The Questions sheet retains these 17 headers in order:

Module, Order, Prompt, Stimulus, Response Type, A, B, C, D, Correct, Accepted Responses, Domain, Skill, Difficulty, Pretest, Rationale, Tags.

The six module labels and preassigned row counts are:

| Module | Count |
| --- | ---: |
| Reading & Writing · Module 1 | 27 |
| Reading & Writing · Module 2 — Lower | 27 |
| Reading & Writing · Module 2 — Higher | 27 |
| Math · Module 1 | 22 |
| Math · Module 2 — Lower | 22 |
| Math · Module 2 — Higher | 22 |

There are 147 question slots and 148 Questions rows including the header. The workbook version remains 2. The Questions validation ranges cover rows 2 through 148; Skill refers to _SAT column D rows 1 through 31.

If the P1 active-sheet change is present, active tab index 3 resolves to AI Instructions while sheet order and _SAT visibility stay unchanged.

## Import acceptance abstraction

For a module fixture, the Lean predicate requires:

- Exactly the module’s specified number of question rows.
- Unique in-range order values.
- Every row has the expected module key, a nonempty prompt, a valid section/domain/skill pair, and Easy, Medium, or Hard difficulty.
- Multiple Choice has four nonempty choices and one Correct letter A through D.
- Student Response is Math-only, has blank choices and Correct, and has accepted response text.
- Exactly two rows have Pretest set to Yes.

The complete fixture theorem checks one concrete 147-question fixture, not every possible parser-accepted workbook. The generated blank fixture theorem checks the modeled blank/default rows. Actual parser behavior is exercised separately through Go tests.

## Safety and content requirements

- Guide and AI Instructions cells are plain text. They contain no formulas or embedded pictures.
- Embedded pictures remain restricted to Assets column D by the existing importer.
- The guide and prompt explain field meanings, module mappings, taxonomy, response shapes, pretest placeholders, math/markup, image placement, privacy, blockers, and human source review.
- A blank generated workbook remains invalid. A correctly completed workbook remains valid in preview.
- Existing authenticated download, explicit replacement confirmation, and stale-revision conflict safeguards remain intact.

## Exclusions

Lean does not prove the Go XML generator, Excelize, Excel/LibreOffice rendering, endpoint authorization, or the existing database commit path. Those connections are covered by source review and tests to the extent recorded in TRACEABILITY.md. Lean does not prove that an external AI follows the prompt, that source transcription is accurate, or that an answer key is correct. Human review remains necessary.
