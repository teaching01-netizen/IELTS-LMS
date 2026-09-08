# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Content-team authors working in batch sittings (dozens of SAT questions per session). Keyboard-fluent repeat users; the tool must disappear into the task. Occasional teacher-authors are secondary.

## Product Purpose

Author complete, valid Digital SAT exams: write prompts and stimuli, set answer keys, classify (domain / skill / difficulty / tags), and drive every question to validation-ready. Success = a full module reaches Ready with zero rework trips.

## Positioning

The authoring workspace is the single place an SAT question is born valid — writing, keying, classifying, and validation live in one flow, against the real student delivery renderer.

## Operating Context

Long batch authoring runs inside one SAT module (Reading & Writing or Math). Attention belongs on passage/question/key correctness, not on operating the workspace. Authors move question-to-question via Save & Next, bulk-classify via multi-select, and release only when validation is clean.

## Capabilities and Constraints

- Question types: single-choice (A–D) and student-produced response (Math only).
- Classification (domain, skill, difficulty) gates validation readiness; empty domain/skill blocks.
- Autosave pipeline with offline tolerance; validation via satProvider.validateSatQuestion.
- Routes: /sat/exams, /sat/exams/:examId (author), /preview, /release, /access. Backend contracts and validation logic are fixed.
- Accessibility: keyboard-first batch flow (⌘S / ⌘Return / ⌘D), visible focus, reduced-motion support.

## Brand Commitments

SAT authoring surface is approved for visual replacement (user-pinned, 2026-09-08): exam-paper editorial world, single-column flow, only behavior + data preserved. The incumbent Apple-like au- token system is anti-reference on this surface, not authority. IELTS surfaces are out of scope and untouched.

## Evidence on Hand

Incumbent implementation: src/features/exam-authoring/ui/AuthoringWorkspace.tsx, QuestionEditor.tsx, QuestionListPane.tsx, QuestionInspectorPane.tsx; tokens in src/index.css (au- system). Prototype of prior restructure attempt: prototype/sat-authoring-spine.html.

## Product Principles

1. One question, one spine — a question is edited in exactly one place.
2. Classification at the moment of writing, never discovered after.
3. The key is unmissable at 60cm scan distance.
4. Release appears only where its preconditions are proven.
5. Batch speed for experts; self-evidence for newcomers.

## Accessibility & Inclusion

WCAG AA; keyboard-complete authoring; no state carried by color alone.
