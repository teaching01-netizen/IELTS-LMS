# Full Skill Pack Bundle

---

<!-- FILE: INDEX.md -->

# ChatGPT / Apple-Quality React Frontend Skill Pack

## Goal

Build a production React frontend with the **clarity, restraint, adaptability, interaction quality, and craft** associated with mature products such as ChatGPT and Apple software, without cloning their proprietary branding or interface pixel-for-pixel.

The desired feeling is:

- content-first rather than chrome-first;
- quiet, confident visual hierarchy;
- a small number of strong primitives;
- generous but disciplined spacing;
- readable typography;
- subtle depth and material separation;
- obvious interaction states;
- fast perceived response;
- excellent keyboard, pointer, and touch behavior;
- layouts that survive iPad, phone, desktop, zoom, localization, and long content;
- micro-interactions that communicate state instead of showing off.

## Mental Model

Treat the frontend as a layered system:

```text
product intent
    ↓
information architecture
    ↓
interaction model
    ↓
design primitives
    ↓
semantic tokens
    ↓
React primitives
    ↓
composite components
    ↓
feature surfaces
    ↓
responsive + accessibility + motion
    ↓
testing + visual review
```

A high-end interface is not created by adding blur, shadows, gradients, or animation. It comes from reducing ambiguity, making every state deliberate, preserving context, and keeping hundreds of small decisions consistent.

## Skill Map

| Skill | Owns | Depends on |
|---|---|---|
| `foundations/design-philosophy.md` | Quality bar and visual/interaction principles | — |
| `foundations/design-tokens.md` | Primitive and semantic token architecture | design philosophy |
| `foundations/color-materials.md` | Surfaces, contrast, borders, depth | tokens |
| `foundations/typography-readability.md` | Type hierarchy and reading comfort | tokens |
| `foundations/spacing-layout.md` | Spacing rhythm, grids, density | tokens |
| `foundations/iconography.md` | Icon semantics and sizing | tokens |
| `foundations/motion-system.md` | Motion tokens and choreography | tokens |
| `engineering/react-component-architecture.md` | Component boundaries and layers | foundations |
| `engineering/component-api-design.md` | Stable public component APIs | component architecture |
| `engineering/state-rendering.md` | UI state machines and async rendering | architecture |
| `engineering/css-architecture.md` | CSS layers, scoping, responsive styling | tokens |
| `engineering/frontend-performance.md` | Runtime and perceived performance | architecture |
| `components/actions-buttons.md` | Button/action family | tokens, component API |
| `components/forms-inputs.md` | Inputs, fields, validation | tokens, accessibility |
| `components/navigation-sidebar.md` | Sidebar/navigation shells | IA, responsive |
| `components/toolbars-controls.md` | Toolbars and action groups | actions, responsive |
| `components/overlays-modality.md` | Popovers, dialogs, sheets | focus, motion |
| `components/content-surfaces.md` | Cards, panels, grouped content | materials, spacing |
| `components/composer-input.md` | Chat-style rich composer / command entry | forms, state |
| `components/feedback-status.md` | Toasts, inline status, progress | state |
| `experience/information-architecture.md` | Hierarchy and progressive disclosure | design philosophy |
| `experience/interaction-model.md` | Selection, actions, feedback, reversibility | IA |
| `experience/keyboard-focus.md` | Keyboard model and focus continuity | accessibility |
| `experience/touch-pointer.md` | Pointer/hover/drag/touch ergonomics | interaction |
| `experience/responsive-adaptive.md` | Desktop/tablet/mobile/window adaptation | layout |
| `experience/loading-empty-error.md` | Non-happy-path experience | state |
| `experience/accessibility.md` | WCAG-minded interaction and semantics | all UI |
| `quality/testing.md` | Behavior, a11y, integration tests | all |
| `quality/visual-regression.md` | Screenshot/state matrix verification | all UI |
| `quality/design-review.md` | HIG-style craft audit | all |
| `quality/implementation-workflow.md` | How an AI/dev team applies the pack | all |

## Recommended Implementation Order

1. Define product hierarchy with `information-architecture`.
2. Establish `design-philosophy`, tokens, typography, color/materials, spacing, icons, motion.
3. Set React architecture, component API rules, CSS architecture, and state modeling.
4. Build primitives before feature-specific components.
5. Build navigation and major content surfaces.
6. Add responsive adaptation, keyboard/focus, touch/pointer, and accessibility.
7. Implement non-happy states and perceived-performance behavior.
8. Add behavior tests and visual-regression coverage.
9. Run `design-review` before calling the frontend polished.

## Shared Principles

- **Do not clone branding.** Borrow transferable interaction principles; use your own identity, palette, font licensing, icons, and copy.
- **Restraint is a feature.** If a visual effect is not helping hierarchy, affordance, state, or continuity, remove it.
- **One dominant action per region.** Secondary and tertiary controls should visually recede.
- **Content gets the contrast.** Chrome should be quieter than the content it supports.
- **State must be visible.** Hover, press, focus, selected, disabled, loading, dirty, error, success, and destructive states must be intentional.
- **Adaptive does not mean scaled down.** Recompose layouts at constrained widths.
- **Preserve context.** Avoid unnecessary page changes and modals for simple tasks.
- **Respect user input.** Never lose typed text, scroll position, selection, or focus without a strong reason.
- **Fast feedback first.** Give immediate local feedback, then reconcile with network results.
- **Craft lives at the edges.** Overflow, long labels, IME composition, virtual keyboards, safe areas, reduced motion, zoom, and interruption reveal the real quality of the system.

## Visual Direction

The default visual language should be:

```text
neutral surfaces
+ semantic contrast
+ restrained accent
+ low-noise borders
+ shallow elevation
+ moderate radii
+ compact but breathable controls
+ readable type
+ smooth state transitions
```

Avoid the common “AI app” failure mode of excessive gradients, glass blur, glowing borders, giant radii, and animation on every state change.

## Definition of Done

A surface is production-ready when:

- the primary task is obvious within a few seconds;
- spacing and type hierarchy are consistent;
- every interactive element has visible hover/focus/pressed/disabled behavior where applicable;
- keyboard-only use is coherent;
- touch targets remain usable on tablet/phone;
- resizing does not create clipped or unreachable UI;
- long and localized content does not destroy layout;
- async operations preserve context and input;
- loading/error/empty states are designed;
- reduced motion works;
- automated tests cover critical interaction contracts;
- screenshot review includes narrow, medium, and wide states;
- the UI looks intentional without relying on ornamental effects.

## External Reference Principle

Current Apple guidance emphasizes adaptable hierarchy, familiar controls, progressive disclosure, safe-area awareness, and readable content. OpenAI brand guidance emphasizes restrained, human-centered visual language and careful use of proprietary brand assets. Use those ideas as quality references, not as permission to copy protected assets.

---

<!-- FILE: components/actions-buttons.md -->

# Skill: Actions and Buttons

## Purpose

Own button hierarchy, semantics, destructive actions, icon actions, loading states, and action grouping.

## Use This Skill When

- Implementing primary/secondary/ghost/destructive actions.
- A page has too many visually equal buttons.
- Icon buttons are unclear.
- Loading buttons shift or double-submit.

## Goals

- Make the next action obvious.
- Preserve native button semantics.
- Prevent accidental destructive actions.
- Keep state changes stable and accessible.

## Mental Model

Buttons express **action priority**, not visual decoration. A region should rarely contain multiple equally dominant actions.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Use `<button>` for actions and `<a>` for navigation.
- Do not disable actions merely to hide validation explanations.

## Architecture

Provide a small variant family: primary, secondary, ghost, danger; plus icon-button as a separate ergonomic primitive. Size variants change padding/height, not semantic importance.

## Best Practices

- Use one primary action per local decision region.
- Keep destructive styling proportional to risk; not every delete needs a modal, but consequences must be clear.
- Loading state must preserve button width and prevent unintended duplicate activation.
- Pressed state should be visible without large motion.
- Disabled state must remain readable and explainable when necessary.
- Icon-only buttons require stable accessible names.

## Implementation Patterns

- Support leading/trailing icons through explicit slots.
- Use a progress indicator only when the action lasts long enough to need it; otherwise a subtle pending state is enough.

## Decision Rules

- If clicking navigates → link.
- If clicking changes current state → button.
- If action is reversible and low-risk → prefer undo over confirmation.
- If destructive and difficult to recover → add confirmation or stronger friction.

## States and Edge Cases

- Hover.
- Focus-visible.
- Pressed.
- Disabled.
- aria-disabled.
- Loading.
- Success acknowledgement.
- Long label.
- Icon-only.
- Touch.

## Anti-Patterns

- Clickable `<div>`.
- Two primary buttons beside each other.
- Button text changing so much that layout jumps.
- Disabling a button with no reason.
- Tiny icon buttons.

## Performance

- Avoid mounting expensive spinners for sub-200ms operations.
- Keep hover/press CSS-only where possible.

## Accessibility

- Visible focus ring.
- Accessible name.
- Native keyboard activation.
- Do not trap focus after action unless a modal opens.

## Testing

- Keyboard activation.
- Double-click/loading.
- Disabled semantics.
- Long localization.
- Visual snapshots for all states.

## Production Checklist

- Semantics correct.
- Priority clear.
- Loading width stable.
- Destructive path reviewed.
- Focus visible.
- Targets usable.

## Review Heuristics

- Which action wins visually?
- Can a user predict consequence from the label?
- Does loading preserve context and prevent duplicates?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: components/composer-input.md -->

# Skill: Composer / Rich Command Input

## Purpose

Own a ChatGPT-like input composer pattern: multiline input, attachments/actions, send/cancel state, paste, keyboard shortcuts, and narrow-screen adaptation.

## Use This Skill When

- Building chat, AI prompt, exam authoring, note, comment, or command entry.
- Users paste images/math/rich text.
- The composer grows, overflows, or behaves poorly on iPad/mobile.

## Goals

- Make typing the dominant interaction.
- Preserve user drafts.
- Keep secondary tools available but quiet.
- Handle paste and async send robustly.

## Mental Model

The composer is a workbench, not a decorated textbox. The text cursor and content are primary; actions orbit around them without stealing space.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Typing latency must be near-zero.
- Drafts are user data and should survive recoverable failures.

## Architecture

Anatomy:

```text
┌─────────────────────────────────────┐
│ multiline editable content          │
│                                     │
│ [attach/tools]      [status] [send] │
└─────────────────────────────────────┘
```

Allow growth to a sensible max height, then scroll internally. Keep send/action controls anchored and reachable.

## Best Practices

- Use a real `<textarea>` or editor with equivalent semantics.
- Enter-to-send is product-specific; if used, Shift+Enter should insert a newline and IME composition must never accidentally submit.
- Preserve draft on network failure.
- If paste conversion is offered, parse after composition/paste and provide undo or preview for lossy conversion.
- Keep attachments visible with clear remove/retry state.
- During streaming/generation, the primary action may become Stop only when stopping is a real supported action.
- On mobile, account for virtual keyboard and safe-area inset without hiding send controls.

## Implementation Patterns

- Store draft separately from request lifecycle.
- Use resize via content measurement capped by CSS max-height.
- Separate attachment upload state from message submit state.

## Decision Rules

- If pasted content can be transformed losslessly → transform automatically.
- If interpretation is ambiguous (e.g. math/LaTeX conversion) → preserve source and allow correction/undo.
- If sending fails → keep text and attachments in place.
- If the editor is empty → disable or repurpose send only if the reason is obvious.

## States and Edge Cases

- Empty.
- Focused.
- Multiline.
- Max height.
- Pasting text/image.
- IME.
- Uploading.
- Upload failure.
- Sending.
- Streaming.
- Offline.
- Mobile keyboard.
- Narrow pane.

## Anti-Patterns

- Clearing draft before confirmed handoff.
- Submitting during IME composition.
- Toolbar consuming half the composer.
- Growing until it pushes the whole page offscreen.
- Hiding attachment errors in a toast.

## Performance

- Keep keystroke path light.
- Lazy-load heavy rich-text/math parsing.
- Debounce nonessential draft persistence.
- Avoid rerendering conversation history on each keystroke.

## Accessibility

- Accessible name for editor.
- Buttons labeled.
- Upload progress/status exposed.
- Logical tab order.
- Keyboard shortcuts documented and non-destructive.

