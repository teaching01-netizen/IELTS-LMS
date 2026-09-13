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
