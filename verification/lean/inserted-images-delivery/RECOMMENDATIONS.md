# Recommendations

Ranked by correctness severity and proof impact. Each item names the exact
change and how it would be regression-proofed.

## 1. Done in this change — position-suffixed image keys (R7)

An imported payload that repeats an authoring id produced two React children
with the same key. Reconciliation is then unstable (React keeps the first child
and warns), which for a reorder or delete can repaint the wrong image. The keys
now carry the row position (`` `${row.id}::${index}` ``), and
`image_keys_have_distinct_positions` proves the position component is exactly
`0…n-1`. Regression-proof: the new test fails under an id-only key (verified by
reverting the scheme and re-running).

## 2. Closed in this change — blank-instruction shape (R2)

`blank_instruction_images_are_first` is proved, and
`keeps images before the questions when the instruction renders nothing` now
mounts the block section with `renderBlockInstruction={() => null}` (the
listening shape) and asserts image-before-question ordering. Remaining: exercise
it through the real `StudentListening` route once the backend is available.

## 3. Verify a real Drive link end-to-end before rollout (U1/U2/U3)

The model proves placement and provenance; it cannot prove that a shared Drive
file loads in a student browser, and the fix makes previously invisible images
appear on already-published versions. Start the local API, render the reported
block, and audit published `content_snapshot`s for the field to size the visible
change. If Drive reliability is a concern, add image-load telemetry (the
component already walks a candidate chain) before blaming the slot.

## 4. Decide the intended placement for listening (U4)

The slot is fixed by the editor's own copy ("after instruction and before
question content"), which puts the diagram in the answer pane. For listening,
diagram material has historically lived in the left/material pane (see
`diagramBlocksInMaterialPane`). If authors expect inserted images there instead,
that is a product decision to make explicitly rather than a rendering bug — and
if it changes, the model must be re-checked with a material-pane slot, since
`frameSlots` currently encodes question-pane placement only.

## 5. Re-run this engagement if the SAT/ACT content model gains the field (U5)

`SatQuestionRenderer` and the structured `ExamQuestionRenderer` consume
`DeliveredQuestion`/`QuestionRevision`, which have no `insertedImages` concept.
If the SAT authoring model adopts inserted images, the same slot, the same
filter semantics and the same key-uniqueness argument apply, and this project's
theorems should be re-pointed at the new renderer instead of duplicated.

## 6. Correspondence hardening (optional, larger)

The weakest link is that nothing mechanically connects the TypeScript to these
definitions. A cheap improvement with real leverage: extract the row-selection
and key-construction logic into a pure module (`resolveInsertedImageRows` is
already pure) and add a property test that runs the *same* generated payloads
through the TypeScript functions and through a textual mirror of the Lean
`decide` cases. That does not mechanize the translation, but it turns A1/A7 from
reviewed assumptions into generated-payload evidence.
