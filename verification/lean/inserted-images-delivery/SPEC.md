# Inserted-images delivery specification

## Verification target

An IELTS question block may carry `insertedImages` (authored in the builder's
"Inserted Images" editor, one or more rows of `{ id, url, caption }`). The
delivered question pane must render those images **after the block's instruction
and before its question content**, exactly as the authoring editor promises
("Appears after instruction and before question content. Supports Google Drive
share links.").

The defect this verification covers: the field was read by the authoring editor,
the validator and the text export only. No delivery renderer read it, so the
authoring pane showed the diagram while the section preview and student delivery
showed nothing. The fix adds a delivery renderer and one insertion point in
`StudentQuestionBlockSection`, through which every IELTS module (reading,
listening, science), the runtime section preview and the review surface render
their blocks.

**Authoritative state:** the block payload stored in `exam_versions.content_snapshot`
(Go stores it as raw JSON and the browser hydrates it, so the field reaches
delivery unchanged). **Externally observable outcome:** the DOM child sequence
of one question block's frame. **Actors:** one authoring client, one student or
preview client. **Fault boundary:** none of interest — this is a pure rendering
function over already-delivered state; there is no concurrency, no transaction,
no network write, and no distributed coordination in the change.

## Requirements

| ID | Guarantee | Classification |
| --- | --- | --- |
| R1 | For any block with at least one loadable inserted-image row, the delivered frame places the images after the instruction and before every question-content child. | Safety (placement) |
| R2 | With a blank instruction (rendering no instruction element), the images still precede all question content. | Safety (placement) |
| R3 | A block with no loadable row renders a frame structurally identical to the pre-fix frame: no empty container, no reordering, nothing removed. | Safety (regression) |
| R4 | Row selection is sound (every rendered row came from the payload and resolves to a source), complete (every payload row that resolves to a source renders) and order-preserving (payload order). | Safety |
| R5 | A URL that resolves to no candidate (blank, or an unsafe scheme) never produces a rendered source; rendering never invents a URL. | Safety (provenance) |
| R6 | Blocks the authoring editor excludes from inserted images (`MAP`, `DIAGRAM_LABELING`) render none, whatever data they carry. | Safety / parity |
| R7 | Two rendered images never share React key material, including when an imported payload repeats an authoring id. | Safety (reconciliation) |
| R8 | The payload keeps `insertedImages` through the delivery hydration the preview and student routes use (`hydrateExamState`). | Data path |

## Formal envelope

`Model.lean` is a shape model: a question block reduced to its type, instruction,
authoring rows and content-child count; a URL reduced to the four classes
`getImageUrlCandidates` distinguishes (`blank`, `unsafeScheme`, `drive`, `plain`);
and a slot sequence (`instruction`, `images`, `content`) standing for the frame's
DOM child order. `frameSlots`, `legacySlots`, `loadableRows`, `hasSources`,
`imagesSlots`, `contentSlots`, `renderedSources` and `imageKeys` transcribe the
selection and placement logic of `StudentInsertedImages` /
`StudentQuestionBlockSection` / `getImageUrlCandidates`.

The model proves properties of *these definitions*. It does not model React
reconciliation, the DOM, CSS, layout, image fetching or load failure, the
browser's DOM key semantics, the Go backend, JSON encoding, or the deployment.
R8 is not in the Lean model: the spread-merge behaviour of `hydrateExamState` is
covered by a unit test and by the Go storage read, and is labelled
`REVIEWED_WITH_TESTS`, not proved.

## Explicitly not claimed

- That the compiled JavaScript/TypeScript implements these definitions
  (correspondence is reviewed + tested, not mechanized).
- That any image actually *loads* in a browser (network, Drive sharing
  permissions, CORS behaviour).
- That the layout looks as intended (visual/CSS verification).
- Anything about SAT delivery or the structured `ExamQuestionRenderer` surfaces:
  their content models (`DeliveredQuestion`/`QuestionRevision`) have no
  `insertedImages` field, so the requirement is not applicable there.
- Any capacity, performance or production-readiness property.