## Testing

- IME composition.
- Paste/undo.
- Attachment retry.
- Offline send.
- Mobile keyboard resize.
- Long draft persistence.
- Enter/Shift+Enter behavior.

## Production Checklist

- Typing immediate.
- Draft safe.
- Max-height behavior stable.
- Paste reversible.
- Mobile keyboard tested.
- Send state clear.

## Review Heuristics

- What can make the user lose text?
- Does any secondary control steal focus unnecessarily?
- Can the composer be fully used on iPad with hardware keyboard and touch?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: components/content-surfaces.md -->

# Skill: Content Surfaces, Panels, and Cards

## Purpose

Own grouping containers, cards, panels, inspectors, reading surfaces, selected rows, and surface density.

## Use This Skill When

- Designing dashboards, settings, results, passages, conversation content, or side inspectors.
- Everything is becoming a rounded card.

## Goals

- Express grouping with the minimum container chrome.
- Keep reading surfaces calm.
- Make interactive cards distinguishable from static groups.

## Mental Model

A surface is justified when it adds a meaningful boundary: interaction, grouping, scrolling, elevation, or background context.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Whitespace is often a better separator than another card.
- Clickable cards require obvious affordance and correct semantics.

## Architecture

Provide a few surface primitives: `Section`, `Panel`, `Card`, `ReadingFrame`, `InsetGroup`. Each has a specific purpose, not just a different radius/shadow.

## Best Practices

- Use flat sections for ordinary page grouping.
- Use panels when a region has independent scrolling, controls, or background.
- Use cards for repeated peer objects or clearly clickable summaries.
- Constrain long-form reading width inside wide panels.
- Use separators inside dense lists instead of individually boxed rows when appropriate.
- Avoid nested rounded corners unless layers truly nest.

## Implementation Patterns

- Surface variant maps to semantic elevation/grouping roles.
- Use container queries so inner content adapts to panel width.

## Decision Rules

- If removing the border/background keeps grouping clear → remove it.
- If the whole surface is clickable → use link/button semantics or a single clear interactive target, not nested competing clicks.
- If content is long-form → prioritize measure and padding over decorative framing.

## States and Edge Cases

- Selected.
- Hover.
- Focused descendant.
- Long content.
- Narrow panel.
- Independent scroll.
- Empty.
- Dark mode.

## Anti-Patterns

- Card soup.
- Nested shadows.
- Clickable div cards with nested buttons.
- Fixed heights clipping variable text.
- Excessive padding reducing information density.

## Performance

- Avoid huge shadow/blur regions.
- Use containment only after testing effects on sticky/positioned descendants.

## Accessibility

- Interactive surfaces require correct semantics and focus indication.
- Reading surfaces maintain contrast and zoom behavior.

## Testing

- Nested interactive content tests.
- Narrow container snapshots.
- Long content overflow.
- Selected/focus visual combinations.

## Production Checklist

- Every surface has a purpose.
- No card soup.
- Reading width controlled.
- Interactive semantics valid.
- Overflow explicit.

## Review Heuristics

- What boundary is this rectangle communicating?
- Would spacing alone be clearer?
- Does this panel still work at half its current width?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: components/feedback-status.md -->

# Skill: Feedback, Status, Toasts, Progress, and Undo

## Purpose

Own how the UI acknowledges actions, communicates background work, errors, completion, and reversible changes.

## Use This Skill When

- Adding save confirmations, sync state, uploads, background jobs, destructive undo, or errors.
- The app uses toasts for everything.

## Goals

- Place feedback near the action when possible.
- Avoid notification fatigue.
- Make long-running state understandable.
- Prefer recovery over blame.

## Mental Model

Feedback should answer: did my action register, what is happening now, did it work, and what can I do if it did not?

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Local feedback beats global toast for local problems.
- Success should often be quiet.

## Architecture

Use inline state for field/component feedback, persistent status for ongoing document/system state, toast for transient cross-context confirmation, and dialog only for blocking decisions.

## Best Practices

- Acknowledge clicks immediately through pressed/pending state.
- Use toast for low-risk, transient, nonessential messages.
- Use inline error when the user must act in a specific place.
- Use undo for reversible destructive actions instead of repeated confirmation.
- Progress indicators should be determinate when real progress is known.
- Do not show and hide success so quickly that users cannot perceive it.

## Implementation Patterns

- Central toast queue with deduplication.
- Inline async status component with `aria-live` used sparingly.
- Undo action retains enough state for restoration.

## Decision Rules

- If the user must fix something → inline.
- If completion is expected and visually evident → no toast needed.
- If destructive action is reversible → optimistic remove + undo.
- If operation exceeds a few seconds → show persistent progress/status.

## States and Edge Cases

- Multiple simultaneous jobs.
- Offline.
- Retry.
- Undo expiration.
- Background success after navigation.
- Screen-reader announcement queue.

## Anti-Patterns

- Toast for validation errors.
- Success toast after every autosave.
- Infinite spinner with no context.
- Error message with no recovery action.
- Announcements on every tiny background state change.

## Performance

- Deduplicate repeated notifications.
- Avoid mounting complex toast trees for frequent autosaves.

## Accessibility

- Use polite live regions for important asynchronous state.
- Do not steal focus for non-blocking notifications.
- Provide text, not color alone.

## Testing

- Announcement behavior.
- Toast queue/dedupe.
- Undo timing.
- Offline retry.
- Long-running progress.

## Production Checklist

- Feedback locality correct.
- No toast spam.
- Recovery actions present.
- Announcements restrained.
- Undo reliable.

## Review Heuristics

- Could the user see the result without a notification?
- If an error appears, is the next action obvious?
- Are we announcing too much to assistive technology?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: components/forms-inputs.md -->

# Skill: Forms and Inputs

## Purpose

Own text fields, text areas, selects, validation, labels, help text, error placement, autosave, and form submission behavior.

## Use This Skill When

- Building settings, authoring tools, authentication, filters, or data-entry flows.
- Users paste rich/math text.
- Validation feels noisy or fields lose work.

## Goals

- Make entry fast and forgiving.
- Preserve pasted/user-authored content.
- Associate errors with the right control.
- Handle keyboard and mobile input correctly.

## Mental Model

A form is a conversation: label → input → feedback → correction → completion. Minimize ambiguity and protect user effort.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Persistent labels beat placeholder-only labeling.
- Validation timing should help rather than punish.

## Architecture

Build `Field` composition around native inputs: label, control, description, error, optional trailing/leading affordance. Complex editors are separate components but follow the same feedback contract.

## Best Practices

- Use explicit labels and examples for format-sensitive fields.
- Validate on submit and after a field becomes meaningfully dirty; avoid aggressive red errors on first keystroke.
- Preserve selection/caret during formatting transformations.
- Respect IME composition; do not parse/transform mid-composition.
- For paste normalization, keep an undo path and avoid silent destructive conversion.
- Show autosave state quietly near the relevant document rather than with global toasts for every keystroke.
- On mobile, use correct `inputmode`, autocomplete, and virtual-keyboard-safe layout.

## Implementation Patterns

- Use schema validation for data shape and domain validation for business rules.
- Use `aria-describedby` to connect help/error content.
- Use inline validation for specific field problems and summary only for complex multi-field submit failures.

## Decision Rules

- If formatting can be inferred safely and reversibly → auto-normalize.
- If conversion could change meaning → preview or ask rather than silently rewriting.
- If an error can only be known server-side → keep the user's input and show the server message at the field/form level.

## States and Edge Cases

- Empty.
- Focused.
- Filled.
- Invalid.
- Disabled.
- Readonly.
- Loading options.
- Server error.
- IME.
- Paste.
- Autofill.
- Mobile keyboard.
- Very long value.

## Anti-Patterns

- Placeholder as label.
- Clearing input after failed submit.
- Formatting on every keypress in a way that moves caret.
- Toast-only form errors.
- Disabling submit with no explanation.

## Performance

- Debounce expensive remote validation.
- Do not rerender the entire form on each keystroke when using heavy editors.
- Lazy-load rich editor code if not immediately needed.

## Accessibility

- Every field has an accessible name.
- Errors programmatically associated.
- Focus first invalid control on submit only when helpful.
- Do not use color alone for validation.

## Testing

- Keyboard submit.
- Screen-reader label/error.
- Autofill.
- IME.
- Paste/undo.
- Mobile viewport with keyboard.
- Server validation retry.

## Production Checklist

- Labels persistent.
- Input preserved on failure.
- IME safe.
- Paste path reversible.
- Error association correct.
- Mobile keyboard tested.

## Review Heuristics

- What happens to a user's half-finished work if the request fails?
- Can a keyboard-only user complete the form?
- Does automatic formatting preserve meaning and caret?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: components/navigation-sidebar.md -->

# Skill: Navigation and Sidebar

## Purpose

Own global/section navigation, sidebar width, selection state, collapse behavior, responsive transformation, and overflow.

## Use This Skill When

- Building an app shell similar in restraint to ChatGPT or modern Apple productivity apps.
- Sidebar feels cramped, hidden, or requires too many clicks.
- Desktop and iPad behavior diverge.

## Goals

- Keep current location obvious.
- Expose frequent destinations with low effort.
- Adapt side navigation to narrow windows without losing access.
- Avoid wasting horizontal space.

## Mental Model

Navigation is persistent orientation, not a decorative menu. It should answer: where am I, what can I go to, and what remains available when the window narrows?

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Selected state must be stronger than hover.
- Collapse should preserve task context.

## Architecture

Desktop:
```text
┌──────── sidebar ────────┬──────── content ─────────┐
│ primary nav             │                          │
│ module/section list     │                          │
│ utility/account         │                          │
└─────────────────────────┴──────────────────────────┘
```

Tablet/narrow: transform to overlay/sheet or compact rail based on actual available width and task frequency.

## Best Practices

- Give sidebar enough width for meaningful labels; do not force unnecessary truncation.
- Keep module/section switching one action away when it is a frequent workflow.
- Use subtle selected fill + text/icon emphasis; hover should not look selected.
- Preserve scroll position within long nav lists.
- Allow collapse only if it creates useful content space.
- When sidebar becomes overlay, restore focus to the opener on close.
- Use sticky bottom utilities sparingly and ensure content remains scrollable.

## Implementation Patterns

- Use a width token plus min/max constraints.
- For resizable sidebars, provide a visible/hoverable drag affordance and keyboard-accessible fallback if resizing is important.

## Decision Rules

- If navigation is used constantly → keep it persistently visible where space allows.
- If width is constrained but navigation is secondary → convert to temporary sheet.
- If labels are essential for comprehension → do not replace them with icons merely to save width.

## States and Edge Cases

- Collapsed.
- Overlay open.
- Long labels.
- Long navigation list.
- Selected + hovered.
- Keyboard focus.
- RTL.
- Split-screen iPad.
- Mobile safe area.

## Anti-Patterns

- Icon-only sidebar for unfamiliar destinations.
- Selected state that disappears on hover.
- Two-click module switching for a core workflow.
- Sidebar content hidden behind fixed footer.
- Tiny resize target.

## Performance

- Virtualize only extremely long navigation trees.
- Keep open/close transitions transform-based.
- Do not recalculate layout in JS on every drag frame if CSS variables can drive it.

## Accessibility

- Navigation landmarks.
- Correct `aria-current`.
- Focus restoration for overlays.
- Keyboard access to primary destinations.

## Testing

- Resize width extremes.
- Narrow overlay behavior.
- Long labels.
- Keyboard nav.
- RTL.
- Selected state snapshots.

## Production Checklist

- Current location obvious.
- Frequent destinations one action away.
- Narrow adaptation defined.
- Overflow safe.
- Focus restore correct.

## Review Heuristics

- Can a user tell location without reading every item?
- Does collapse actually help?
- What happens at 700–900px split-screen widths?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: components/overlays-modality.md -->

# Skill: Overlays, Popovers, Dialogs, and Sheets

## Purpose

Own temporary layers, modality, dismissal, focus management, placement, responsive transformation, and nested overlay rules.

## Use This Skill When

- Showing menus, confirmation, settings, contextual help, pickers, or focused tasks.
- The app overuses modals.
- Popover placement breaks near viewport edges.

## Goals

