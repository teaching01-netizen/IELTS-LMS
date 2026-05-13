# Student Highlight Surface V3 Design (Cross-Block, Surface-Bounded)

Date: 2026-05-13
Status: Proposed
Owner: Student UI module (`src/components/student/*`)

## 1) Context and Problem

The current student highlight stack is partially split across legacy snapshot HTML logic and V2 range logic:

- Legacy path: `highlightSelection.ts` + `highlightPersistence.tsx`
- V2 path: `highlightSelectionPort.tsx` -> `captureSurfaceSelection` in `highlightV2Engine.ts` -> `useHighlightSurfaceV2.ts` -> `highlightV2Persistence.tsx`

Recent incident history shows recurring instability around:

- selection endpoint boundary handling
- toolbar selection race timing
- cross-block behavior (currently fail-closed reject)
- anti-cheat/selection interaction

Current V2 correctness is strong for fail-closed behavior, but it still hard-rejects cross-block ranges (`enforceSingleBlock` + block-boundary guard). Product direction now requires:

- allow cross-block selection in reading and question display text
- keep answer controls excluded
- keep strict same-surface boundary checks

## 2) Goals and Non-Goals

### Goals

1. One selection/highlight pipeline for student text highlighting.
2. Cross-block selection support within a single highlight surface.
3. Explicit exclusion of answer controls (`input`, `textarea`, `select`, `contenteditable`, answer-control wrappers).
4. Deterministic toolbar behavior that does not depend on fragile live selection timing.
5. Persistence and hydration tied to canonical surface text hash.

### Non-Goals

1. Cross-surface highlights (for example from passage surface into question surface) are out of scope.
2. Changing anti-cheat drop/paste integrity policy is out of scope.
3. Admin annotation stack is out of scope.

## 3) Owning Module Boundaries

All behavior is owned by `src/components/student`.

### Public composition boundary (UI shell)

- `useHighlightSurfaceV2.ts` (temporary host during migration)
- `HighlightSelectionToolbar.tsx`
- `FormattedText.tsx`

### New core boundaries

1. `selection-observer` (DOM event seam)
- Responsibility: observe browser selection changes and read the current selection/range snapshot.
- No policy decisions beyond safe read.

2. `surface-resolver` (surface ownership + exclusion policy)
- Responsibility: map endpoints to `surfaceId`, validate both endpoints are in same surface, reject excluded controls.
- Owns disallowed selectors and wrapper policies.

3. `range-normalizer` (offset canonicalization)
- Responsibility: convert validated DOM range into canonical `[start, end]` offsets against surface canonical text.
- Supports cross-block ranges.

4. `highlight-command-service` (application-level behavior)
- Responsibility: `createHighlight`, `eraseHighlight`, `clearSelection`, `hydrate`.
- Applies invariants and emits state transitions.

5. `highlight-store` (persistence and derived state)
- Responsibility: store ranges keyed by `namespace + surfaceId + sourceHash`; expose idempotent writes and read model.
- Can remain localStorage-backed initially.

6. `render-adapter` (DOM render model)
- Responsibility: take `baseHtml + ranges` and return marked HTML. No selection capture logic.

## 4) Invariants (Must Hold)

1. Fail-closed endpoints:
- If either endpoint is outside highlightable text surface, reject.

2. Same-surface boundary:
- Selection is valid only when both endpoints resolve to the same `surfaceId`.

3. Cross-block allowed inside same surface:
- Paragraph/list/table block boundaries are allowed when still within same surface.

4. Excluded answer controls:
- Any selection touching `input`, `textarea`, `select`, `[contenteditable]`, or answer-control wrappers is invalid.

5. Toolbar action stability:
- Apply/remove consumes latest valid captured selection even if browser emits transient collapsed selection during click/tap.

6. No nested highlight mark stacks:
- Reapplying/recoloring must flatten nested marks.

7. Persistence truth:
- Student-visible saved/verified highlight state must reflect persisted ranges for active `sourceHash`.

8. Hash reset:
- If canonical surface text changes, stored ranges are discarded for that surface.

## 5) Proposed End-to-End Flow

