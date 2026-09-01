# SAT authoring three-pane workspace redesign

## Status

Approved design. This document defines a visual and interaction redesign for the Digital SAT question-authoring workspace. It does not change the exam content model or delivery behavior.

## Problem

The current SAT authoring surface exposes too many controls and competing panels at once. Question navigation, editing, metadata, answer configuration, and validation have similar visual weight. As a result, authors lose the active question, scan inefficiently, and have to reconstruct the relationship between content and proof/QA state.

The redesign makes the active question the primary workspace while keeping navigation and authoring proof available as supporting context.

## Goals

- Establish a clear three-pane authoring hierarchy.
- Make the selected question unmistakable.
- Reduce visible control noise without removing capability.
- Keep answer-key and validation information close to the active question.
- Preserve existing question types, autosave, import, preview, and delivery contracts.
- Support desktop, tablet, keyboard, reduced motion, reduced transparency, and forced-colors users.

## Non-goals

- Replacing the SAT domain model.
- Rewriting question-type editors.
- Changing scoring, delivery, import, or autosave semantics.
- Introducing a new UI dependency.
- Redesigning student exam delivery.

## Visual thesis

A calm, paper-like editing surface sits inside a quiet utility shell: one blue accent establishes selection and primary action, while completion, warning, and error states use restrained semantic colors plus icons and labels.

Use the existing SAT product tokens, Tailwind v4 utilities, Radix primitives, and Lucide icons. Do not create a second design system.

## Information architecture

```text
SAT authoring workspace
├── top bar
│   ├── back to exam library
│   ├── exam and module context
│   ├── save status
│   └── preview / secondary actions
├── question navigation rail
│   ├── add question
│   ├── searchable question list
│   ├── question status and numbering
│   └── module/structure context
├── active question canvas
│   ├── question identity
│   ├── content editor
│   ├── answer choices or response editor
│   └── previous/next navigation
└── inspector rail
    ├── content metadata
    ├── answer key
    ├── validation checklist
    └── secondary actions
```

## Component responsibilities

### `AuthoringWorkspace`

Owns the three-pane layout, selected question identity, responsive pane behavior, and workspace-level save/preview actions. It should not own question-type-specific editing logic.

### `QuestionListPane`

Provides navigation, question numbering, reorder behavior, add-question entry point, and status summaries. The active row receives the strongest selection treatment. Destructive and infrequent actions belong in a contextual menu.

### `QuestionEditorPane`

Renders only the selected question in the main canvas. Existing question-type editors and rich editors remain the implementation for the actual content controls.

### `QuestionInspectorPane`

Provides progressive disclosure for metadata, answer configuration, and validation. It stays visible on wide screens and becomes a responsive sheet or collapsible panel below the desktop breakpoint.

### Existing primitives

Reuse the existing SAT segmented controls, menus, dialogs, motion utilities, rich editor, import sheets, preview, and save-status components. New UI should compose these primitives instead of hand-rolling equivalent controls.

## State model

```ts
type AuthoringViewState = {
  selectedQuestionId: string | null;
  inspectorOpen: boolean;
  activeInspectorSection: 'content' | 'answers' | 'validation';
  saveState: 'saved' | 'saving' | 'error';
};
```

The view state is UI state only. Question content remains in the existing authoring state and persistence flow.

### Selection behavior

- Selecting a question updates the center canvas and inspector together.
- The selected row has an accent hairline/ring and a clear non-color indicator.
- Keyboard navigation moves selection without destroying unsaved content.
- Previous/next controls preserve the selected question context.
- If the selected question is removed, select the nearest surviving question.

### Responsive behavior

- Wide desktop: question rail, canvas, and inspector are visible.
- Medium width: question rail remains visible; inspector can collapse.
- Small width: question list and inspector become sheets/drawers; the editor remains the primary surface.
- Pane preferences may be remembered, but the active question must never become inaccessible.

## Visual hierarchy

1. Active question content and editing controls.
2. Question identity and navigation context.
3. Answer key and validation state.
4. Global navigation and secondary actions.

The editor canvas should use a white sheet against a warm gray SAT canvas. Avoid a grid of equal cards. Use spacing, typography, hairlines, and contextual elevation to separate regions.

### Color

- Blue: selection, focus, primary actions.
- Green: valid/complete state.
- Amber: attention required but not blocking.
- Red: blocking error or destructive action.
- Neutral gray: structure and secondary information.

Color must never be the only state carrier.

### Typography

- Strong, compact question title and number.
- Medium-weight labels for inspector sections.
- Secondary metadata at a smaller size with sufficient contrast.
- Comfortable editor line length and readable body leading.
- Sentence case for labels and headings.

## Interaction design

### Primary actions

`Add question` is the dominant creation action. Preview and save status remain visible in the top bar. The main editor should not compete with multiple filled buttons.

### Secondary actions

Save to bank, duplicate, delete, import, and other infrequent actions move into contextual menus or the inspector. Destructive actions require the existing confirmation primitive.

### Validation

Validation is persistent and local to the active question. Each item includes an icon and text, for example:

- `Ready — prompt and answer key complete`
- `Needs attention — answer key missing`
- `Blocked — option text is empty`

Errors appear inline near the relevant editor field and in the inspector summary. Avoid browser alerts for authoring feedback.

### Motion

Use the existing authoring motion tokens. Selection changes may use a short opacity/background transition; pane/sheet transitions use transform and opacity. Respect reduced-motion and reduced-transparency preferences. Motion must communicate state, not decorate the workspace.

## Accessibility requirements

- Use semantic landmarks for top bar, navigation rail, main editor, and inspector.
- Maintain visible `:focus-visible` rings.
- Provide accessible names for pane toggles and contextual actions.
- Preserve keyboard access to question navigation, editors, menus, and validation items.
- Use `aria-current` for the active question.
- Use live or polite status messaging for save state when needed.
- Keep touch targets at least the existing SAT minimum on coarse pointers.
- Support forced-colors and high-contrast preferences.
- Do not depend on color alone for selection, completion, warnings, or errors.

## Implementation constraints

- Work within the existing React, TypeScript, Tailwind v4, Radix, and SAT token system.
- Do not install a new library.
- Preserve public props and behavior of existing question-type editor components where possible.
- Keep edits focused on SAT authoring UI files and related tests.
- Before changing exported interfaces, map definitions and call sites with AST tooling.
- Parse and typecheck every modified TypeScript file after edits.

## Acceptance criteria

- Desktop shows a stable three-pane authoring workspace.
- Only the selected question is the primary editor content.
- The active question is visually dominant and clearly announced to assistive technology.
- Add question is the clear primary creation action.
- Metadata, answer key, and validation are available in the inspector without competing with the editor.
- Existing question types continue to edit and persist correctly.
- Responsive layouts keep all authoring capabilities reachable.
- Keyboard focus, reduced motion, forced colors, and touch targets remain supported.
- Existing authoring tests pass, and new tests cover selection, pane behavior, inspector sections, and validation visibility.