- Use the lightest layer that fits the task.
- Preserve context.
- Make dismissal predictable.
- Handle focus and small screens correctly.

## Mental Model

Modality has a cognitive cost. Use popovers for contextual lightweight choices, dialogs for decisions, and sheets for substantial narrow-screen tasks.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Every modal needs a clear exit.
- Do not stack modal layers casually.

## Architecture

Layer choice:

```text
tooltip  → brief explanation, no interaction
popover  → contextual choices / small controls
dialog   → explicit decision or focused short task
sheet    → larger temporary task, especially narrow screens
page     → deep, navigable, persistent work
```

## Best Practices

- Anchor popovers to the triggering control when spatial relationship matters.
- Flip/shift near viewport edges rather than clipping.
- On narrow screens, convert complex popovers into sheets.
- Trap focus only in truly modal dialogs/sheets.
- Restore focus to the opener on close when it still exists.
- Escape closes dismissible overlays; destructive confirmation should still have explicit buttons.
- Avoid modal dialogs for routine success/error feedback.

## Implementation Patterns

- Use a portal layer manager.
- Centralize z-index/elevation roles.
- Use `inert`/focus-management utilities for modal background when appropriate.

## Decision Rules

- If the user should continue interacting with the page → nonmodal popover.
- If outside interaction would corrupt the task → modal.
- If overlay content is large enough to require its own navigation → use page/sheet rather than oversized popover.

## States and Edge Cases

- Nested menu.
- Virtual keyboard.
- Viewport edge.
- RTL.
- Trigger unmounts.
- Escape.
- Backdrop click.
- Scroll lock.
- Reduced motion.

## Anti-Patterns

- Modal for every action.
- Popover wider than the viewport.
- Focus lost to body on close.
- Nested dialogs.
- Backdrop with no visible close path.

## Performance

- Mount heavy overlay contents lazily.
- Avoid continuous positioning work when closed.
- Use transform/opacity for transitions.

## Accessibility

- Focus trap for modal only.
- Correct dialog/menu semantics.
- Accessible title/name.
- Screen-reader background isolation.

## Testing

- Open/close focus tests.
- Escape/outside click.
- Viewport edge positioning.
- Mobile sheet adaptation.
- Nested menu keyboard behavior.

## Production Checklist

- Correct layer chosen.
- Focus lifecycle correct.
- Placement robust.
- Responsive form defined.
- No unnecessary nesting.

## Review Heuristics

- Could this be inline instead?
- Does the overlay interrupt a routine task?
- Where does focus go before, during, and after?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: components/toolbars-controls.md -->

# Skill: Toolbars and Compact Controls

## Purpose

Own action grouping, toolbar density, overflow, narrow-space behavior, labels, and control priority.

## Use This Skill When

- A feature has next/back, flag, zoom, highlight, settings, or utility controls.
- Toolbar breaks in narrow panes.
- Too many equal icons create clutter.

## Goals

- Keep frequent actions immediately available.
- Collapse secondary actions predictably.
- Maintain a stable control order.
- Support pointer and touch.

## Mental Model

A toolbar is an action hierarchy. It is not a storage shelf for every possible command.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Keep navigation controls spatially consistent.
- Do not hide a high-frequency action behind overflow only to make a screenshot cleaner.

## Architecture

Group by task: navigation, primary manipulation, secondary tools, status. Use separators/spacing only when groups need distinction.

## Best Practices

- Prioritize controls by frequency and consequence.
- At narrow widths, keep primary navigation/actions visible and move secondary actions to an overflow menu.
- Use labels where icons are ambiguous.
- Do not let controls overlap content when wrapping; deliberately choose wrap, collapse, or scroll.
- Maintain a minimum hit area even in compact visual density.
- Use roving tabindex only for true composite toolbar semantics; otherwise normal tab order may be clearer.

## Implementation Patterns

- `Toolbar` owns grouping/overflow; individual controls own semantics.
- Measure overflow only when CSS cannot represent the desired priority behavior.

## Decision Rules

- If a control is used nearly every task → keep visible.
- If a control is infrequent but important → overflow with a clear label.
- If next/back no longer fit beside status → separate spatial regions rather than shrinking them.

## States and Edge Cases

- Very narrow pane.
- Touch.
- Keyboard.
- Disabled next/back.
- Overflow open.
- Long localized labels.
- Zoomed text.

## Anti-Patterns

- Random icon order per screen.
- Shrinking controls until targets are tiny.
- Using icon-only for unclear concepts.
- Wrapping into two lines unintentionally.
- Overflow menu that hides the current state of a toggle.

## Performance

- Avoid expensive dynamic measurement on every frame.
- Use CSS priority/collapse where possible.

## Accessibility

- Visible focus.
- Accessible names.
- Stateful controls expose pressed/selected semantics.
- Logical keyboard order.

## Testing

- Resize through collapse threshold.
- Touch target test.
- Keyboard order.
- Stateful control screen-reader test.
- Localization stress.

## Production Checklist

- Primary controls stay visible.
- Overflow deterministic.
- Targets usable.
- Control order stable.
- No accidental wrap.

## Review Heuristics

- Which three actions matter most here?
- If the toolbar loses 30% width, what remains?
- Can a user understand every icon without trial and error?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: engineering/component-api-design.md -->

# Skill: Component API Design

## Purpose

Define predictable, type-safe component contracts that stay ergonomic as the product grows.

## Use This Skill When

- Designing new reusable components.
- A component has many flags, magic defaults, or awkward callbacks.
- Teams are forking components because the API cannot express valid needs.

## Goals

- Make common usage obvious.
- Prevent invalid combinations.
- Preserve native HTML capabilities.
- Keep future extension possible without speculative abstractions.

## Mental Model

The public props of a component are a product for developers. Optimize for valid states, clear ownership, and composability.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Prefer semantic variants over styling escape hatches.
- Forward native attributes when they remain valid for the underlying element.

## Architecture

Separate behavior props, semantic variant props, content slots, and low-level escape hatches. Escape hatches should be rare and clearly named.

## Best Practices

- Use discriminated unions when variants require different props.
- Name events after user intent (`onDismiss`, `onValueChange`) rather than implementation (`onIconClick`).
- Do not expose internal DOM structure through brittle selectors as part of the API.
- Make defaults match the safest and most common product behavior.
- Prefer `children`, named slots, or subcomponents for rich composition.
- Avoid accepting raw style values for properties governed by the design system.

## Implementation Patterns

- Use `asChild`/polymorphism sparingly; semantics must remain clear.
- Use controlled values for shared state and local default values only when self-contained behavior is intended.

## Decision Rules

- If props can create an invalid state → encode the restriction in types or split APIs.
- If callers regularly need `className` hacks for a valid use case → revisit the semantic API.
- If only one caller needs a peculiar variant → do not promote it globally until the need is understood.

## States and Edge Cases

- Undefined/null.
- Async callbacks.
- Ref forwarding.
- Nested interactive content.
- Disabled vs aria-disabled.
- Form submission semantics.

## Anti-Patterns

- `primary`, `blue`, `rounded`, `shadow` as unrelated flags.
- Callback names tied to DOM implementation.
- Components that swallow native events unexpectedly.
- Styling APIs that bypass tokens.

## Performance

- API convenience should not require expensive abstraction layers.
- Avoid render-prop patterns that rerender large trees on every local state tick.

## Accessibility

- Semantics must survive polymorphism.
- Disabled behavior must be correct for keyboard and assistive tech.
- Public APIs should make accessible labels straightforward.

## Testing

- Type tests for invalid combinations.
- DOM behavior tests for forwarded attributes.
- Contract tests for callbacks and disabled behavior.

## Production Checklist

- Defaults documented.
- Invalid combinations impossible or guarded.
- Native props preserved where safe.
- Events semantic.
- Escape hatches minimal.

## Review Heuristics

- Can a developer guess the happy-path API without docs?
- Are prop names about user intent?
- Does the API expose design decisions rather than CSS implementation?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: engineering/css-architecture.md -->

# Skill: CSS Architecture

## Purpose

Own styling boundaries, cascade strategy, responsive rules, tokens, state selectors, and long-term maintainability.

## Use This Skill When

- Creating or refactoring application styling.
- Specificity wars appear.
- Responsive behavior is duplicated.
- Feature CSS overrides design-system internals.

## Goals

- Predictable cascade.
- Low specificity.
- Component-local responsibility.
- Theme and responsive behavior without brittle overrides.

## Mental Model

CSS is part of the architecture. Use the cascade intentionally rather than fighting it with ever-more-specific selectors.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Semantic tokens cross boundaries; component internals should not.
- Prefer state attributes/classes over DOM-shape-dependent selectors.

## Architecture

Suggested layers:

```css
@layer reset, tokens, base, components, utilities, overrides;
```

Keep feature styling close to feature components, while global layers own only truly global concerns.

## Best Practices

- Use CSS custom properties for themeable semantic values.
- Prefer class selectors and low specificity.
- Use data attributes for finite component state (`data-state='open'`).
- Use container queries when a component adapts to its available width.
- Use logical properties for inline/block dimensions and spacing.
- Explicitly manage stacking contexts for overlays and sticky chrome.
- Treat overflow as a design decision; never rely on accidental clipping.

## Implementation Patterns

- CSS Modules, scoped CSS, or a consistent CSS-in-JS approach are acceptable when they preserve clear ownership.
- Create small layout utilities only for genuinely cross-cutting patterns.

## Decision Rules

- If styling depends on component container width → container query.
- If a selector reaches through multiple component internals → expose a semantic API instead.
- If `!important` seems necessary → first inspect cascade layer/specificity/ownership.

## States and Edge Cases

- Nested scrolling.
- Sticky headers.
- Portals.
- RTL.
- Forced colors.
- Print if relevant.
- Zoom.
- Long content.
- Safe-area inset.

## Anti-Patterns

- Global descendant selectors targeting component markup.
- Deep selector chains.
- Arbitrary z-index escalation.
- Hard-coded theme colors in feature files.
- JavaScript breakpoints for purely visual changes.

## Performance

- CSS should handle layout/responsiveness before JS.
- Avoid expensive selectors across giant DOM trees.
- Minimize large-area filter/backdrop effects.

## Accessibility

- Focus styles must not be reset globally.
- Use logical properties for RTL.
- Respect reduced motion and forced colors.

## Testing

- Visual regression across breakpoints.
- Stylelint rules for tokens/specificity.
- RTL and forced-color snapshots.
- Overflow stress tests.

## Production Checklist

- Cascade layers defined.
- Token consumption enforced.
- No accidental horizontal overflow.
- z-index scale controlled.
- Focus styles protected.

## Review Heuristics

- Can you predict which rule wins without opening devtools?
- Does a component need to know its page to style correctly?
- Would markup refactoring silently break selectors?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: engineering/frontend-performance.md -->

# Skill: Frontend Performance and Perceived Speed

## Purpose

Own runtime responsiveness, bundle discipline, rendering cost, input latency, loading sequencing, and perceived speed.

## Use This Skill When

- The app has heavy editors, long lists, charts, streaming output, or many routes.
- Interactions feel sluggish despite fast APIs.
- A polished redesign adds visual effects or bundle weight.

## Goals

- Keep input immediate.
- Render useful content early.
- Avoid unnecessary main-thread work.
- Make loading transitions stable rather than flashy.

## Mental Model

Users experience latency, not benchmarks. Optimize the path from intent → visible acknowledgement → usable completion.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Perceived speed starts with immediate local feedback.
- Measure before introducing complexity such as memoization or virtualization.

## Architecture

Budget performance by route and interaction. Separate initial-load cost, interaction cost, scroll cost, and background work.

## Best Practices

- Code-split large route-specific modules.
- Keep controlled text input paths light.
- Virtualize only genuinely long lists where DOM cost is material.
- Avoid rerendering whole page shells for local state.
- Reserve layout space for async content to reduce layout shift.
- Defer non-critical analytics/decoration.
- Use optimistic local acknowledgement for reversible actions.

## Implementation Patterns

- Profile React commits before adding memoization.
- Use web workers for CPU-heavy transformations when justified.
- Use `content-visibility` or virtualization carefully for large static regions.

## Decision Rules

- If user input lags → fix synchronous work before network optimization.
- If a dependency is large and used on one route → lazy-load it.
- If virtualization breaks accessibility or find-in-page for modest lists → prefer normal DOM.

