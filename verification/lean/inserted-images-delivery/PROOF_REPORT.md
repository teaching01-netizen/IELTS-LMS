# Inserted-images delivery verification report

## Verdict

| Field | Value |
| --- | --- |
| **Formal status** | **PROVED** for the theorem list below (pinned Lean 4.19.0 kernel, build + axiom audit both exit 0; no `sorry`, `admit`, custom `axiom`, or `native_decide` in the proof sources). |
| **Correspondence status** | **REVIEWED_WITH_TESTS** — the Lean definitions are a shape transcription of the TypeScript/JSX, not a verified translation. The `imageUrl.ts` regex classification is an **assumption** (A1), so R5's premise is unverified even though its theorem is proved. |
| **Production evidence** | **PARTIAL** — unit/integration suites, typecheck and lint pass; no browser-level rendering check was executed (no local Go API was running and the preview requires an author session). |
| **Overall** | **CONDITIONAL** — the requested property holds for the modelled frame and is implemented, but "students see the diagram" additionally depends on U1/U2 (Drive fetchability) and on a browser check that was not performed. |

## What the user-visible claim reduces to

The request was "the exam image for this question type does not load — fix it".
The precise defect was not a load failure: the delivery renderer never read
`block.insertedImages` at all, so no image element existed to fail. That is why
the immediate fix is a renderer plus one insertion point, and why the proof is a
statement about the produced child sequence and source provenance rather than
about network fetching.

## Reproducible Lean evidence

Run from `verification/lean/inserted-images-delivery/`:

```text
lean-toolchain: leanprover/lean4:v4.19.0
Lake project:   insertedImagesDelivery 0.1.0
Dependencies:   Lean core only (lake-manifest.json has no external package)
Lean:  Lean (version 4.19.0, arm64-apple-darwin23.6.0, commit 6caaee842e94, Release)
Lake:  Lake version 5.0.0-6caaee8 (Lean version 4.19.0)
```

```bash
lake build InsertedImagesDelivery Model Safety Counterexamples AxiomAudit
lake env lean AxiomAudit.lean
```

- Build transcript: [evidence/lean-build.txt](evidence/lean-build.txt) — `Build completed successfully`, `exit=0`.
- Statement/axiom audit: [evidence/lean-axiom-audit.txt](evidence/lean-axiom-audit.txt) — `exit=0`.
- Source identities: [evidence/source-snapshot.json](evidence/source-snapshot.json).

### Axiom audit

32 `#print axioms` results across two runs. Every theorem depends only on the
standard logical axioms — `propext` (19 results), `Quot.sound` (5),
`Classical.choice` (2, pulled in by `List.Nodup` decidability) — or on nothing at
all (13 results, including the witnesses compiled by kernel reduction). No
`sorryAx`, no custom axiom, no native-evaluation shortcut. The pinned toolchain
does **not** ship `leanchecker`, so no independent-checker result is claimed; the
Lake build plus `#print axioms` audit are the checks performed.

## Proved theorem groups

**S1 — placement.** `frame_decomposition` (frame = instruction ⧺ images ⧺ content),
`instruction_is_head` (index 0 is instruction), `images_at_index_one` (index 1 is
images), `content_after_images` (dropping the instruction and image slots leaves
exactly the content slots), `frame_content_slots` (everything after the images is
`Slot.content`), and the legacy counterpart `legacy_content_at_index_one`.

**S1b — blank instruction.** `blank_instruction_images_are_first`,
`blank_instruction_content_after_images`: when the instruction renders no element
(listening), the image is the first child and content still begins only after it.

**S2 — no empty container.** `empty_rows_render_legacy_frame` (no loadable row ⇒
the frame equals the pre-fix frame), `legacy_frame_has_no_images_slot` (the
pre-fix frame could never contain an image slot, for any block).

**S3 — exclusions.** `map_and_diagram_render_no_images`: `MAP` and
`DIAGRAM_LABELING` render no inserted images regardless of payload, mirroring the
authoring editor's own exclusion.

**S4 — selection.** `hasSources_true_iff` (the filter predicate is exactly the
candidate-emptiness test), `loadable_row_mem_and_loadable` (soundness),
`payload_row_with_sources_is_loadable` (completeness),
`loadable_rows_are_the_filter`, `loadable_row_ids_preserve_payload_order` (payload
order, no sort/dedupe/reversal).

