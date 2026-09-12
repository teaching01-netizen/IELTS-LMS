# SAT Exam — Apple-Design UX Audit, Implementation Plan (Overall)

Workflow: ai-planning-workflow. Stage: PLAN ONLY (no implementation yet — zero UI changes).
Direction: Apple Human Interface Guidelines (skill apple-design), principles + foundations on a web React exam surface.
Scope: SAT student exam delivery only — src/features/student-delivery (ui/shell, ui/question, ui/review, ui/transitions, ui/feedback, ui/tools, ui/primitives, ui/help, ui/break, ui/reading, ui/annotations, ui/media, ui/motion) + exam CSS in src/index.css (.sat-ui scope) + domain/satCopy.ts.
Out of scope: staff workspace (src/products/sat, .sat-product), IELTS surfaces, backend, persistence, timing engine, scoring, auth, any visual redesign or CSS value change.

## 1. Goal

Audit the SAT exam module surface (TopBar, workspace, answers, navigator, footer, review, directions/transitions, save status, floating tools, modals, help) purely in UX terms through the Apple-design lens, and convert the audit into an execution-ready dependency-ordered plan that a later wave can execute WITHOUT redesigning the UI.

Apple-design means (per skill): eight principles as first filter (Purpose, Agency, Responsibility, Familiarity, Flexibility, Simplicity, Craft, Delight); five lenses in order (1 Accessibility Critical, 2 Platform conventions, 3 Visual/craft, 4 Interaction, 5 Content/writing); numbers not adjectives; cite file-heading-quote or mark judgment; no UI change in this workflow — fixes are specified exactly but NOT applied.

Non-goals: no CSS/component/copy edits applied (proposals only); no stores, persistence, backend, timing, scoring change; no .sat-product change; no Liquid Glass restyle, dark-mode build, or rebrand.

## 2. Current-state snapshot (verified 2026-09-11, code-read)

Shell: SatExamShell.tsx (425 lines) — 3-row grid (TopBar/document main/Footer), inert blocked region, one interaction machine for exclusive surfaces (directions/navigator/notes/reading/more), floating Calculator/Reference as independent non-modal layers, hidden-timer auto-reveal at 5:00 + one-shot warning, shortcuts converging clicks and keys.
TopBar: SatExamTopBar.tsx — 3-anchor header (context+Directions | centered timer+Hide/Show | tools: Highlight, Question note, Display Aa, Calculator, Reference, More), 96px desktop / 2-row mobile, threshold-only timer announcements.
Footer: SatExamFooter.tsx — pale chrome, 70px rhythm, candidate name + save noun left, centered black navigator pill, Back quiet + Next filled-royal primary right; last question swaps Next for a distinct Review action.
Navigator: SatQuestionNavigator.tsx — footer-anchored dialog, compact vs anchored presentation, legend Current/Answered/Unanswered/Flagged, 44px cells.
Question: SatQuestionRenderer + SatQuestionWorkspace — split passage/question, 2px divider, slider handle role=slider with arrows/Home/End, mobile Passage-only/Question-only tabs; SatSingleChoiceAnswer radio rows (28px letter marker, selected 2px accent border + soft tint, eliminator cross-out); SatStudentProducedAnswer blur validation with help + role=alert chain; SatQuestionHeader number block + Mark for Review + Option Eliminator.
Review: SatReviewPage.tsx — section+timer header, H1 Review your answers, answered/unanswered/flagged strip, status grid, unanswered notice, Back-to-question-N + Submit module two-step confirm.
Transitions/feedback: SatDirectionsScreen (720px centered, Begin module primary + Leave tertiary + confirm), SatSaveStatus (one surface: polite saving / warning offline-retrying / alert failed-superseded with inline recovery, outside inert), SatFloatingTool (draggable non-modal desktop, bottom-sheet compact, Escape closes, focus returns), SatCenterModal (Radix focus contract), SatHelpModal (accordion + Expand/Collapse All).
Copy: domain/satCopy.ts (253 lines) — single vocabulary source.
Tokens (src/index.css .sat-ui): accent 3154D7, hover-strong 2947BA, pressed 223A98, soft E4EAFB, focus 005FCC, chrome EAF2FD, review C9475C, danger b42318, warning 8a4b00, text 1d1d1f / secondary 515154, type 17/15/14/13/20/18px, 44px targets, 130ms motion, answer 52px min / 8px radius / 28px marker, pill buttons 44px. High-contrast variant exists. color-scheme light only.
Computed contrast (WCAG formula): body 16.83, secondary 7.91, white-on-accent 6.21, accent-strong-on-white 7.76, disabled 5.09, danger 6.57, warning-on-soft 6.38, review-on-white 4.63 — all AA pass.
Prior audit this session (no files changed): rating Good, no Critical; High notes = top-bar density + single appearance (documented trade-off); Medium = timer pill size, no reduced-motion guard, mixed capitalization; Lows = saving text-only, H1/eyebrow naming. Phases below re-verify each claim with file:line evidence and HIG citations.