## States and Edge Cases

- Low-end mobile.
- Background/resume.
- Slow font load.
- Huge pasted content.
- Long conversations.
- Multiple open panels.
- Streaming data.

## Anti-Patterns

- Animating expensive filters.
- Memoizing everything.
- Virtualizing short lists.
- Blocking initial render on non-critical data.
- Loading spinners that replace stable content.

## Performance

- Track INP-like interaction latency, layout shift, route load, and long tasks.
- Keep bundle budgets visible in CI when practical.

## Accessibility

- Performance optimization must not destroy semantic order or keyboard navigation.
- Skeletons need meaningful accessible status, not noisy repeated announcements.

## Testing

- Performance profile on realistic content.
- Input latency smoke test.
- Bundle diff on major PRs.
- Low-end throttling check.
- Scroll profiling.

## Production Checklist

- Critical interaction fast.
- No avoidable layout shift.
- Heavy routes split.
- No expensive decorative scroll effects.
- Performance measured with real content.

## Review Heuristics

- What is the slowest user-perceived interaction?
- Are we optimizing measured cost or aesthetic suspicion?
- Does the loading state preserve context?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: engineering/react-component-architecture.md -->

# Skill: React Component Architecture

## Purpose

Own component boundaries, layering, composition, state ownership, and separation between reusable UI and product features.

## Use This Skill When

- Creating a component library.
- Refactoring duplicated feature UI.
- A component has too many props or knows too much product state.
- Design-system primitives and feature code are entangled.

## Goals

- Keep primitives reusable without becoming generic abstractions.
- Keep feature behavior close to domain state.
- Make accessibility behavior consistent.
- Enable independent testing and replacement.

## Mental Model

A React component should have a clear **reason to change**. Split by responsibility and interaction boundary, not by arbitrary line count.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Composition beats configuration explosion.
- Reusable UI owns interaction mechanics; features own domain meaning.

## Architecture

Use layers:

```text
ui/primitives       Button, TextField, IconButton, Surface
ui/composites       Dialog, Toolbar, FormField, SidebarItem
features/<domain>   domain-specific composition + state
pages/routes         data boundary + page composition
```

Data fetching and domain decisions should not leak into low-level primitives.

## Best Practices

- Use native HTML elements as the base whenever possible.
- Keep controlled/uncontrolled behavior explicit; do not accidentally support both.
- Co-locate small local state with the component that owns the interaction.
- Lift state only when multiple peers need the same source of truth.
- Prefer children/slots for structural composition over dozens of visual flags.
- Expose refs only when focus/measurement/interoperability truly requires them.
- Avoid component wrappers that add no semantic, behavioral, or styling responsibility.

## Implementation Patterns

- Compound components for coordinated structures.
- Render props only for behavior that cannot be expressed cleanly with composition.
- Context for stable subtree-wide state, not rapidly changing global app data.

## Decision Rules

- If behavior must stay identical across many features → put it in reusable UI.
- If meaning is domain-specific → keep it in the feature layer.
- If a component has many booleans that create impossible combinations → model variants or split components.
- If two things only look similar today but behave differently → do not prematurely unify them.

## States and Edge Cases

- Suspense/loading.
- Server/client boundary.
- Portal content.
- Error boundaries.
- Unmount/remount preserving draft state.
- Strict Mode.
- IME composition.

## Anti-Patterns

- God components.
- Prop drilling through unrelated layers instead of better ownership.
- Global state for local hover/open state.
- Design-system components importing feature modules.
- Boolean prop explosion.

## Performance

- Avoid rerendering large subtrees for cursor/hover state.
- Memoize only after measuring or when identity stability is part of an API contract.
- Keep expensive editors/visualizations isolated.

## Accessibility

- Primitives preserve native semantics.
- Focus and ARIA behavior belong to the component that owns the interaction.
- Do not require feature teams to reconstruct keyboard mechanics.

## Testing

- Unit-test interaction contracts.
- Integration-test composed feature behavior.
- A11y-test primitives once, then critical compositions again.
- Test remount/persistence for draft-heavy components.

## Reference Implementation

```tsx
type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={cx("Button", `Button--${variant}`, `Button--${size}`, className)}
    />
  );
}
```

## Production Checklist

- Layer boundaries enforced.
- No feature imports in primitives.
- State ownership documented.
- Interaction behavior testable.
- No impossible prop combinations.

## Review Heuristics

- What specific responsibility would make this component change?
- Could this primitive be used in another feature without importing domain knowledge?
- Would splitting reduce coupling or only create indirection?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: engineering/state-rendering.md -->

# Skill: UI State Modeling and Rendering

## Purpose

Own explicit modeling of local, async, optimistic, transient, and failure states so screens do not become contradictory.

## Use This Skill When

- Building async forms, streaming content, uploads, autosave, navigation, or multi-step interactions.
- Many booleans control rendering.
- Race conditions or stale status appear.

## Goals

- Make impossible states impossible.
- Preserve user work.
- Give immediate feedback.
- Reconcile network truth without flicker.

## Mental Model

UI is a state machine whether you model it or not. Name states and transitions explicitly before adding conditionals.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Transient UI state and server data are different concerns.
- Optimistic feedback must have a rollback/recovery path.

## Architecture

Prefer state shapes such as:

```ts
type SaveState =
  | { status: "idle" }
  | { status: "saving"; requestId: string }
  | { status: "saved"; at: number }
  | { status: "error"; error: Error; retryable: boolean };
```

Avoid `isLoading + isError + isSaved + isDirty` combinations that can contradict each other.

## Best Practices

- Separate server cache from ephemeral UI state.
- Use request identity/cancellation to prevent stale results from overwriting newer intent.
- Preserve input drafts through recoverable errors.
- Use optimistic UI for reversible low-risk actions; be more conservative for irreversible or financial actions.
- Keep streaming states distinct from loading and complete.
- Represent empty as valid data when appropriate, not automatically as error.

## Implementation Patterns

- Reducer/state machine for multi-step interactions.
- Query library for server cache lifecycle.
- Local state for open/hover/focus/draft where ownership is local.

## Decision Rules

- If states can conflict → replace booleans with a union/state machine.
- If a user action is cheap and reversible → consider optimistic update.
- If failure has serious consequence → confirm server success before presenting completion.
- If a new request supersedes an old one → cancel or ignore stale completion.

## States and Edge Cases

- Offline.
- Slow network.
- Double-submit.
- Navigation during save.
- Retry.
- Partial streaming.
- Server validation.
- Conflict with newer data.

## Anti-Patterns

- Multiple unrelated loading spinners.
- Clearing form data on failure.
- Letting stale responses overwrite current input.
- Treating empty as broken.
- Disabling the whole page for a local request.

## Performance

- Keep high-frequency ephemeral state local.
- Batch updates naturally; avoid global stores for cursor/hover.
- Stream without rerendering unrelated page regions.

## Accessibility

- Announce meaningful async status without overwhelming screen readers.
- Maintain focus on errors; do not teleport focus for background completion.
- Errors must be associated with the relevant control.

## Testing

- Race-condition tests.
- Retry and offline tests.
- Rapid duplicate action tests.
- Navigation/remount draft preservation tests.
- Screen-reader status tests for long operations.

## Production Checklist

- State model explicit.
- Stale requests handled.
- Drafts protected.
- Optimistic rollback defined.
- Empty/error/loading distinct.

## Review Heuristics

- Can any combination of flags describe nonsense?
- What happens if the same action fires twice?
- What work can the user lose if the network fails now?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: experience/accessibility.md -->

# Skill: Accessibility

## Purpose

Own semantic HTML, keyboard access, focus, contrast, zoom/reflow, labels, announcements, reduced motion, and inclusive interaction.

## Use This Skill When

- Building any user-facing surface.
- Creating custom controls.
- Adding drag, editors, dialogs, charts, or rich status.

## Goals

- Use native semantics first.
- Keep core workflows operable without a mouse.
- Support zoom and assistive technology.
- Make accessibility part of component correctness.

## Mental Model

Accessible implementation is usually simpler when semantics are chosen before styling. Start with the native element whose behavior already matches the task.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- ARIA supplements semantics; it does not replace correct HTML.
- A visually minimal interface must not become semantically minimal.

## Architecture

Accessibility responsibilities live at the lowest layer that owns the interaction. Primitives provide semantics; composites provide keyboard/focus patterns; features provide meaningful names/instructions.

## Best Practices

- Use `<button>` for actions and `<a>` for navigation.
- Use form labels and descriptions programmatically connected to controls.
- Maintain visible focus and logical DOM order.
- Ensure zoom/reflow without clipping critical content.
- Use live regions sparingly for async changes users need to know.
- Respect reduced motion and forced colors.
- Provide non-drag alternatives for important operations.
- Test with real screen-reader/keyboard workflows, not only automated scanners.

## Implementation Patterns

- Native controls first.
- Headless accessible primitives for complex widgets when mature and well-tested.
- Central focus-ring token and shared visually-hidden utility.

## Decision Rules

- If native element matches behavior → use it.
- If custom widget is needed → implement the complete expected keyboard/focus semantics.
- If status change is visually obvious but not programmatically exposed → add a restrained live announcement.

## States and Edge Cases

- Zoom 200–400%.
- Screen reader.
- Keyboard only.
- Reduced motion.
- Forced colors.
- RTL.
- Large text.
- Touch with assistive features.

## Anti-Patterns

- Clickable divs.
- Outline none.
- ARIA role without keyboard behavior.
- Placeholder-only labels.
- Color-only errors.
- Auto-focus that steals user context.

## Performance

- Accessible native controls are usually more performant than custom recreation.
- Avoid excessive live region churn during streaming.

## Accessibility

- Use automated a11y checks plus manual keyboard and screen-reader testing.
- Document known exceptions and rationale.

## Testing

- Automated axe-like scan.
- Keyboard walkthrough.
- Screen-reader smoke test.
- Zoom/reflow.
- Reduced motion.
- Forced colors.

## Production Checklist

- Semantic elements used.
- Names/labels correct.
- Focus visible.
- Keyboard complete.
- Zoom works.
- Announcements restrained.

## Review Heuristics

- What happens with CSS off?
- Can the task be completed without precise pointing?
- Does every custom behavior have equivalent semantics?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: experience/information-architecture.md -->

# Skill: Information Architecture and Progressive Disclosure

## Purpose

Own screen hierarchy, navigation depth, grouping, labels, task flow, and what is visible by default.

## Use This Skill When

- Redesigning a page with many controls.
- Users cannot find core settings.
- Important actions are buried behind multiple clicks.
- A screen feels crowded.

## Goals

- Match structure to user tasks.
- Keep frequent/important actions visible.
- Hide complexity, not capability.
- Use labels users already understand.

## Mental Model

Start from user decisions and frequency, not component inventory. Ask what the user needs to know or do *next*, then shape the page around that sequence.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Progressive disclosure should reduce clutter without adding unnecessary navigation.
- Frequent tasks deserve low interaction cost.

## Architecture

Model each surface as primary task, supporting information, secondary actions, advanced options. Use visual hierarchy and disclosure levels that match these roles.

## Best Practices

- Keep high-frequency controls directly visible.
- Group settings by user mental model, not backend schema.
- Use headings that name goals or concepts, not implementation jargon.
- Avoid putting core module/section switching behind nested menus.
- Reveal advanced controls near the context where they matter.
- Use search/command affordances only as accelerators, not as the only path to discoverability.

## Implementation Patterns

- Write a task-frequency matrix.
- Create an information hierarchy before pixel design.
- Use progressive sections, disclosure rows, and contextual panels.

## Decision Rules

- If an action is used every session → visible.
- If used occasionally and has low urgency → secondary placement/overflow.
- If advanced and risky → disclose contextually with explanation.
- If the user must remember a hidden setting's existence → hiding it may be wrong.

## States and Edge Cases

- First-time user.
- Expert user.
- Narrow screen.
- No data.
- Permission-restricted option.
- Very large module count.

## Anti-Patterns

- Organizing by database entities.
- Everything behind kebab menus.
- Repeated accordions that hide the whole interface.
- Two-click access for primary mode switching.
- Using icons instead of understandable labels.

## Performance

