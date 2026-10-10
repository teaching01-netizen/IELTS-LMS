# Assumptions and Unknowns

## Assumptions

| ID | Assumption | Owner | Validation / status |
| --- | --- | --- | --- |
| A-1 | The application generator and ParseSATWorkbook define the authoritative workbook contract. | Backend authors | Inspected at the recorded source snapshot; generator and parser integration tests passed. Model/code equivalence is not mechanically proved. |
| A-2 | The repeated module and taxonomy data in Lean, the Go generator, and importer are intended to agree. | Backend authors | The Go test checks generated taxonomy rows and parses a completed fixture exercising each taxonomy pair. Future edits must rerun these checks. |
| A-3 | A plain-text XML cell type is required for the long prompt and all guidance values. | Workbook consumers | Explicit Excelize cell-type checks passed after the encoder fix. A spreadsheet-viewer smoke check remains outstanding. |
| A-4 | A concrete valid fixture is useful correspondence evidence for the modeled parser contract. | Verification author | Lean proves the concrete model fixture; Go tests independently build and parse a completed workbook. The two fixtures are not generated from a shared machine-readable definition. |
| A-5 | Human source comparison is the final check for transcription accuracy and uncertain content. | SAT exam owner / staff | Required by the Guide and prompt; not an application-enforced property. |
| A-6 | No new concurrency or persistence mechanism is introduced by workbook generation. | Feature owner | Generator is deterministic. Existing import commit behavior remains outside the Lean model. |

## Unknowns / unresolved

| ID | Unknown or gap | Owner | Required evidence |
| --- | --- | --- | --- |
| U-1 | Exact committed revision containing the implementation and proof artifacts. | Repository owner | The current HEAD is d1bf8ce..., but the working tree is dirty. This report additionally records SHA-256 for each relevant source file. Re-run against the final commit before making a release claim. |
| U-2 | Rendering and copy/paste behavior in each supported spreadsheet application. | Product / QA | Open the generated workbook in the supported desktop viewer and inspect B4, Unicode, line breaks, active tab, and hidden _SAT state. Not run here. |
| U-3 | End-to-end authenticated download behavior on the current integrated route. | API owner | Run the authenticated/unauthenticated endpoint integration cases in the target environment. No direct endpoint authorization test was run for this task. |
| U-4 | Production DB engine, isolation, replica topology, deployment skew, and commit conflict behavior. | Platform / API owner | Not needed to establish the generator’s finite workbook facts. Re-open if the feature changes preview/commit or authorization paths. |
| U-5 | Whether external AI behavior matches the prompt. | Staff process owner | Cannot be established by this application proof. Require human source review and report blockers. |

## Axiom policy

The Lean audit reports no axiom dependencies for the 23 audited theorem statements. No sorry, admit, or custom axiom is used. The independent leanchecker binary is not available in the pinned Lean 4.19.0 toolchain.