## 3. Architecture

Audit-only pipeline, one direction: evidence (read-only code+token reads) -> lens audits (phases 01-04, plan files only) -> integration (phase 05: deduped registry, re-grade, sequenced fix specs, verification matrix).
Rules: every phase reads the same frozen file set; no phase edits source; every finding = What (file:line + numbers) / Why (HIG cite+quote or judgment) / Fix-spec (exact token/px/component/prop, NOT applied). Severity: Critical (a11y failure, unusable at some size) / High (real friction, foreign-on-platform, templated) / Medium (suboptimal, inconsistency) / Low (polish, edge). Rating rule: Critical issues if any Critical; Needs work if several High; Good if max 2 High; Excellent if nothing above Medium + point of view found.

## 4. Phases

Phase 01 — Accessibility audit (Lens 1). Owns plan file plans-sat-audit/phase-01-accessibility.md. Reads: shell, topbar, footer, navigator, renderer, workspace, answers, header, review, directions, save, floating tool, modals, split handle, tokens, copy. Work: type sizes vs 17pt/11pt minimums; contrast recompute table; 44px targets incl. 320px behavior; color-alone checks; SR labels (aria-pressed/current/describedby chains, fieldset, slider, timer announcements); keyboard-only map; motion/transparency/contrast answers. Exit: finding table + verification needs.

Phase 02 — Platform conventions + Interaction (Lenses 2+4). Owns plans-sat-audit/phase-02-conventions-interaction.md. Reads: shell interaction machine, more menu, floating tools, center modal, help/shortcuts, break veil/dialog, timer warning, save status, review submit confirm, directions leave confirm, transitions. Work: one-surface-at-a-time proof; dismiss paths; alert rarity; destructive confirm quality; timer-keeps-running transparency; non-modal coexistence; one-handed reach + safe areas; threshold-only announcements. Exit: convention/interaction findings + flow-level notes.

Phase 03 — Visual design, craft and tokens (Lens 3). Owns plans-sat-audit/phase-03-visual-craft.md. Reads: index.css .sat-ui block + shell/topbar/footer/navigator/question/answers/review/directions/save/tools/modals. Work: one-color-one-meaning; semantic-vs-primitive token use; type scale + serif/sans split; spacing/alignment/progressive disclosure; icon consistency + weight match; motion inventory (130/160/120ms, press overlay, enters); craft verdict (thesis, signature, template test, boldness-in-one-place, removal candidate). Exit: token/type/motion findings + craft notes + keep-list.

Phase 04 — Content, writing and user flow (Lens 5 + flow). Owns plans-sat-audit/phase-04-content-flow.md. Reads: satCopy.ts + topbar/header/footer/navigator/review/directions/submit confirm/save/break/help/shortcuts/timer warning/image viewer. Work: verb-led labels; action-name continuity; capitalization map; error/empty copy (what + how-to-fix, no apology); jargon/filler sweep; one-job-per-element; flow walk directions->module->navigator->review->confirm->complete. Exit: copy/flow findings (proposed strings only) + flow map.

Phase 05 — Registry, re-grade and sequenced fix plan. Owns plans-sat-audit/phase-05-registry.md. Depends on 01-04. Work: dedupe overlaps; apply rating rule; order fix-specs by wave (a11y -> conventions -> craft -> polish); verification matrix (contrast recompute, typecheck, lint, unit/e2e targets, axe pass, keyboard map, SR script, 320px + 200pct + reduced-motion + high-contrast passes); list device-only measurements. Exit: final registry + wave plan + verification checklist + no-source-changes confirmation.

## 5. Execution graph (this workflow = plan files only)

Wave 1 (parallel — disjoint plan files, shared read-only sources): Phase 01 + Phase 02 + Phase 03 + Phase 04. Then Wave 2 (blocked by Wave 1): Phase 05. Then main-agent verification and present. Later implementation (NOT this workflow): Wave A tokens/a11y -> Wave B shell/conventions -> Wave C components/craft -> Wave D pages/polish -> final integration.

## 6. Completion criteria

plans-sat-audit/overall-plan.md + phase-01..phase-05 exist, each with objective, dependencies, files read, findings (What/Why/Fix-spec), edge cases, verification, definition of done. Every finding has HIG cite+quote or judgment label; every contrast number recomputed; every severity tagged. Zero source edits (git status clean on src/, index.css, satCopy). Final rating + sequenced later-implementation waves + verification matrix in phase-05.