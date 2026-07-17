# Student Question Touch-Callout Suppression Design

## Goal

Reduce the iOS Safari/PWA long-press system menu on displayed student question text without disabling native text selection, the student Highlight/Erase tool, or editing interactions in answer controls.

This is best-effort browser deterrence. The web application cannot reliably remove individual iOS system actions such as Copy or Translate while preserving selection.

## Ownership and Boundaries

The student exam UI owns this behavior. The semantic marker belongs to student question-copy rendering, the CSS rule belongs to the shared student styles, and the secondary `contextmenu` guard belongs to `StudentKeyboardProvider`, which already owns exam keyboard and clipboard interaction policy.

The change is limited to displayed question-side copy, including block instructions, question stems, option text, labels, and other non-editable question wording. Reading/listening source material and Writing prompts remain outside this change. Form controls, buttons, `input`, `textarea`, `select`, and contenteditable elements must never receive or inherit the marker.

No answer persistence, autosave, submission, timer, grading, or audit-event behavior changes.

## Interaction Design

Question copy receives an explicit semantic data marker. Its style preserves selection and suppresses the WebKit touch callout:

```css
[data-student-question-callout-protected="true"] {
  -webkit-user-select: text;
  user-select: text;
  -webkit-touch-callout: none;
}
```

The marker is applied to the exact text element, not to a container that also owns answer controls. Descendants used only for text formatting inherit the same treatment.

`StudentKeyboardProvider` adds a secondary `contextmenu` fallback. It calls `preventDefault()` only when the event target is inside the marked question-copy element. It does not report an integrity violation because an iOS long press is not itself evidence of misconduct, and it does not block context menus elsewhere.

## Highlight Compatibility

The existing student highlight engine requires a native selection range to identify the text to mark. Therefore this design explicitly keeps `user-select: text`; it must not use `user-select: none`.

`FormattedText` will expose a semantic opt-in prop for question callout suppression and forward it to both rendering paths:

- plain formatted text when highlighting is unavailable;
- `HighlightableSurface` when highlighting or persisted marks are present.

This keeps the data marker stable as Highlight/Erase mode changes. Existing highlight surface identifiers, persistence, selection boundaries, and answer-control exclusions remain unchanged.

## Verification and Repository Memory

Focused regression tests will prove:

- marked question text has callout suppression while retaining text selection;
- the marker survives both plain and highlightable `FormattedText` rendering;
- a `contextmenu` event on marked question text is prevented;
- context menus on answer `input` and `textarea` controls are not prevented by this rule;
- question text remains selectable/highlightable and existing highlight tests still pass;
- the CSS selector does not target answer controls or unrelated exam material.

The regression tests and this design document are the memory artifacts for the change. `docs/ux-invariants.md` will be updated to record that question callout suppression must preserve native selection and highlighting.
