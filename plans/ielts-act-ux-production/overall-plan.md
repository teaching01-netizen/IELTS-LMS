# IELTS and ACT UX/UI: production implementation plan

Status: proposed implementation; code review and focused baseline checks completed on 2026-09-12. Product code has not been changed by this planning task.

## Outcome

Preserve the recognizable exam interface while improving reading comfort, layout, interaction, accessibility, and recovery. Deliver the changes through the existing React/TypeScript student application and Go backend boundaries. Retain answer identity, scoring, timing, proctor authority, and durable submission behavior.

This is an incremental implementation, not a replacement application. The repository already contains the shell, layout policy, protected inputs, annotation offsets, autosave, authoritative clocks, submission barriers, browser tests, and CI. Those are the starting point.

## Read this plan

| Document | Purpose |
| --- | --- |
| [Code review and baseline](code-review-baseline.md) | Findings, existing strengths, exact failed checks, and limits of this review |
| [Design and behavior contract](design-contract.md) | Typography, geometry, adaptive modes, controls, annotations, and module behavior |
| [Implementation phases](implementation-phases.md) | Index and summaries for eight detailed phase guides, with ordered tasks, files, tests, and exit gates |
| [Verification and release](verification-and-release.md) | Acceptance scenarios, commands, performance budgets, security checks, rollout, and rollback |

## Scope

- IELTS Reading, Listening, Writing, and the existing Speaking support surface.
- ACT **Science**, which is the current ACT preset and student workspace in the inspected code. This initiative does not silently introduce ACT English, Math, Reading, or Writing delivery.
- The complete student journey: entry, registration, pre-check, lobby, active work, pause/intervention, reconnection, submission/finalization, and completion.
- Authoring preview and results/proctor integration where they share these components or determine the student experience. The existing ACT reconciliation plan remains the owner of ACT domain, media, delivery, and grading changes.
- Production release controls for the affected frontend and Go services.

SAT keeps its existing product behavior. Shared CSS, routing, media, and delivery changes must pass SAT regressions. No new UI is added to SAT as a side effect.

## Findings that drive the implementation

| Priority | Observed code | Required action |
| --- | --- | --- |
| P0 | Three unresolved Git conflict entries; global typecheck reports 14 errors | Establish a resolved integration baseline before implementation/release |
| P0 | `package.json` declares `dompurify: 3.4.15`, absent from the npm lockfile root dependency map | Reconcile the package manager/lockfile and prove a clean CI install |
| P0 | Deployment depends on unit/static/backend jobs but not E2E or performance jobs | Make required acceptance checks prerequisites for promotion |
| P1 | Layout is width-only; 768px enters medium/split mode; the layout README still says 700px | Replace contradictory layout decisions with a container- and height-aware policy |
| P1 | Both pane minimum widths are 48px; desktop rail width and width calculation disagree | Establish readable minimum widths and one splitter geometry owner |
| P1 | Compact pane switching conditionally mounts the visible pane | Keep editor/control identity stable and restore meaningful reading context |
| P1 | Typography uses viewport-dependent `clamp()`/`vw`; Writing uses `font-serif` and an animated card | Use stable semantic typography and a quiet full-pane writing surface |
| P1 | `ProtectedSelect` is native but also carries rescue and durability lifecycle behavior | Introduce deterministic presentation without bypassing answer protection |
| P1 | Some accessibility/performance tests can pass when the expected feature or measurement is absent | Make mandatory scenarios fail when their prerequisites are missing |
| P2 | Several controls scale on press; timer/dialog motion and green/amber navigation styling are explicitly tested | Replace obsolete presentation expectations with the new state contract |

These are source findings. No student screen screenshot, pixel-parity result, or device compatibility certification is claimed.

## Architecture decisions