- Good IA reduces rendering complexity by avoiding simultaneous heavy regions.
- Do not eagerly render hidden complex panels.

## Accessibility

- Heading hierarchy semantic.
- Hidden content remains keyboard/screen-reader coherent when disclosed.
- Do not rely on hover-only discovery.

## Testing

- Task walkthroughs.
- First-click tests.
- Keyboard discovery.
- Narrow layout hierarchy review.
- Analytics validation when available.

## Production Checklist

- Primary task explicit.
- Frequent actions visible.
- Groups match mental model.
- Advanced controls disclosed sensibly.
- Labels plain.

## Review Heuristics

- Can a user predict where a setting lives?
- How many actions to reach the most common next step?
- What did we hide purely for aesthetics?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: experience/interaction-model.md -->

# Skill: Interaction Model

## Purpose

Own how selection, activation, navigation, editing, confirmation, undo, and system feedback work consistently across the product.

## Use This Skill When

- Defining new interactions.
- Different screens use different click/select/edit conventions.
- Users accidentally trigger actions.
- The UI looks polished but feels unpredictable.

## Goals

- Make behavior transferable from one surface to another.
- Reduce destructive mistakes.
- Preserve directness.
- Use reversible actions.

## Mental Model

Consistency is behavioral before it is visual. Similar-looking things should respond similarly; different consequences should look and behave differently.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Direct manipulation should have immediate feedback.
- Prefer undo/recovery over confirmation for reversible actions.

## Architecture

Define product-wide conventions for row selection, link navigation, inline edit, menus, destructive actions, drag, save, and back/forward behavior.

## Best Practices

- Separate selection from activation when both exist.
- Make hover indicate affordance, not merely decoration.
- Keep Back/Next behavior stable in multi-step flows.
- Use inline editing when context benefits from staying in place.
- Provide clear commit/cancel rules for edits.
- Do not make drag the only way to perform an important action.

## Implementation Patterns

- Use explicit selected state + keyboard equivalent.
- Use optimistic interaction for reversible changes with undo.
- Use command menus as accelerators for expert users.

## Decision Rules

- If an action is reversible → perform directly and offer undo.
- If irreversible/high-consequence → confirmation or friction.
- If users need to compare context while editing → inline/panel rather than full modal.
- If gesture is non-obvious → provide visible controls too.

## States and Edge Cases

- Double click.
- Touch where hover does not exist.
- Keyboard only.
- Interrupted edit.
- Network conflict.
- Selection across pagination/virtualization.

## Anti-Patterns

- Single-click sometimes selects and sometimes opens with no cue.
- Hover-only controls required for core tasks.
- Confirmation dialogs for trivial actions.
- Drag-only reorder with no alternative.

## Performance

- Keep local feedback CSS-driven and cheap.
- Avoid high-frequency global state for pointer movement.

## Accessibility

- Every pointer interaction needs keyboard/touch equivalent when applicable.
- Selected and focused states must remain distinguishable.

## Testing

- Cross-surface consistency tests.
- Keyboard/touch walkthrough.
- Undo path.
- Interrupted edit recovery.
- Double activation.

## Production Checklist

- Selection rules consistent.
- Activation consequence predictable.
- Recovery path defined.
- Gesture alternatives present.
- Feedback immediate.

## Review Heuristics

- Would behavior learned on one screen transfer here?
- Can users recover from mistakes?
- Does touch expose the same capability as hover?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: experience/keyboard-focus.md -->

# Skill: Keyboard, Focus, and Shortcut Continuity

## Purpose

Own tab order, focus-visible styling, focus restoration, roving focus, shortcuts, and keyboard continuity across dynamic UI.

## Use This Skill When

- Building dialogs, sidebars, toolbars, menus, editors, split views, or power-user workflows.
- Focus disappears after rerenders.
- Keyboard users need excessive tabbing.

## Goals

- Make every core action reachable.
- Keep focus location predictable.
- Use shortcuts without hijacking typing.
- Restore focus after temporary layers.

## Mental Model

Focus is the keyboard user's cursor. Losing it is equivalent to moving the mouse pointer somewhere random.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- DOM order should match logical reading/action order.
- Only implement roving focus for true composite widgets.

## Architecture

Define global tab sequence through semantic DOM order. Components own local arrow-key behavior only when their ARIA/native interaction model calls for it.

## Best Practices

- Use `:focus-visible` with a clearly visible ring.
- Do not remove outlines without a replacement.
- When a modal closes, return focus to its opener or next logical location.
- When deleting the focused item, move focus to a meaningful sibling/container.
- Shortcuts should not fire while users type unless explicitly designed for the editor.
- Display shortcuts in menus/tooltips where discoverability matters.

## Implementation Patterns

- Use refs for focus restoration, not routine visual state.
- Central shortcut registry only when many features need conflict resolution.

## Decision Rules

- If a widget follows a standard keyboard pattern → implement that pattern.
- If arrow navigation would surprise users → use normal Tab behavior.
- If a shortcut conflicts with browser/OS conventions → choose another.

## States and Edge Cases

- Item removed.
- Overlay closed.
- Route changes.
- Virtualized list.
- Disabled item.
- IME/editor focus.
- Mobile hardware keyboard.

## Anti-Patterns

- Programmatically focusing on every render.
- Positive `tabindex` ordering.
- Global single-letter shortcuts while typing.
- Focus ring hidden for aesthetic reasons.
- Focus landing behind a modal.

## Performance

- Avoid state updates on every key when native behavior suffices.
- Shortcut handling should be scoped and unsubscribed cleanly.

## Accessibility

- Meet expected keyboard patterns.
- Focus indicator visible with sufficient contrast.
- No keyboard traps outside intentional modal behavior.

## Testing

- Full keyboard walkthrough.
- Focus restoration tests.
- Delete-focused-item test.
- Shortcut conflict tests.
- Screen-reader + keyboard smoke test.

## Production Checklist

- Tab order logical.
- Focus visible.
- Overlay restoration correct.
- No accidental traps.
- Shortcuts scoped.

## Review Heuristics

- After every dynamic action, where is focus?
- Can a keyboard user complete the primary task with reasonable effort?
- Are shortcuts discoverable and safe?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: experience/loading-empty-error.md -->

# Skill: Loading, Empty, Error, Offline, and Partial States

## Purpose

Own all non-happy-path surfaces and the continuity between them.

## Use This Skill When

- Any feature fetches, streams, uploads, saves, or may contain no data.
- A product shows generic spinners or blank screens.
- Errors replace user context.

## Goals

- Keep layout stable.
- Tell users what they can do next.
- Distinguish no-data from failure.
- Preserve previously useful content when refreshing.

## Mental Model

Non-happy states are normal product states, not exceptions. Design them with the same hierarchy as success.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Do not replace useful stale content with a spinner during background refresh.
- Errors should offer recovery when possible.

## Architecture

Each data region defines initial loading, refreshing, empty-valid, partial, error-recoverable, error-blocking, and offline behavior.

## Best Practices

- Use skeletons only when they approximate stable final geometry.
- Prefer inline progress for local operations.
- Keep last-known content visible during background refresh unless stale content is unsafe.
- Empty state copy should explain what belongs here and offer the next useful action.
- Error messages should be specific enough to choose a response without exposing internals.
- Partial success should render what is available and identify what failed.

## Implementation Patterns

- State boundary per meaningful region.
- Retry control near the failure.
- Offline indicator persistent but nonblocking when cached work remains possible.

## Decision Rules

- If content is already available → refresh in place.
- If first load has known structure → skeleton may help.
- If duration is tiny/unknown and layout is simple → avoid flashing spinner.
- If empty is expected → treat it as content, not error.

## States and Edge Cases

- First load.
- Background refresh.
- Offline.
- Partial data.
- Permission denied.
- Timeout.
- Rate limit.
- Retry succeeds.
- Long-running stream.

## Anti-Patterns

- Full-page spinner for local request.
- Blank empty state.
- Generic 'Something went wrong' with no recovery.
- Skeletons that do not match final layout.
- Clearing useful data during refresh.

## Performance

- Avoid expensive skeleton animation across large pages.
- Do not start many duplicate requests from remount churn.

## Accessibility

- Loading/status announcements restrained.
- Retry buttons named.
- Errors not conveyed by color only.
- Skeletons ignored by assistive tech when decorative.

## Testing

- Slow network.
- Offline.
- Retry.
- Partial response.
- Cached/stale content.
- Screen-reader announcement.

## Production Checklist

- Every region defines non-happy states.
- Retry available when meaningful.
- Useful content preserved.
- Empty actionable.
- No spinner flicker.

## Review Heuristics

- What does the user see if the network disappears mid-task?
- Can they keep working?
- Does the failure state preserve enough context to recover?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: experience/responsive-adaptive.md -->

# Skill: Responsive and Adaptive Layout

## Purpose

Own behavior across phone, tablet, desktop, split-screen, resizable windows, orientation changes, zoom, and container widths.

## Use This Skill When

- Building interfaces that must work on iPhone, iPad, Android, desktop, or browser split view.
- Desktop scaling is being used as the mobile strategy.

## Goals

- Recompose rather than shrink.
- Preserve primary actions.
- Respect safe areas and virtual keyboards.
- Keep reading and navigation coherent at every width.

## Mental Model

Responsive design is not a set of devices. It is a set of layout capability thresholds driven by content and interaction needs.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Container width often matters more than viewport width.
- Do not remove capability just because space is constrained.

## Architecture

Think in modes:

```text
wide: persistent navigation + full toolbar + multi-pane
medium: narrower nav / selective collapse / optional split
compact: temporary nav + stacked content + bottom/inline actions
```

Choose transitions based on when the actual content stops working.

## Best Practices

- Use container queries for panels/components embedded in variable shells.
- At compact widths, stack or transform rather than squeeze.
- Keep next/back/submit reachable even when secondary tools move to overflow.
- Handle iPad split-screen widths as first-class states.
- Use safe-area insets for edge controls.
- Account for virtual keyboard reducing visual viewport height.
- Test orientation and dynamic browser UI on mobile.

## Implementation Patterns

- CSS-first adaptive layout.
- Use JS only for behavior that genuinely changes, not just style.
- Compose different surface arrangements from the same semantic components.

## Decision Rules

- If a row no longer fits with usable targets → wrap, collapse secondary controls, or recompose.
- If a reading column becomes too wide → cap measure.
- If a sidebar consumes too much of the content area → transform to overlay/rail.
- If a two-pane workflow remains essential on tablet → keep split view until each pane reaches its minimum usable width.

## States and Edge Cases

- 320px width.
- Foldables.
- Landscape phone.
- iPad split view.
- Desktop narrow window.
- 200% zoom.
- Virtual keyboard.
- Safe-area notch/home indicator.

## Anti-Patterns

- Desktop UI scaled down.
- Breakpoint names tied to specific devices.
- Hiding core controls on mobile.
- Fixed viewport heights that break with browser chrome.
- Horizontal scrolling entire app.

## Performance

- Avoid JS resize loops.
- Use CSS grid/flex/container queries.
- Lazy-mount secondary panes on compact layouts only if state is preserved.

## Accessibility

- Reflow must preserve logical order.
- Zoom should remain usable.
- Touch targets remain usable.
- Orientation changes should not lose focus/input.

## Testing

- Continuous resize.
- Device emulation + real tablet/phone when possible.
- Zoom.
- Keyboard open.
- RTL.
- Large text.

## Production Checklist

- Wide/medium/compact behavior defined.
- No core capability lost.
- Safe areas handled.
- Keyboard handled.
- No accidental app-wide horizontal scroll.

## Review Heuristics

- At what width does the *task* break, not the screenshot?
- What becomes overlay vs persistent?
- Can users still reach the primary action with the keyboard open?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: experience/touch-pointer.md -->

# Skill: Touch, Pointer, Hover, Drag, and Resize

## Purpose

Own pointer and touch ergonomics, hover treatment, drag handles, resize affordances, capture, and gesture alternatives.

## Use This Skill When

- Building resizable split panes, draggable items, hover actions, sliders, or tablet layouts.
- A resize divider is hard to discover or click.
- Hover-only interactions break on iPad.

## Goals

- Make targets easy to acquire.
- Separate visual thinness from hit-area size.
- Provide direct manipulation without making it mandatory.
- Avoid accidental drags.

## Mental Model

