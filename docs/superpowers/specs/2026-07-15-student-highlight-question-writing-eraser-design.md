# Student Highlight Question, Writing, and Eraser Design

## Goal

Make the existing student highlight tool consistent across Reading, Listening, and Writing. Students can highlight eligible question or prompt text, and can enter erase mode from an always-visible header button.

## Ownership and Boundaries

The student exam UI owns this change. `StudentUIProvider` continues to own the session-local active tool mode and selected color. Each `HighlightableSurface` continues to own its persisted, source-hash-validated ranges through the existing highlight engine.

The change must not alter answer persistence, exam submission, timers, or integrity events. Highlight ranges remain separate from submitted answers.

## Interaction Design

The header exposes two adjacent controls whenever highlighting is available:

1. **Highlight** toggles highlight mode using the last selected color. Its disclosure continues to expose the five existing colors.
2. **Erase** independently toggles erase mode and is always visible beside Highlight. Selecting Erase must not require opening the color menu.

Only one mode can be active at a time: off, highlight, or erase. Selecting the currently active mode turns it off. The controls retain 44px minimum touch targets, visible focus, `aria-pressed`, and non-color status text.

## Eligible Surfaces

- Reading: passage text and eligible question-side text.
- Listening: transcript/material text and eligible question-side text.
- Writing: task prompt/question text only.
- Writing answer editor: explicitly excluded. Selecting or editing the student's answer must never create or erase a highlight range.
- Answer controls, form fields, buttons, and other interactive elements remain excluded by the existing surface resolver.

Each text region remains a separate surface. A selection may span blocks within one surface but must not span between material, question, prompt, or answer surfaces.

## Context Lifecycle

The highlight context eligibility expands from Reading and Listening to Reading, Listening, and Writing during an active, unblocked exam. Existing reset behavior remains in force during submission, blocking states, non-exam phases, and unsupported modules.

Switching modules may turn an active mode off according to the existing reset lifecycle, but persisted surface ranges remain available when their source hash still matches.

## Implementation Direction

- Reuse `StudentHeader`, `StudentUIProvider`, `useHighlightSurfaceV2`, and the existing persistence/selection engine.
- Split Erase out of the highlight color options into its own persistent header control.
- Ensure question renderers provide stable surface identifiers and opt eligible display text into the existing highlight surface.
- Wrap the Writing task prompt in an existing highlight-capable renderer with a stable task-scoped surface identifier; do not wrap the textarea.
- Extend `isStudentHighlightToolContextActive` to recognize Writing.

No new annotation engine, persistence schema, dependency, or cross-surface selection behavior is introduced.

## Verification and Memory

Focused component tests and an end-to-end regression must prove:

- question-side text can be highlighted and erased without changing answer controls;
- Erase is directly visible, has an accessible pressed state, and toggles independently;
- the header tool is available in Writing;
- Writing prompt text can be highlighted and erased;
- the Writing answer editor remains unaffected;
- Reading and Listening highlight persistence and surface isolation still pass;
- unsupported or blocked contexts still reset the active mode.

These regression tests are the required repository memory artifact for the behavior.