1. **Keep the existing boundaries.** UI lives in `src/components/student/`; domain/application/contracts/infrastructure remain in `src/features/student/`. Reuse the installed React, Radix, DOMPurify, Query, Zustand, and test tooling. Do not create another `features/ielts-exam` store tree.
2. **One owner per responsibility.** Layout chooses presentation; the scoped session store owns exam state; existing durability/outbox adapters own accepted edits and replay; Go owns deadlines, permissions, terminalization, and scoring.
3. **One mounted work surface.** Resize and pane switching cannot replace the answer model or remount a writing editor simply to change layout. Hidden panels are removed from keyboard/assistive navigation while their state remains available.
4. **Preserve the textarea.** Restyle the existing plain-text textarea. A `contenteditable` migration would introduce additional selection, IME, clipboard, and recovery risk without satisfying an unmet requirement.
5. **Use shared presentation, provider-specific rules.** Add a small typed presentation configuration at the existing provider boundary for IELTS/ACT labels, permitted tools, and defaults. Never let a theme or client preference grant exam permissions.
6. **Treat the notes as design direction.** Their sample values sometimes conflict; the design contract below resolves them. Browser zoom, visible keyboard focus, truthful saving, and existing security rules take precedence over a literal CSS copy.
7. **Keep the data protocol stable.** No answer schema, grading, or database rewrite is needed for the visual work. Any necessary backend defect repair is isolated, tested, and reconciled with ongoing ACT work.

## Delivery sequence

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| [0](phase-00-baseline.md) | Resolved baseline, fixtures, parity/policy inventory, release prerequisites | None |
| [1](phase-01-design-system.md) | Shared exam tokens, semantic typography, complete control states | 0 |
| [2](phase-02-adaptive-workspace.md) | Container/height-aware shell, stable panes, correct splitter and keyboard clearance | 1 |
| [3](phase-03-controls-navigation.md) | Answer controls, deterministic select, navigation, focus, and popovers | 2 |
| [4](phase-04-modules-journey.md) | IELTS module polish and ACT Science integration | 3 |
| [5](phase-05-annotations-memory.md) | Persistent highlights, underline, notes, and workspace continuity | 4 |
| [6](phase-06-reliability-security-performance.md) | Recovery UX, security, runtime reliability, and measured performance | 5 |
| [7](phase-07-verification-release.md) | Full acceptance, staged rollout, operational handoff, and rollback rehearsal | 6 |

Implementation proceeds serially without sub-agents. Each phase includes its own relevant tests; testing is not deferred to Phase 7. Split large phases into reviewable commits at the existing ownership boundaries. Do not combine style changes with changes to submission ordering.

## Decisions resolved from the supplied notes

| Proposal in the notes | Implementation decision |
| --- | --- |
| Apple interaction quality | Adopt stable geometry, restrained motion, immediate response, clear focus, and predictable tools |
| Exact official appearance | Preserve the current provider identity; maintain reference fixtures and classify intentional differences; do not claim live-test parity from these text notes alone |
| Fixed 64px/60px shell | Use these as normal-density targets, with content-aware minimum sizing and safe areas; never clip enlarged text to force a height |
| Four responsive modes | Use wide, standard, compact, and phone modes with a low-height override and computed pane-fit checks |
| 32–68% split everywhere | Use that preferred range only when readable minimum pane widths fit; otherwise clamp further or enter focus mode |
| Replace all native selects | Replace exam answer selects through their protected value/lifecycle boundary; keep unrelated staff selects outside this change |
| Replace Writing with contenteditable | Keep and improve the existing textarea |
| Hide successful saves | Keep a quiet, stable status location backed by persistence truth; remove success toasts and layout movement, not useful recovery information |
| Enable native copy/paste/undo | Existing tests deliberately block some operations. Preserve those rules by default and record any approved policy changes explicitly before implementing them |
| Add authentic/practice modes | Reuse existing delivery/configuration distinctions. Do not create a student-toggleable mode that changes privileges or exam timing |
| Remember everything | Persist answers and annotations appropriately; keep popovers, hover, drag, and destructive tool modes ephemeral |
| Works on every device | Support a documented browser/device matrix and capability fallbacks; do not promise untested hardware or proctoring APIs |

## Completion standard

The work is complete when all planned IELTS/ACT surfaces satisfy the behavior contract, the selected device/browser matrix has evidence, every accepted answer survives the required recovery cases, submitted results are verified by the server, required CI jobs gate deployment, and the previous release can be restored without clearing candidate work.

Passing the focused baseline alone does not make the current application production-ready. The unresolved conflicts, type errors, lockfile discrepancy, and missing deployment dependencies must be closed along with the UX changes.