The visible control and the interactive target do not need the same size. A 1px divider can have a generous invisible hit zone and clear hover/active feedback.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Touch has no hover.
- Drag must have a fallback for important operations.

## Architecture

Pointer interactions use generous hitboxes, cursor changes, pressed/dragging state, pointer capture, and bounded values. Touch variants use larger targets and avoid edge conflicts.

## Best Practices

- For resize dividers, use a wide invisible hit target around a narrow visual separator.
- Show affordance on hover/focus/drag: cursor, handle, highlight, or subtle expansion.
- Use pointer capture during drag so the handle does not lose movement when the pointer leaves it.
- Set min/max panel sizes based on usable content, not arbitrary percentages.
- Provide reset/default-size behavior for complex resizable layouts.
- Avoid hover-revealed-only core actions; keep them discoverable on touch.

## Implementation Patterns

- Use pointer events to unify mouse/pen/touch when appropriate.
- Store split size in CSS variable/local state and persist only when useful.

## Decision Rules

- If a target looks visually thin → enlarge hit area invisibly.
- If drag is required for a critical task → add buttons/keyboard equivalent.
- If touch scrolling and horizontal dragging conflict → require deliberate handle contact and proper `touch-action`.

## States and Edge Cases

- Pointer leaves window.
- Touch scroll conflict.
- Pen input.
- Min/max reached.
- Narrow screen transform.
- Keyboard focus on handle.
- RTL split direction.

## Anti-Patterns

- 1px clickable divider.
- Hover as the only signal.
- Dragging without pointer capture.
- No min/max constraints.
- Resize cursor with no actual interaction feedback.

## Performance

- Update position with requestAnimationFrame/CSS vars if drag is heavy.
- Do not persist storage on every pointermove.

## Accessibility

- Resizable separators can use separator semantics and keyboard increments where important.
- Touch targets should be comfortably large.
- Do not rely on pointer precision.

## Testing

- Mouse, trackpad, touch, pen.
- Fast drag.
- Window leave.
- Keyboard resize.
- RTL.
- Min/max constraints.

## Production Checklist

- Hit target generous.
- Drag feedback obvious.
- Pointer capture used.
- Fallback exists.
- Constraints sensible.

## Review Heuristics

- Can a user discover the divider without instructions?
- Can it be grabbed quickly?
- What happens on iPad with touch and hardware keyboard?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: foundations/color-materials.md -->

# Skill: Color, Surfaces, Materials, and Depth

## Purpose

Define how color, borders, translucency, elevation, and surface separation communicate structure without visual noise.

## Use This Skill When

- Designing page backgrounds, panels, sidebars, cards, overlays, selected rows, or dark mode.
- A UI feels too flat or too 'boxy'.
- Teams are adding shadows or glass inconsistently.

## Goals

- Create clear layering with minimal decoration.
- Preserve text contrast.
- Make selection/action/status colors semantically stable.
- Avoid trendy glass effects that reduce readability.

## Mental Model

Depth is information. A surface should become visually distinct because it occupies a different interaction layer, not because every container needs decoration.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Borders separate peers; shadows indicate overlap/elevation; background shifts indicate grouping.
- Translucency is optional and must preserve legibility.

## Architecture

Use a shallow hierarchy:

```text
canvas
└─ grouped region
   └─ raised/interactive surface
      └─ overlay / modal
```

Most screens should need only two or three surface levels.

## Best Practices

- Use near-neutral surfaces for large areas and reserve saturated color for meaning.
- Prefer subtle background difference or spacing before drawing a border around everything.
- Keep border contrast low but detectable; use stronger borders for focused/selected/invalid states.
- Use shadow only when an element overlaps content or needs separation from scrolling content.
- In dark mode, avoid pure black/white extremes for large surfaces unless the product intentionally demands them.
- Translucent materials must fall back to opaque surfaces when contrast is uncertain.

## Implementation Patterns

- Define `canvas`, `subtle`, `raised`, `overlay` surfaces.
- Define text hierarchy separately from surface hierarchy.
- Use selected-state background plus text/icon change; do not rely on color hue alone.

## Decision Rules

- If two regions are adjacent peers → use spacing or border.
- If one region floats above another → elevation may be appropriate.
- If transparency makes text/background unpredictable → use opaque material.
- If accent appears in more than a few unrelated regions → reduce it.

## States and Edge Cases

- Dark mode.
- High contrast.
- Wallpaper/image behind app.
- Sticky headers over scrolling content.
- Nested panels.
- Selected + focused + hovered simultaneously.

## Anti-Patterns

- Heavy drop shadows on every card.
- Transparent text on variable backgrounds.
- Selection indicated only by faint gray.
- Using brand color for every icon.
- Nested translucent panes creating muddy contrast.

## Performance

- Large blur filters are expensive; minimize area and animation.
- Avoid animating box-shadow blur radius during scrolling.
- Prefer opacity/transform for temporary overlay transitions.

## Accessibility

- Verify semantic contrast combinations.
- Focus outline must remain visible over every surface.
- Do not use color as the only error/success cue.

## Testing

- Contrast checks in light/dark.
- Screenshot selected/hover/focus combinations.
- Forced-colors smoke test.
- Scroll sticky surfaces over varied content.

## Production Checklist

- Surface levels limited and named.
- Accent use restrained.
- Overlay contrast stable.
- No unnecessary blur.
- Focus visible on all surfaces.

## Review Heuristics

- Can a user explain the layering without seeing a shadow?
- Are boxes being used instead of spacing?
- Does dark mode preserve hierarchy rather than simply invert colors?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: foundations/design-philosophy.md -->

# Skill: Design Philosophy — Quiet, Content-First Product UI

## Purpose

Own the product-wide design judgment that makes the interface feel calm, precise, premium, and obvious rather than merely styled.

## Use This Skill When

- Starting a redesign or new surface.
- Resolving visual disagreement between teams.
- Deciding whether a flourish improves or distracts.
- Reviewing whether a page feels 'premium' without knowing what to change.

## Goals

- Reduce cognitive load.
- Keep the product identity distinct while reaching an Apple/ChatGPT-level quality bar.
- Make controls discoverable without making chrome dominate.
- Create consistent rhythm across features.

## Mental Model

Think in terms of **signal-to-noise**. Every pixel either clarifies hierarchy, exposes an action, communicates state, protects readability, or consumes attention. Premium design usually comes from removing weak signals and strengthening the few that remain.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Use depth only to express layering or interactivity.
- Prefer a neutral base and let product content carry personality.

## Architecture

Use three conceptual layers:

```text
Content layer      → the thing the user came for
Interaction layer  → controls that manipulate or navigate content
Environment layer  → shell, background, navigation, persistent chrome
```

The content layer should normally have the strongest readable contrast. Persistent chrome should be visually quieter. Temporary interaction layers may elevate above both.

## Best Practices

- Limit simultaneous emphasis. On a normal screen, one region should feel primary, a few secondary, and the rest quiet.
- Use whitespace to group and separate before adding boxes, dividers, or background fills.
- Avoid visual novelty for standard tasks. Familiarity reduces learning cost.
- Use accent color sparingly for primary action, selection, focus, or meaningful status.
- Treat text density as a product decision. Large headings do not automatically create hierarchy.
- Make interactive states feel physically coherent: hover anticipates, press compresses or darkens, release resolves.
- Prefer persistent context over frequent modal interruption.

## Implementation Patterns

- Build pages from a restrained set of primitives rather than unique one-off cards.
- Use one shell/background system, one content surface system, and one overlay system.
- Use semantic emphasis levels: primary, secondary, tertiary, disabled — for both text and controls.

## Decision Rules

- If an effect does not communicate hierarchy, affordance, state, or continuity → remove it.
- If two regions compete visually → reduce the less important region before increasing the important one.
- If a user must learn a custom behavior for a standard action → prefer the standard behavior.
- If a surface feels flat → first improve grouping, spacing, and contrast; add shadow/blur only if layering still needs clarification.

## States and Edge Cases

- Empty content.
- Very dense expert workflows.
- Long translated labels.
- High-contrast mode.
- Dark mode.
- Reduced motion.
- Narrow split views.
- Touch-only use.

## Anti-Patterns

- Using blur as a synonym for premium.
- Large radii on every rectangle.
- Multiple accent colors with equal weight.
- Card-in-card-in-card nesting.
- Decorative gradients behind dense content.
- Hiding common actions just to make the screen look clean.

## Performance

- Visual effects must not force expensive repaints during routine scrolling.
- Avoid backdrop-filter across large continuously scrolling regions.
- Prefer static visual hierarchy over runtime-heavy decoration.

## Accessibility

- Never trade contrast, focus visibility, target size, or text legibility for aesthetic minimalism.
- Minimal UI still needs explicit labels when icon meaning is not universal.

## Testing

- Review a screen in grayscale to test hierarchy.
- Test with 200% zoom and increased text size.
- Run keyboard-only and touch-only walkthroughs.
- Capture narrow/wide screenshots and compare emphasis order.

## Production Checklist

- Primary task is obvious.
- No unnecessary ornamental layer.
- Chrome is quieter than content.
- One clear primary action per region.
- Focus and selected states are unmistakable.
- Layout remains coherent under stress.

## Review Heuristics

- What is the first thing the eye sees, and is it correct?
- What can be removed with no loss of comprehension?
- Does every border/background/shadow explain structure?
- Can a new user predict what is clickable?
- Does the interface still feel good with animation disabled?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: foundations/design-tokens.md -->

# Skill: Design Tokens

## Purpose

Own the token architecture that converts visual decisions into stable, semantic, themeable frontend primitives.

## Use This Skill When

- Creating a design system.
- Replacing scattered hard-coded colors/spacing/radii.
- Supporting light/dark themes.
- Building components that should be reskinned without rewriting CSS.

## Goals

- Separate raw values from semantic usage.
- Keep component code free from arbitrary visual literals.
- Allow theme evolution without feature churn.
- Make design review traceable to named roles.

## Mental Model

A token is a **decision boundary**, not just a constant. Primitive tokens describe available values. Semantic tokens describe intent. Component tokens describe controlled exceptions.

## Core Principles

- Feature code consumes semantic tokens, not palette numbers.
- Keep the scale small enough to learn.
- Do not create a token for every one-off value.
- Name by role, not appearance.
- Aliases should flow one direction: primitive → semantic → component.

## Architecture

```text
primitive
  color.neutral.0
  color.neutral.1000
  space.1
  radius.md
      ↓
semantic
  surface.canvas
  surface.raised
  text.primary
  border.subtle
  action.primary
      ↓
component
  button.primary.bg
  sidebar.item.selected.bg
```

CSS custom properties should expose semantic tokens at the runtime theme boundary.

## Best Practices

- Use numeric scales for primitives and role names for consuming tokens.
- Keep typography tokens split into family, size, line-height, weight, and tracking when independent adjustment matters.
- Provide motion duration/easing tokens instead of literal transitions in component CSS.
- Represent focus ring, border width, overlay opacity, and elevation as tokens.
- Document which tokens are public design-system API and which are internal.
- Version breaking semantic changes just like code APIs.

## Implementation Patterns

- Expose semantic CSS variables on `:root` and theme scopes.
- Prefer component tokens only when a component cannot cleanly map to shared semantic roles.
- Use TypeScript token names or generated types when tokens are also consumed in JS.

## Decision Rules

- If a value describes *what it is used for* → semantic token.
- If it describes a reusable raw step → primitive token.
- If only one component needs a special case and the distinction is intentional → component token.
- If two raw values are visually close and not semantically distinct → consolidate.

## States and Edge Cases

- Light/dark.
- High contrast.
- Compact density.
- Touch density.
- Brand accent changes.
- Nested theme scopes.
- System forced colors.

## Anti-Patterns

- Components reading `--blue-500` directly.
- Tokens named after current appearance like `light-gray-text`.
- Twenty near-identical spacing steps.
- Duplicating semantic tokens per component without need.
- Changing token meaning silently.

## Performance

- CSS variables keep theme switching cheap.
- Avoid JS-driven theme recalculation for ordinary styling.
- Generate static token artifacts at build time when possible.

## Accessibility

- Semantic color tokens must preserve contrast across themes.
- Focus tokens cannot disappear in dark mode or forced-colors mode.
- Density tokens cannot shrink interactive targets below usable sizes.