1. `SelectionObserver` emits raw selection event.
2. `SurfaceResolver` validates endpoints and exclusion policy.
3. `RangeNormalizer` converts to canonical offsets (`HighlightSelectionV3`).
4. `HighlightCommandService` updates in-memory state and persists via `HighlightStore`.
5. `RenderAdapter` derives HTML with mark tags from stored ranges.
6. `ToolbarCoordinator` reads command/store state to show/enable actions.

### Key behavior changes vs today

- Remove `enforceSingleBlock` policy gate.
- Keep same-surface enforcement.
- Keep sticky valid-selection window and pointer/mouse/touch default-prevent protections.

## 6) File-Level Migration Plan

### Phase A: Introduce V3 seams behind existing V2 hook

Add:

- `src/components/student/highlight/selectionObserver.ts`
- `src/components/student/highlight/surfaceResolver.ts`
- `src/components/student/highlight/rangeNormalizer.ts`
- `src/components/student/highlight/highlightCommandService.ts`
- `src/components/student/highlight/highlightStore.ts`
- `src/components/student/highlight/renderAdapter.ts`

Keep `useHighlightSurfaceV2.ts` as compatibility host that delegates to new services.

### Phase B: Enable cross-block within same-surface

- Remove single-block enforcement in capture path.
- Replace block-boundary rejection test expectations with valid cross-block assertions.
- Keep cross-surface rejection and excluded-control rejection.

### Phase C: Cut legacy path

Delete after parity:

- `src/components/student/highlightSelection.ts`
- `src/components/student/highlightPersistence.tsx`
- any imports still depending on legacy snapshot signatures / policy reasons

### Phase D: Flatten naming

- Rename `useHighlightSurfaceV2` to stable non-versioned API (`useHighlightSurface`) once legacy deletion is complete.

## 7) Delete List (Target)

Hard delete targets after migration parity:

1. `src/components/student/highlightSelection.ts`
2. `src/components/student/highlightPersistence.tsx`
3. Legacy-only tests in `src/components/student/__tests__/highlightSelection.test.ts` that assert legacy snapshot mechanics instead of current public behavior.

Potential follow-up delete/refactor targets:

1. any duplicate block-boundary helpers in old and new modules
2. versioned names (`V2`) after cutover stabilization

## 8) Test Matrix

### Unit tests

1. `surfaceResolver`
- rejects mixed-surface endpoints
- rejects excluded controls
- accepts valid same-surface endpoints

2. `rangeNormalizer`
- normalizes single-block and cross-block ranges
- returns null for collapsed/empty or invalid ranges
- handles element boundary range endpoints

3. `highlightCommandService`
- add/recolor/erase behavior
- no nested marks invariant
- idempotent apply when same command repeats

4. `highlightStore`
- persists by `namespace+surfaceId+sourceHash`
- drops ranges on hash mismatch

### Integration tests (student)

1. reading cross-paragraph selection applies highlight.
2. question display cross-block selection applies highlight.
3. cross-surface reading->question selection is rejected.
4. selection touching answer controls is rejected.
5. toolbar click/tap preserves valid captured selection and applies.
6. only one active toolbar/action scope across multiple surfaces at a time.
7. reload/remount restores highlights only when source hash matches.

### Regression carry-forward tests

Keep and update:

- `src/components/student/__tests__/highlightPersistence.test.tsx`
- `src/components/student/__tests__/highlightSelectionPort.test.tsx`
- `src/components/student/__tests__/highlightV2Engine.test.ts`
- `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- `src/components/student/__tests__/StudentQuestionExperience.test.tsx`

## 9) Risk and Rollout

1. Feature-flag cross-block enablement for staged release.
2. Add lightweight diagnostics for rejected selection reasons (`mixed_surface`, `excluded_target`, `invalid_range`) in dev/test mode.
3. Rollout in order:
- internal QA with reading+question mixed content cases
- pilot subset
- full rollout after no regressions in toolbar/apply behavior

## 10) Memory Artifacts Updated

This spec is the memory artifact for the planned architecture change:

- `docs/superpowers/specs/2026-05-13-student-highlight-surface-v3-design.md`

Before implementation starts, `docs/ux-invariants.md` must be updated to replace:

- "Cross-block selections must be rejected"

with:

- "Cross-block selections are allowed within the same highlight surface; cross-surface selections remain rejected."
