# SAT authoring UX and visual-system redesign

## Scope

Redesign only the SAT authoring surfaces under `src/features/exam-authoring` and the authoring-specific CSS in `src/index.css`. Existing API contracts, question revision data, autosave behavior, validation rules, student rendering, release semantics, and unrelated dirty work remain unchanged.

## Design

### Visual system

- Keep a single `au` token namespace for authoring: canvas, surface, raised surface, separators, fills, accent, status colors, type ramp, radii, elevation, and motion.
- Use three material layers: quiet canvas, opaque editor sheet, and translucent chrome/HUD. Avoid introducing new arbitrary colors or one-off elevation recipes.
- Preserve section meaning: Reading & Writing uses blue and Math uses indigo for selection/focus context; primary actions remain blue.
- Use semantic CSS classes for repeated authoring controls, fields, panels, and state surfaces. Existing student/IELTS styles are not changed.

### Interaction primitives

- Use the repository's existing Radix/shadcn wrappers (`DropdownMenu`, `Sheet`, `Dialog`/Radix primitives) instead of manual global Escape listeners, focus traps, or role-only overlays.
- Add an authoring-scoped dialog shell and confirmation dialog with explicit title/description semantics, safe focus behavior, scroll containment, and reduced-motion-compatible transitions.
- Migrate touched authoring menus, rich-editor dialogs, and confirmation surfaces to those primitives. Native `details` remains the progressive-disclosure primitive for low-risk secondary content.

### Workspace behavior

- Desktop: three flexible regions—question navigation, editor, and inspector—with persisted width preferences and keyboard/pointer resizers. The editor remains the flexible region and keeps a readable maximum measure.
- Narrow screens: the editor becomes the primary surface; question navigation and inspector open as Radix sheets. No horizontal page scroll is required to reach authoring controls.
- Keep preview as a live complementary surface on desktop and a full-screen surface on compact widths.
- All pane controls expose separator semantics (`aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and keyboard increments) and retain visible focus.

### State and feedback

- Preserve existing loading, recoverable error, save-status, validation, import, and undo states, but align their surfaces to the shared tokens and ensure status is not conveyed by color alone.
- Keep failed saves blocking navigation as they do now; expose retry from the status control and preserve draft recovery.
- Keep preview on the real `ExamQuestionRenderer` so authoring and student delivery cannot drift.

## Change chain

`AuthoringWorkspace` → pane state/resizers and responsive sheets → existing `QuestionListPane`/`QuestionEditor`/`QuestionInspectorPane` → existing autosave, validation, import, preview, and release APIs.

Overlay chain: authoring trigger → Radix primitive → focus/scroll/escape behavior → existing async callback → existing error/status state.

No backend, schema, persistence, or authorization changes are required.

## Verification

- Red/green component tests for resizer keyboard semantics and authoring dialog semantics.
- Existing SAT authoring test group after each migration step.
- Typecheck, full production build, and relevant lint/test commands before completion.
- Manual/browser verification remains required for pointer resizing, compact viewport sheets, reduced motion, and visual balance because jsdom cannot prove rendered geometry.