**S5 — provenance.** `rendered_source_came_from_a_loadable_row` (every rendered
source is attributed to a loadable row and is one of its candidates),
`rejected_row_renders_nothing` (a blank/unsafe row is in the payload, contributes
no source, and is not selected), `drive_row_renders_four_candidates`.

**S6 — keys.** `image_key_positions` (the key material's position component is
exactly `0…n-1`), `image_keys_have_distinct_positions` (`.Nodup`),
`image_keys_length`.

**Witnesses / counterexamples** (`Counterexamples.lean`, all by kernel `decide`):
the reported block (`short answer`, "Label the diagram below.", one Drive row)
has loadable rows; its legacy frame provably lacks the image slot while its fixed
frame places it at index 1 and keeps three content children after it; a `MAP`
block carrying a loadable row still renders none; a mixed payload keeps only the
safe row, in order; and an id-only key scheme collides on repeated authoring ids
while the position-suffixed scheme does not.

## Adversarial review (hostile executions)

| Attack | Result |
| --- | --- |
| `insertedImages` missing / legacy blocks (`undefined`) | R3: `empty_rows_render_legacy_frame` proves the frame is unchanged; test `leaves blocks without inserted images untouched`. |
| Payload where every row is unusable | R3/R5: no container is emitted, not an empty one; test asserts `container` is empty of the images node. |
| Unsafe scheme (`javascript:`) | R5: provenance theorem + `rejected_row_renders_nothing`; test asserts no image is mounted. |
| Block type the editor excludes | R6: proved data-independent; test mirrors it. |
| Blank instruction (listening) | R2: proved, and now exercised by `keeps images before the questions when the instruction renders nothing` (mounts the section with `renderBlockInstruction={() => null}`). |
| Repeated authoring id (imported payload) | **Real hazard found.** Id-only keys collide → duplicate-key warning and unstable reconciliation. Fixed (position-suffixed key); the regression test was verified *discriminating* by reverting the key scheme and observing the failure, then restoring it. |
| Question content in the image slot | `frame_content_slots`: nothing after the image slot can be anything but `Slot.content`. |
| Sub-answer-tree branch / single-question branch | Branch-independent: the image node is a sibling of all three content branches, so `contentCount` is the only model input. |
| Empty caption | Caption is optional in both model and component; accessible name falls back to `Inserted image <n>` (test: `keeps the authoring order across multiple images`). |
| Server dropping the field | A3/A4 reviewed: Go stores `content_snapshot` as raw JSON with no field-level whitelist on the IELTS path, and `hydrateExamState` spreads (A5, tested). Not proved. |

## Anti-vacuity review

- `Init` is not a handpicked state: the theorems quantify over **all** `Block`
  values, and `imagesSlots`/`loadableRows` are total functions of the payload.
- The reachable-set analogue is non-empty and hostile-tested: a compiled witness
  block with a loadable Drive row exists, and the key-collision counterexample is
  compiled with `¬Nodup` on the legacy scheme.
- No invariant is assumed as its own precondition; every theorem is closed by
  induction/`decide` over the definitions.
- `contentSlots` cannot masquerade as `imagesSlots`: `Slot` is a two-constructor
  disjoint inductive and `frame_content_slots` uses `List.eq_of_mem_replicate`
  on `Slot.content`, so the "images before content" claim is not a restatement of
  an assumption.
- The one place a *weaker* statement could be smuggled in is R5's premise (A1,
  the regex classification), which is explicitly marked unverified rather than
  proved.
- The model does not confuse "source exists in the data" with "pixels painted":
  `renderedSources` is provenance, and U1 states the residual gap.

## Source identity

Repository base at engagement start: `2c319e59a7de3c15345e8ac575142d9254acb22a`
(`feat: improve SAT authoring and staff delivery flows`). The application change
and verification artifacts are **uncommitted working-tree changes**. Exact file
hashes at report generation are in [evidence/source-snapshot.json](evidence/source-snapshot.json);
re-run both commands (and re-capture hashes) after any proof-source edit.

## Limits

The Lean result is about the abstract frame model only. Not claimed: React
reconciliation semantics, DOM/CSS layout, image fetch success, backend
persistence beyond the reviewed raw-JSON read, SAT/ACT delivery applicability
(their content models have no `insertedImages` field), capacity, or production
readiness. Browser-level verification was not run: no local Go API was listening
on `:4000` and the section preview requires an author session.
