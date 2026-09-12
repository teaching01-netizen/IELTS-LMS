# Phase 5 — Annotations and workspace memory

Status: planned. Depends on: [Phase 4](phase-04-modules-journey.md). Next: [Phase 6](phase-06-reliability-security-performance.md).

## Result

Highlights, underline, and plain-text notes share the existing canonical-text selection mechanism and survive supported same-browser recovery. Presentation memory stays scoped to the right candidate/content. No annotation is stored as a DOM Range or as scored answer data.

## File ownership

- `src/components/student/highlightV2Engine.ts`, `highlightV2Persistence.tsx`, `highlightStorageKeys.ts`.
- `highlight/highlightStore.ts`, `highlightCommandService.ts`, `rangeNormalizer.ts`, `renderAdapter.ts`, `surfaceResolver.ts`, `selectionObserver.ts`.
- `highlightSelectionManager.tsx`, `useHighlightSurfaceV2.ts`, `RichTextHighlighter.tsx`, `HighlightableSurface.tsx`, `StudentAppWrapper.tsx`.
- Existing header/tools integration; proposed `annotationTypes.ts`, `StudentNoteEditor.tsx`, and focused tests if these responsibilities need separate files.

## P5.1 — Add a versioned typed model

Reuse the existing canonical UTF-16 text offsets so current DOM Range conversion stays consistent. Do not switch persisted offsets to Unicode code-point indexing during migration.

Proposed contract:

```ts
type AnnotationBase = { id: string; start: number; end: number };
type Annotation =
  | (AnnotationBase & { kind: 'highlight'; color: StudentHighlightColor })
  | (AnnotationBase & { kind: 'underline' })
  | (AnnotationBase & { kind: 'note'; text: string });

type SurfaceAnnotations = {
  schemaVersion: 3;
  sourceHash: string;
  sourceLength: number;
  annotations: Annotation[];
};
```

Scope storage by existing attempt namespace plus published version and surface ID. Do not use source hash as an authorization boundary or assume it is cryptographic. Immutable version/surface identity and safe validation still apply.

Validation defaults: retain the existing 200-annotation per-surface cap, cap note text at 2,000 Unicode code points, and bound serialized per-surface payload to 256KiB. These are implementation limits, not official test rules. Count/size failure rejects the new change with a clear message while preserving existing annotations; never silently truncate a saved note. Check finite integer offsets, `0 <= start < end <= sourceLength`, allowed kinds/colors, ID uniqueness, and surrogate-pair boundaries.

## P5.2 — Define operations and overlap behavior

Extend the existing command-service owner with pure operations:

- Highlight: use the current validated range/color merge behavior.
- Underline: add/merge underline spans without changing text metrics.
- Note: create or update a note by ID at a validated text anchor; overlapping notes remain independently identifiable.
- Erase: target the selected highlight/underline span using current range semantics. Notes have an explicit delete action; erase must not unexpectedly discard note text.
- Clear: operate only on the current attempt namespace with existing confirmation semantics; do not clear other candidates.

Keep the returned result explicit: updated annotations, unchanged, invalid selection, or limit/storage error. A canceled action never mutates the current model. New annotations get stable IDs once; rerendering must not generate new IDs.

## P5.3 — Migrate local records safely

1. Read V3 first. If absent, read the current V2 `{sourceHash, ranges}` record using its original attempt namespace and surface key, then validate it against the active canonical content. The new published-version key cannot be assumed to equal the legacy key.
2. Convert ranges deterministically to highlight annotations. Retain V2 records through the compatibility window, including after a successful V3 write; V3 is the sole live authority for upgraded attempts. Do not dual-write competing formats. The rollback plan must preserve compatible readers/assets for active V3 attempts; old V2 data alone cannot represent new notes/underline.
3. Hydrate the new namespace before enabling writes. Use a scope/version token to cancel stale effects so an old surface cannot write under a new surface's key.
4. Catch errors from obtaining storage and from read/write/remove/iteration, not only JSON parse/setItem. Keep in-memory data and expose persistence status.
5. On hash/length/content-version mismatch, do not paint old offsets onto new text. Retain recoverable records and explain that those annotations belong to different content where useful; do not silently delete them.
6. A malformed record cannot crash exam rendering. Ignore invalid fields/records safely and preserve valid prior data when a new write fails.

The local persistence owner reports `saved`, `pending`, or `error` for annotations independently of answer save status. An annotation failure must not mark exam answers unsaved, and answer success must not imply notes were saved.

## P5.4 — Render without changing canonical text

Build annotation decoration from the immutable sanitized base content and normalized offsets. Reuse the current renderer/DOM-stability boundary. Never use decorated HTML as the next input to annotation rendering, which would accumulate nested marks and change offset interpretation.

Render note text through React text nodes. Underline is decoration, not a line-height or font-weight change. Keep note icons outside the canonical offset text stream or explicitly excluded by the canonical-text traversal. Verify overlapping annotation kinds and marks spanning paragraphs do not reorder or duplicate text.

Test range boundaries around emoji, surrogate pairs, combining characters, repeated phrases, nested emphasis, table cells, and non-text images. Do not allow cross-surface selection to anchor one note to unrelated passage/question content.

## P5.5 — Add the toolbar and note editor

Capture normalized selection before a toolbar click changes focus. Native selection and permanent highlight use distinguishable colors. Desktop uses the existing anchored tools; phone uses its persistent tool affordance and accessible sheet. Do not fight native touch selection handles.

Note editor behavior: labeled textarea, selected passage context, Save/Cancel, character limit, persistence feedback, keyboard Escape/cancel, and focus restoration. Keep unsaved note editor draft in memory until saved/canceled; closing because of a proctor block must not discard it silently. No rich-text formatting or HTML input is needed.

All operations need keyboard access. Do not introduce global single-character shortcuts that intercept exam typing. Clear transient selection/erase mode on phase exit, identity change, and reload. Persist annotations, not an open editor or active eraser.

## P5.6 — Finish scoped workspace memory

Use Phase 2's attempt/version/module key. Preserve source/question scroll anchors, split ratio, and practical Writing caret/scroll for the matching content. Keep popovers, hover, pointer capture, and destructive tool state ephemeral.

Identity changes release old listeners/effects before restoring new state. Prefer existing attempt IDs; never merge namespaces by exam title. On logout/verified completion follow existing answer-retention policy; cosmetic cleanup must not remove unacknowledged or quarantined answer drafts.

Same-browser persistence is the scope. Cross-device annotation sync would need a separate authenticated API, revision policy, and retention contract. It is not claimed by these local changes.

## Tests and exit gate

Extend the current highlighter and DOM-stability suites; add pure model/migration/storage-error tests in the same feature. Required cases include V2→V3 success/failure, oversized note rejection without data loss, duplicate/malformed IDs, concurrent namespace switch, stale effect, invalid offsets, overlap/erase, unsafe note text, and restore after reload.

```sh
npm run test:run -- src/components/student/__tests__/RichTextHighlighter.test.tsx src/components/student/__tests__/HighlightableSurfaceDomStability.test.tsx src/components/student/__tests__/highlightSelectionManager.state.test.tsx src/components/student/__tests__/StudentAppWrapperHighlightPersistence.test.tsx
npm run typecheck
```

Suggested commits: typed model/operations; migration/persistence status; renderer; note/tool UI; scoped restore tests. Exit when migrated data is recoverable, canonical text is unchanged, no cross-candidate state appears, and failures are truthful. Real touch-selection behavior remains a later device gate.
