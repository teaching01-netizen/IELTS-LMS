# Traceability: requirement → theorem → code → test

Status vocabulary: **Formal** (`PROVED` / `FAILED` / `NOT_RUN`), **Correspondence**
(`MECHANIZED` / `REVIEWED_WITH_TESTS` / `UNVERIFIED` / `MISMATCH`), **Evidence**
(`VALIDATED_IN_STATED_PROFILE` / `PARTIAL` / `NOT_TESTED`).

| REQ | Guarantee | Lean theorem(s) | Implementation anchor | Test oracle | Formal | Correspondence | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Images after instruction, before question content | `frame_decomposition`, `instruction_is_head`, `images_at_index_one`, `content_after_images`, `frame_content_slots` | `StudentQuestionBlockSection.tsx` (frame children), `StudentInsertedImages.tsx` | `inserted images in the delivered question block › renders images after the instruction and before the question content` (DOM order via `compareDocumentPosition`) | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| R2 | Blank instruction keeps images first | `blank_instruction_images_are_first`, `blank_instruction_content_after_images` | `StudentListening.tsx` `renderBlockInstruction` returns `null`; image node is a sibling of the question list | `keeps images before the questions when the instruction renders nothing` (mounts the section with `renderBlockInstruction={() => null}`) | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| R3 | No empty container; unchanged frames for blocks without images | `empty_rows_render_legacy_frame`, `legacy_frame_has_no_images_slot`, `legacy_content_at_index_one` | `StudentInsertedImages` returns `null` when `resolveInsertedImageRows` is empty | `leaves blocks without inserted images untouched`; `drops rows with no usable source and renders nothing when none remain` | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| R4 | Selection sound, complete, order-preserving | `hasSources_true_iff`, `loadable_row_mem_and_loadable`, `payload_row_with_sources_is_loadable`, `loadable_rows_are_the_filter`, `loadable_row_ids_preserve_payload_order` | `resolveInsertedImageRows` (map → filter) | `mixed` payload assertions; `keeps the authoring order across multiple images` | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| R5 | Rejected URLs render nothing; no invented sources | `rendered_source_came_from_a_loadable_row`, `rejected_row_renders_nothing` | `getImageUrlCandidates` + `resolveInsertedImageRows` filter | `drops rows with no usable source…` (blank + `javascript:`) | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| R6 | Excluded block types render none | `map_and_diagram_render_no_images` | `supportsInsertedImages` in `src/utils/insertedImages.ts` | `keeps the authoring exclusion for map and diagram labeling blocks` | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| R7 | No duplicate React key material | `image_key_positions`, `image_keys_have_distinct_positions`, `image_keys_length`; counterexamples `id_only_keys_collide_on_duplicate_authoring_ids`, `position_suffixed_keys_do_not_collide` | key `${row.id}::${index}` in `StudentInsertedImages.tsx` | `renders rows that repeat an authoring id without colliding` (verified discriminating: fails under an id-only key) | PROVED | REVIEWED_WITH_TESTS | VALIDATED_IN_STATED_PROFILE (vitest) |
| R8 | `insertedImages` survives delivery hydration | not modelled (spread semantics) | `hydrateExamState` spread; Go raw-JSON `content_snapshot` | `preserves block inserted images through delivery hydration` | NOT_RUN | REVIEWED_WITH_TESTS | PARTIAL |

## Implementation correspondence map

| Lean definition | Implementation | Equivalence argument | Status |
| --- | --- | --- | --- |
| `Slot` / `frameSlots` | `StudentQuestionBlockSection` JSX children: heading+instruction `div`, then `<StudentInsertedImages/>`, then the question-content `div` | Structural reading of the JSX. The Lean slot list has no heading element; the heading is inside the instruction `div` and is therefore inside `Slot.instruction` for ordering purposes. | REVIEWED_WITH_TESTS |
| `frameSlotsNoInstruction` | Listening's `renderBlockInstruction` returning `null` | The image node remains a sibling after the (absent) instruction and before the question list. | REVIEWED_WITH_TESTS |
| `legacySlots` | The pre-fix JSX (instruction `div` then questions `div`) | The pre-fix source and `git diff` of `StudentQuestionBlockSection.tsx`. | REVIEWED_WITH_TESTS |
| `loadableRows` / `hasSources` | `resolveInsertedImageRows(...).filter(sources.length > 0)` | `hasSources` mirrors `getImageUrlCandidates(url).length > 0`; the row-level filter is the same predicate. | REVIEWED_WITH_TESTS |
| `candidatesOf` | `getImageUrlCandidates` | The four Drive strings are transcribed literal-for-literal; the `plain` branch is the raw URL. The regex predicates are *assumed* (A1), not derived. | REVIEWED_WITH_TESTS (regex classification UNVERIFIED) |
| `imagesSlots` | `StudentInsertedImages` returning `null` vs a container | `null` ⇒ no DOM node (no empty container), consistent with R3. | REVIEWED_WITH_TESTS |
| `contentSlots` (`replicate contentCount content`) | Whichever of the three branches renders questions (`SubAnswerTreeQuestionList`, mapped `questions`, or the single block renderer) | The image node sits outside all three branches, which is why the placement theorem is branch-independent. | REVIEWED_WITH_TESTS |
| `renderedSources` | `StudentZoomableMedia` `sources` array + its `advanceImageSourceCandidate` fallback | Provenance only: the model says where sources come from, not which candidate ultimately paints. | REVIEWED_WITH_TESTS |
| `imageKeys` | `key={`${row.id}::${index}`}` | Position component is the map index; the model keys on that position. | REVIEWED_WITH_TESTS |

## Gaps named in the mapping

- No mechanized link exists between the TypeScript and the Lean definitions:
  this is a shape model plus tests, not a verified translation of the compiled
  component. Every `Correspondence` cell above is therefore at most
  `REVIEWED_WITH_TESTS`.
- `imageUrl.ts`'s regex classification (A1) is an assumption about JS regexes,
  not a derived fact; a wrong pattern would leave R5's premise unverified even
  though the theorem is proved.
- R2's implementation side is covered by a test that simulates the listening
  shape (`renderBlockInstruction={() => null}`); a full listening-route render
  still requires the backend and an author session.