## Testing

- Snapshot generated token output.
- Contrast-test semantic foreground/background pairs.
- Theme-switch component stories.
- Lint direct raw palette usage in feature CSS.

## Reference Implementation

```css
:root {
  --color-neutral-0: #fff;
  --color-neutral-1000: #0f0f10;

  --surface-canvas: var(--color-neutral-0);
  --surface-raised: color-mix(in srgb, var(--color-neutral-0) 96%, var(--color-neutral-1000));
  --text-primary: var(--color-neutral-1000);
  --text-secondary: color-mix(in srgb, var(--text-primary) 62%, transparent);
  --border-subtle: color-mix(in srgb, var(--text-primary) 12%, transparent);

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;

  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;

  --motion-fast: 120ms;
  --motion-standard: 180ms;
  --ease-out: cubic-bezier(.2,.8,.2,1);
}
```

## Production Checklist

- Primitive scale defined.
- Semantic roles defined.
- No direct feature literals for governed values.
- Dark theme parity.
- Focus and status colors reviewed.
- Token naming documented.

## Review Heuristics

- Can a designer explain a token by role without quoting its hex value?
- Can the accent color change without editing feature components?
- Are two tokens truly different decisions or accidental duplication?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: foundations/iconography.md -->

# Skill: Iconography

## Purpose

Own icon semantics, sizing, optical alignment, stroke consistency, labels, and interaction use.

## Use This Skill When

- Adding toolbars, navigation, compact actions, statuses, or empty-state illustrations.
- The app has mixed icon sets or ambiguous unlabeled controls.

## Goals

- Make icons immediately legible.
- Maintain one visual language.
- Avoid requiring users to memorize custom glyphs.
- Keep icon alignment visually balanced.

## Mental Model

Icons are compressed language. Use them where recognition is faster than reading; use text where meaning would otherwise be guessed.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Icon meaning must be stable across the product.
- Optical alignment can differ slightly from mathematical centering.

## Architecture

Use one primary icon family and a small controlled set of product-specific symbols. Wrap icons in a common `Icon` primitive that controls size, stroke/fill conventions, and accessibility defaults.

## Best Practices

- Use text labels for uncommon, destructive, or high-consequence actions.
- Standardize icon sizes by context, not per component whim.
- Keep icon buttons' hit targets larger than the visual glyph.
- Use selected variants consistently rather than mixing filled/outlined semantics arbitrarily.
- Mirror directional icons in RTL where meaning is spatial.

## Implementation Patterns

- `Icon` is decorative by default when adjacent visible text names the action.
- Icon-only buttons require an accessible name and often a tooltip for pointer users.

## Decision Rules

- If users may not recognize the icon without training → add text.
- If two actions have similar glyphs → prefer labels or stronger semantic separation.
- If the glyph is decorative → hide from assistive technology.

## States and Edge Cases

- RTL.
- High contrast.
- Tiny dense toolbar.
- Selected/active.
- Disabled.
- Loading replacement.
- Badge overlay.

## Anti-Patterns

- Mixing different stroke weights.
- Using emoji as production control icons.
- Tiny 14px hit targets.
- Relying on tooltip as the only accessible name.
- Using brand logos as generic UI icons.

## Performance

- Prefer SVG sprites/components over many raster assets.
- Avoid dynamically importing dozens of separate icon chunks for a single toolbar.

## Accessibility

- Accessible names belong to controls, not decorative glyphs.
- Status icons need text/screen-reader context if meaning is not otherwise present.

## Testing

- Icon-only button a11y tests.
- RTL snapshots.
- High-contrast visual checks.
- Compare optical alignment in real control sizes.

## Production Checklist

- One primary icon family.
- Stable semantics.
- Icon-only actions named.
- Targets sufficiently large.
- RTL behavior reviewed.

## Review Heuristics

- Would a first-time user understand each icon?
- Are similar icons used for different concepts?
- Does the icon look centered next to real text, not just in a bounding box?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: foundations/motion-system.md -->

# Skill: Motion System and Micro-Interaction Timing

## Purpose

Define when motion is allowed, which properties move, timing/easing tokens, interruption behavior, and reduced-motion fallbacks.

## Use This Skill When

- Adding hover/press feedback, panels, dialogs, menus, list changes, loading transitions, or drag interactions.
- The app feels abrupt or excessively animated.

## Goals

- Make state changes understandable.
- Preserve spatial continuity.
- Keep interaction immediate.
- Support reduced motion.

## Mental Model

Motion is a state-transition explanation. The user should understand **what changed and where it went**. If motion does not answer that, it is likely decoration.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Animations must be interruptible.
- Frequent actions use faster motion than rare, large transitions.

## Architecture

Define categories:

```text
micro feedback   80–140ms
control state    120–180ms
popover/menu     140–220ms
panel/sheet      180–280ms
large context    only when truly useful
```

Durations are ranges, not laws; perceived distance and frequency matter.

## Best Practices

- Animate opacity and transform when possible.
- Keep hover feedback nearly immediate.
- Use spring-like motion only where physical continuity helps, not as a default personality layer.
- Do not delay click handling until an exit animation completes unless required for safety.
- When content size changes, prefer stable layout or targeted expansion rather than animating the whole page.
- Reduced-motion mode should remove travel/scale and retain simple opacity/state feedback when safe.

## Implementation Patterns

- Use CSS transitions for local deterministic states.
- Use a dedicated motion library only for orchestration, shared-layout transitions, or gesture-driven animation.
- Cancel obsolete async animations when state changes again.

## Decision Rules

- If the user performs the action many times per minute → make motion faster or remove it.
- If the transition changes spatial context → use movement to preserve origin/destination.
- If animation makes a user wait → shorten or decouple it.
- If reduced motion is requested → avoid parallax, large-scale zoom, and long travel.

## States and Edge Cases

- Rapid repeated clicks.
- Interrupted navigation.
- Content streaming.
- Reduced motion.
- Low-power device.
- Background tab/resume.
- Virtualized lists.

## Anti-Patterns

- Animating everything.
- Long 400–800ms UI transitions.
- Bouncy motion on serious workflows.
- Animating height across large DOM trees.
- Hover motion that shifts layout.

## Performance

- Prefer compositor-friendly properties.
- Keep large blur/shadow animations rare.
- Avoid layout-triggering animation in scrolling areas.

## Accessibility

- Respect `prefers-reduced-motion`.
- Do not use motion as the only indicator of change.
- Avoid flashing/flicker patterns.

## Testing

- Reduced-motion snapshots.
- Rapid-interaction tests.
- Check interrupted open/close sequences.
- Profile scrolling while animated surfaces are present.

## Production Checklist

- Motion tokens defined.
- No interaction waits for decoration.
- Reduced-motion path complete.
- Frequent actions fast.
- No layout-jank animation.

## Review Heuristics

- Does motion explain a relationship?
- Can the user reverse action mid-animation?
- Would the interface still be clear with motion disabled?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: foundations/spacing-layout.md -->

# Skill: Spacing, Layout, and Density

## Purpose

Define spatial rhythm, alignment, grids, container behavior, density modes, and how layouts express relationships.

## Use This Skill When

- Building page shells, split views, forms, cards, settings screens, or responsive content.
- The UI feels inconsistent even though components look individually correct.

## Goals

- Create predictable rhythm.
- Use alignment to communicate hierarchy.
- Make density deliberate.
- Avoid fragile pixel layouts.

## Mental Model

Spacing is relational. The distance between two objects should say whether they belong together, are peers, or are separate groups.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Prefer a small spacing scale with intentional exceptions.
- Use container-aware layout before device-name breakpoints.

## Architecture

Compose layout from primitives:

```text
Stack      vertical rhythm
Inline     horizontal groups
Cluster    wrapping action groups
Grid       repeated structured content
Sidebar    navigation + content
Split      resizable peer panes
Frame      readable max-width content
```

Feature components should use these patterns instead of inventing local spacing systems.

## Best Practices

- Use tighter spacing within a group and larger spacing between groups.
- Align labels, headings, and content edges consistently across a surface.
- Prefer `gap` over child margins for component-owned spacing.
- Use logical properties so RTL adaptation is natural.
- Use `minmax()`, `clamp()`, flex wrapping, and container queries for resilient layout.
- Define compact/comfortable density only when the product truly needs both.
- Respect viewport safe-area insets for edge controls on mobile/tablet.

## Implementation Patterns

- Build `Stack`, `Inline`, and `Frame` layout primitives.
- Use grid for two-dimensional alignment; flex for one-dimensional flow.
- Use `min-width: 0` on flex/grid children that must shrink.

## Decision Rules

- If spacing is repeated in 3+ places with the same semantic relationship → tokenize or create a layout primitive.
- If a layout changes because its container narrows → use a container query.
- If content becomes unreadable before the page is technically 'mobile' → recompose at that content threshold.
- If horizontal actions no longer fit → wrap or collapse secondary actions; do not shrink targets.

## States and Edge Cases

- Split panes.
- Very long sidebars.
- Browser zoom.
- Soft keyboard.
- Safe areas.
- RTL.
- Small landscape phone.
- iPad multitasking widths.

## Anti-Patterns

- Magic-number absolute positioning for primary layout.
- Margins leaking out of components.
- Breakpoint logic based only on device names.
- Shrinking controls below usable sizes to preserve one row.
- Nested grids with inconsistent gutters.

## Performance

- Avoid layout thrash from JS measuring on every resize.
- Prefer CSS layout primitives and `ResizeObserver` only when actual measurement is required.

## Accessibility

- Reflow must preserve reading and focus order.
- Zoom should not force two-dimensional scrolling for ordinary pages.
- Touch target dimensions must not collapse in compact layout.

## Testing

- Resize continuously, not only at preset screenshots.
- Test zoom and text scaling.
- Test with longest localization.
- Test sidebar collapsed/expanded and split-pane extremes.

## Production Checklist

- Shared spacing scale.
- Alignment edges consistent.
- Responsive thresholds content-driven.
- Overflow behavior explicit.
- No unreachable controls at constrained widths.

## Review Heuristics

- Do related things look related before reading labels?
- Are there too many different gutter values?
- Does the layout gracefully pass through every width between desktop and tablet?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: foundations/typography-readability.md -->

# Skill: Typography and Readability

## Purpose

Own the type system, text measure, hierarchy, line rhythm, truncation behavior, and long-form reading quality.

## Use This Skill When

- A page contains passages, chat, documentation, forms, tables, or dense labels.
- Text feels tiring, cramped, or visually inconsistent.
- Responsive layouts cause wrapping or alignment bugs.

## Goals

- Make long reading comfortable.
- Keep UI labels quickly scannable.
- Support Thai, Latin, and other scripts without clipping.
- Avoid hierarchy that depends only on font size.

## Mental Model

Typography is layout. Font metrics, line height, measure, weight, wrapping, and alignment determine both readability and spatial rhythm.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Body text should be calmer than headings but never low-contrast.
- Use weight and spacing before extreme size jumps.

## Architecture

Separate text roles:

```text
display / page title
section heading
body / reading
UI label
metadata / secondary
caption / helper
code / data
```

Each role has a controlled size, line-height, weight, and intended context.

## Best Practices

- For reading surfaces, constrain line length rather than stretching text across wide panels.
- Use unitless or relative line-height where possible so zoom and font fallback behave well.
- Keep UI labels concise and avoid unnecessary all-caps.
- Use tabular numerals for aligned timers, metrics, and financial data when supported.
- Allow text to wrap before truncating unless the layout truly requires single-line identification.
- Test Thai combining marks and line-height; do not tune only against Latin screenshots.
- Use system/local fallback stacks unless custom-font licensing and performance are explicit product requirements.

## Implementation Patterns

- Use `max-inline-size` for reading columns.
- Use semantic type tokens instead of arbitrary `font-size`.
- Use `text-wrap: balance` selectively for short headings, not long body text.

## Decision Rules

- If content is meant to be read → prioritize measure and line-height.
- If content is meant to be scanned → prioritize concise labels and alignment.
- If truncation hides information needed to choose an item → wrap, expand, or provide detail access.
- If a narrow layout causes heading domination → step down display size at the component/container level.

## States and Edge Cases

- Long words/URLs.
- Thai and CJK.
- 200% zoom.
- User font scaling.
- Bold-text preference.
- Narrow panels.
- Dynamic values changing width.
- Code/math inline.

## Anti-Patterns

- Body text at low contrast.
- Very long lines on desktop.
- Fixed-height text containers.
- Truncating critical labels without a recovery path.
- Using a display font for dense UI.
- Tuning line-height so tightly diacritics clip.

## Performance

- Prefer local/system fonts for critical UI paths.
- Subset custom fonts carefully if used.
- Avoid loading many weights that are visually redundant.

## Accessibility

- Text must survive zoom and browser minimum-font settings.
- Do not encode hierarchy using color alone.
- Maintain readable focus/selection styling around editable text.

## Testing

- Snapshot at 320, 768, 1024, 1440px widths.
- Test Latin + Thai + long localization strings.
- Zoom to 200%.
- Test font loading failure.
- Check text selection and copy behavior.

## Production Checklist

- Reading measure constrained.
- Line height script-safe.
- Type roles tokenized.
- Critical labels never irrecoverably truncated.
- Numeric data alignment intentional.

## Review Heuristics

- Can users read for ten minutes without fatigue?
- Does the same hierarchy survive Thai text?
- Does narrowing the panel reflow naturally rather than clipping?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: quality/design-review.md -->

# Skill: Design Quality Review — Apple/ChatGPT-Level Craft Audit

## Purpose

Provide a repeatable expert review that finds hierarchy, interaction, readability, adaptive, and micro-craft issues before release.

## Use This Skill When

- A feature is functionally complete.
- The UI feels 'off' but bugs are not obvious.
- Before broad rollout or design-system migration.

## Goals

- Catch subtle friction.
- Separate taste issues from measurable usability issues.
- Ensure the system feels coherent across surfaces.

## Mental Model

Review from macro to micro. First verify task and hierarchy, then layout, then components, then state transitions, then pixel craft. Polishing the wrong hierarchy wastes time.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Review real content, not lorem ipsum.
- Review transitions between states, not only static screens.

## Architecture

Audit order:

```text
1. user goal / information hierarchy
2. navigation / task flow
3. layout / responsive behavior
4. typography / readability
5. action priority / affordance
6. states / feedback / errors
7. keyboard / touch / accessibility
8. motion / continuity
9. pixel-level alignment and optical polish
```

## Best Practices

- Inspect at normal distance before zooming into pixels.
- Use grayscale to test hierarchy.
- Temporarily remove shadows/radii to see whether structure still works.
- Resize continuously through tablet/narrow widths.
- Run keyboard-only and touch walkthroughs.
- Stress with long labels, empty/error/loading, and large text.
- Check scroll boundaries, sticky regions, overscroll, and focus restoration.

## Implementation Patterns

- Use severity levels: blocker, usability, consistency, polish.
- Record issue as observation → user impact → recommended principle, not subjective insult.

## Decision Rules

- If primary task is unclear → fix hierarchy before micro-polish.
- If visual density is high → reduce unnecessary containers before increasing spacing everywhere.
- If interaction is discoverability problem → improve affordance before adding tutorial copy.

## States and Edge Cases

- First use.
- Expert repeated use.
- Narrow iPad.
- Mobile keyboard.
- Long content.
- No data.
- Network failure.
- Reduced motion.

## Anti-Patterns

- Pixel critique before task critique.
- Calling preferences 'HIG' without explaining impact.
- Adding animation to compensate for unclear structure.
- Assuming desktop screenshot equals finished product.

## Performance

- Review performance while scrolling/typing; craft is lost if interactions lag.
- Check expensive effects in realistic content.

## Accessibility

- Keyboard, zoom, focus, target size, contrast, screen-reader labels are release criteria.
- Minimal aesthetic cannot override usability.

## Testing

- Manual task script.
- Screenshot matrix.
- Keyboard/touch run.
- Performance profile.
- Automated a11y baseline.

## Production Checklist

- Primary hierarchy correct.
- Responsive transitions intentional.
- Readability strong.
- State feedback complete.
- Micro-craft consistent.
- No accessibility regressions.

## Review Heuristics

- What is the most visually dominant element and should it be?
- What action is hardest to discover?
- Where does the interface feel fragile when resized?
- Which detail looks accidental rather than designed?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: quality/implementation-workflow.md -->

# Skill: Implementation Workflow for AI / Engineering Agents

## Purpose

Define how an implementation agent should apply the skill pack without overbuilding or turning the redesign into an uncontrolled rewrite.

## Use This Skill When

- Handing this pack to another AI agent.
- Planning a design-system migration.
- Implementing a redesign while preserving product behavior.

## Goals

- Make incremental, reviewable changes.
- Preserve intended behavior.
- Build reusable foundations before polishing one page.
- Avoid speculative abstractions.

## Mental Model

Treat the redesign as a controlled systems migration: audit → tokens/primitives → high-value surfaces → adaptive/accessibility → verification.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Do not rewrite working domain logic for visual reasons.
- Every abstraction must solve a present repeated problem.

## Architecture

Recommended phases:

```text
Phase 0  audit current UI + behavior contracts
Phase 1  tokens / type / spacing / surfaces
Phase 2  core primitives
Phase 3  shell + navigation
Phase 4  feature components
Phase 5  responsive + keyboard + touch + a11y
Phase 6  non-happy states + performance
Phase 7  regression tests + design review
```

Each phase should leave the application functional.

## Best Practices

- Inventory existing components before creating replacements.
- Create compatibility wrappers only when they reduce migration risk.
- Migrate one high-value surface end-to-end to validate tokens/primitives.
- Delete obsolete styles/components after migration rather than running two systems indefinitely.
- Preserve behavior tests before visual refactor.
- Measure bundle/runtime impact of new libraries.
- Document exceptions rather than silently bypassing system rules.

## Implementation Patterns

- Use codemods only for mechanical safe changes.
- Use feature flags for large visual migrations when rollout risk matters.
- Keep design token changes isolated from unrelated feature work.

## Decision Rules

- If existing component behavior is correct but styling is inconsistent → restyle/refactor rather than rewrite.
- If three or more components repeat the same interaction mechanics → extract shared primitive/composite.
- If abstraction is needed only for hypothetical future variants → wait.
- If migration changes domain behavior unintentionally → stop and restore behavior contract.

## States and Edge Cases

- Mixed old/new UI.
- Feature flags.
- SSR/hydration.
- Third-party widgets.
- Legacy CSS specificity.
- Partial migration.
- Rollback.

## Anti-Patterns

- Big-bang rewrite.
- Introducing a new UI library for one component.
- Global CSS reset changes without regression review.
- Leaving duplicate token systems permanently.
- Refactoring backend/domain logic in the same visual PR.

## Performance

- Track bundle diffs.
- Avoid adding overlapping styling/runtime libraries.
- Profile before/after on major surfaces.

## Accessibility

- Accessibility parity is required during migration, not after.
- Do not regress semantics while replacing components.

## Testing

- Baseline behavior tests before refactor.
- Incremental visual screenshots.
- A11y scan per migrated surface.
- Rollback path for high-risk release.

## Production Checklist

- Behavior preserved.
- Foundations reused.
- Duplicate legacy code removed.
- Responsive/a11y included in each phase.
- No speculative complexity.

## Review Heuristics

- Did this change improve the system or only this screenshot?
- Can we ship after this phase?
- What old code becomes unnecessary now?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: quality/testing.md -->

# Skill: Frontend Testing Strategy

## Purpose

Own the testing pyramid for components, interaction contracts, accessibility, async states, and feature workflows.

## Use This Skill When

- Defining CI coverage.
- Adding a new design-system component.
- Refactoring UI without changing behavior.
- Bugs repeatedly escape in edge states.

## Goals

- Test behavior rather than implementation.
- Cover state transitions and failure paths.
- Protect accessibility contracts.
- Keep tests fast enough to run routinely.

## Mental Model

The most valuable UI tests exercise what users can observe and do. Internal class names and component implementation are weak contracts.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Critical user flows deserve integration tests.
- Visual tests complement behavior tests; they do not replace them.

## Architecture

Use unit tests for pure logic, component tests for interactive contracts, integration tests for feature flows, and a small number of end-to-end tests for critical journeys.

## Best Practices

- Query elements by role/name rather than class selectors.
- Test keyboard interaction for complex widgets.
- Test loading/error/retry, not only success.
- Include long content and narrow viewport cases where behavior changes.
- Mock network at the boundary, not deep implementation internals.
- Keep visual regression state stories deterministic.

## Implementation Patterns

- Reusable test helpers for keyboard, viewport, and async states.
- Contract suite for every primitive family.

## Decision Rules

- If a bug is behavioral and user-visible → add a regression test at the lowest meaningful level.
- If a test breaks during harmless refactor → it is probably coupled to implementation.
- If behavior depends on real browser layout/focus → use browser component/E2E testing.

## States and Edge Cases

- Race conditions.
- Retry.
- Focus restoration.
- IME where testable.
- Responsive collapse.
- Optimistic rollback.
- Unmount/remount.

## Anti-Patterns

- Snapshotting huge DOM trees.
- Testing internal state directly.
- E2E for every tiny variant.
- Ignoring keyboard because click test passes.

## Performance

- Keep most tests below full E2E.
- Parallelize expensive browser tests.
- Avoid arbitrary sleeps.

## Accessibility

- Automated accessibility checks at component and critical-page level.
- Manual checks still required for semantics and usability.

## Testing

- Primitive contracts.
- Feature integration.
- Critical E2E.
- A11y automation.
- Responsive behavior.
- Failure paths.

## Production Checklist

- Critical flows covered.
- No arbitrary sleeps.
- Queries user-centric.
- Failure states tested.
- Keyboard covered.

## Review Heuristics

- Would this test still pass after internal refactor?
- Does it prove a user-visible contract?
- Which failure path is currently untested?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```

---

<!-- FILE: quality/visual-regression.md -->

# Skill: Visual Regression and State Matrix

## Purpose

Own screenshot-based verification across themes, states, content stress, and widths.

## Use This Skill When

- Maintaining a high-polish design system.
- Refactoring CSS/tokens.
- Preventing subtle spacing/focus/overflow regressions.

## Goals

- Detect unintended visual drift.
- Review all important states, not only happy desktop.
- Make design QA repeatable.

## Mental Model

A screenshot is useful only if the state is intentional and deterministic. Build a small state matrix that represents actual visual risk.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Capture interactions states deliberately.
- Do not approve noisy diffs blindly.

## Architecture

Each component/page gets representative stories across variant, state, theme, and width. Prioritize combinational risk rather than exhaustive Cartesian explosion.

## Best Practices

- Capture default, hover/focus where tooling allows, selected, disabled, loading, error, and long-content states where relevant.
- Capture light/dark and narrow/wide for major layout components.
- Freeze dates, random IDs, animations, and network timing.
- Include Thai/long-string fixtures for text-heavy surfaces.
- Review pixel diffs together with DOM/behavior tests.

## Implementation Patterns

- Golden stories in Storybook-like environment.
- Page-level screenshots for shell/layout interaction.
- PR diff artifacts grouped by component.

## Decision Rules

- If change is a token change → review representative components across all roles.
- If change touches layout primitives → broaden screenshot coverage.
- If diff is due to nondeterminism → fix determinism rather than raising thresholds.

## States and Edge Cases

- Font fallback.
- Scrollbar differences.
- Animation.
- Locale.
- Dark mode.
- Narrow viewport.
- High DPI differences.

## Anti-Patterns

- Huge screenshot suite with no ownership.
- Approving thousands of diffs after global CSS change without inspection.
- Only desktop screenshots.
- Ignoring focus states.

## Performance

- Keep suite representative.
- Parallelize capture.
- Avoid rendering every permutation unless risk justifies it.

## Accessibility

- Include visible focus and high-contrast checks beyond pixel snapshots.
- Visual regression cannot verify semantics.

## Testing

- Token-change broad review.
- Responsive widths.
- Long strings.
- Dark mode.
- Focus selected states.

## Production Checklist

- Fixtures deterministic.
- State matrix documented.
- High-risk global changes reviewed broadly.
- No silent baseline churn.

## Review Heuristics

- What visual failure would users notice but behavior tests miss?
- Are our fixtures representative of real stress?
- Did we inspect the diff or merely bless it?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```
