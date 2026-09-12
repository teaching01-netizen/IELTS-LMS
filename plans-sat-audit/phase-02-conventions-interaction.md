# Phase 02 - Platform conventions + Interaction (Apple-design Lenses 2+4)

> PLAN/AUDIT ONLY. No source file was edited. Every Fix-spec below is exact but NOT applied.
> Overall plan: plans-sat-audit/overall-plan.md (Wave 1, parallel with Phases 01/03/04).

## 1. Objective

Audit the SAT student exam surface through Apple HIG platform-convention (Lens 2) and
interaction (Lens 4) expectations: one-exclusive-surface-at-a-time, dismiss paths, alert
rarity, destructive-confirm quality, non-modal tool coexistence, one-handed reach +
safe areas, feedback proportionality, and threshold-only timer announcements. Re-verify
the prior code-read claims (Good, no Critical; High = top-bar density + light-only trade-off)
from the conventions/interaction angle only.

## 2. Dependencies

- plans-sat-audit/overall-plan.md (frozen file set, severity rules, rating rule).
- Phase 01 owns contrast/type/targets/SR-label depth; Phase 03 owns tokens/motion/craft;
  Phase 04 owns wording/flow copy. This phase cites them only at seams (marked explicitly).
- HIG references at /Users/rd-cream/.agents/skills/apple-design/references/hig/:
  modality.md, sheets.md, alerts.md, popovers.md, feedback.md,
  loading.md, progress-indicators.md, designing-for-ios.md (all opened and quoted below).

## 3. Files read (fully, with line ranges inspected)

- src/features/student-delivery/ui/SatExamShell.tsx | 1-425 (esp. 82-240 machine + toggleOverlay + Escape partition)
- src/features/student-delivery/ui/shell/SatExamTopBar.tsx | 1-249
- src/features/student-delivery/ui/shell/SatMoreMenu.tsx | 1-159
- src/features/student-delivery/ui/tools/SatFloatingTool.tsx | 1-271
- src/features/student-delivery/ui/tools/SatCalculatorPanel.tsx | 1-120
- src/features/student-delivery/ui/tools/SatReferenceSheetPanel.tsx | 1-37
- src/features/student-delivery/ui/primitives/SatCenterModal.tsx | 1-119
- src/features/student-delivery/ui/primitives/SatPopoverShell.tsx | 1-153
- src/features/student-delivery/ui/primitives/satOverlayZ.ts | 1-71
- src/features/student-delivery/ui/help/SatHelpModal.tsx | 1-109
- src/features/student-delivery/ui/help/SatShortcutsModal.tsx | 1-72
- src/features/student-delivery/ui/break/SatUnscheduledBreakDialog.tsx | 1-50
- src/features/student-delivery/ui/break/SatUnscheduledBreakVeil.tsx | 1-68
- src/features/student-delivery/ui/shell/SatTimerWarning.tsx | 1-49
- src/features/student-delivery/ui/feedback/SatSaveStatus.tsx | 1-108
- src/features/student-delivery/ui/shell/SatFooterSaveIndicator.tsx | 1-61
- src/features/student-delivery/ui/review/SatReviewPage.tsx | 1-211 (esp. 138-208 submit two-step)
- src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx | 1-179 (leave confirm 143-175)
- src/features/student-delivery/ui/transitions/SatBreakScreen.tsx | 1-52
- src/features/student-delivery/ui/transitions/SatCompleteScreen.tsx | 1-58
- src/features/student-delivery/ui/shell/SatExamFooter.tsx | 1-114
- src/features/student-delivery/ui/shell/SatQuestionNavigator.tsx | 1-199
- src/features/student-delivery/ui/shell/SatDirectionsPopover.tsx | 1-50
- src/features/student-delivery/ui/shell/SatReadingPopover.tsx | 1-163
- src/features/student-delivery/ui/question/SatNotesPanel.tsx | 1-145
- src/features/student-delivery/ui/feedback/SatControlFeedback.tsx | 1-143 (context)
- src/features/student-delivery/hooks/useSatInteractionController.ts | 1-348
- src/features/student-delivery/domain/satInteractionIntents.ts | 30-175
- src/features/student-delivery/domain/satInteractionEscape.ts | 1-32
- src/features/student-delivery/domain/satCopy.ts | 1-253 (esp. 77-135, 158-216)
- src/features/student-delivery/domain/satTiming.ts | 90-123 (auto-reveal 300s)
- src/shared/hooks/useStudentTimerAnnouncement.ts | 1-38 (300s/60s announcer)

## 4. Checklist verdicts (summary; evidence in section 5)

(a) One-exclusive-surface: HOLDS on desktop, BREAKS on compact. State holds exactly one
    surface (surface union is a single kind; toggle replaces, satInteractionIntents.ts:132-163).
    Floating tools are independent runner-owned layers by design (SatExamShell.tsx:213-234).
    Breach: on compact a tool sheet (aria-modal true) can coexist with a notes/display
    popover (aria-modal true) - see H1.
(b) Dismiss paths: complete per dialog except Timer Warning (no Escape). Escape ownership is
    partitioned (shell yields to route modals + tools, SatExamShell.tsx:137-151); every
    popover/modal returns focus to its trigger. Gap: SatTimerWarning has button-dismiss only - L1.
    Latent gap: machine-level return-focus selectors match nothing for 4/5 surfaces - M3.
(c) Alert rarity: HOLDS. role=alert fires only for failed-with-action
    (SatSaveStatus.tsx:77-82 failed/superseded with inline Retry/Take over) and route-level
    load errors with recovery (SatDirectionsScreen.tsx:92-99); offline/retrying/saving stay
    role=status polite (SatSaveStatus.tsx:38-73). The 5-min warning is display-only +
    dismissible (SatExamShell.tsx:406-413, SatTimerWarning.tsx:38-46) but wears alertdialog
    clothing - see L1.
(d) Destructive confirms: STRONG. Submit names scope + counts + irreversibility
    (SatReviewPage.tsx:178-208); leave states saved-vs-unsaved explicitly (satCopy.ts:99);
    break states timer-keeps-running twice (satCopy.ts:197,201). Safe action leads,
    destructive trails in all three; only the safe-button noun deviates from HIG - L2.
(e) Non-modal coexistence: CORRECT except More menu. Desktop tools/popovers never trap
    (SatFloatingTool.tsx:126-159, SatPopoverShell.tsx:58-81); compact sheets trap Tab -
    correct per breakpoint. Outlier: SatMoreMenu.tsx traps Tab at ALL sizes - M1.
(f) Reach + safe areas: PASS with one geometry overlap. Primaries live at the bottom
    (footer 70px rhythm, navigator + Back/Next); every fixed surface adds student-safe vars;
    mobile topbar keeps 2-row stacking. Overlap: save banners sit at 78/82px over an 86px
    footer - L3. Top-bar density High re-verified (6 tools + More + timer + Directions in
    96px / 2-row; labels hide below 420px, SatExamTopBar.tsx:62,240).
(g) Feedback proportionality + timer announcements: HOLD. Passive footer noun (no live region,
    SatFooterSaveIndicator.tsx:33-59) vs banner sentence (role=status/alert) vs blocking veil;
    timer announces at 300s/60s thresholds only, never per-second
    (useStudentTimerAnnouncement.ts:21-37); auto-reveal is one-shot + announced + re-hideable
    (L4 observation). Break: review-route timer has no announcer at all - M4.

## 5. Findings

### H1 (High) - Two simultaneous aria-modal=true surfaces on compact
- What: SatFloatingTool.tsx:179 claims aria-modal=true in the compact sheet;
  SatPopoverShell.tsx:105 claims aria-modal true when compact for Notes/Display/Directions.
  Coexistence is by design (SatExamShell.tsx:218-222, tools open regardless of surface
  235-240). Each traps Tab to itself (tool 137-154; popover 65-80), z 83 (tool backdrop)
  vs 78 (notes backdrop). Repro: max-width 639px, open Question note, open Calculator
  via shortcut = two modals + two Tab traps.
- Why: sheets.md Best practices - quote: Display only one sheet at a time from the main
  interface. And modality.md Best practices - quote: Let people dismiss a modal view before
  presenting another one. The z-contract itself claims the rule (satOverlayZ.ts:26-28:
  at most one aria-modal=true surface may be open at a time) - code violates its own
  contract on compact only; desktop is fine (both non-modal).
- Fix-spec (NOT applied), pick ONE: (i) route tool-open through the exclusive machine on
  compact only - opening a tool while a compact popover is open closes the popover first
  (close-then-open per sheets.md), desktop keeps coexistence; OR (ii) drop aria-modal + Tab
  trap from the compact tool sheet, making it an explicitly non-modal bottom sheet like the
  desktop panel (document the choice in satOverlayZ.ts:26-34). Add a compact-viewport test:
  open notes + calculator implies querySelectorAll aria-modal=true length <= 1.

### M1 (Medium) - More menu traps Tab on desktop; no other desktop popover does
- What: SatMoreMenu.tsx:45-58 traps Tab unconditionally (no compact gate). Compare:
  SatPopoverShell.tsx:65 traps only-if-compact; SatFloatingTool.tsx:137 traps only-if-compact;
  SatQuestionNavigator.tsx:56-62 never traps. Keyboard user opening More on desktop cannot
  Tab out to the exam without Escape/choice; every sibling surface allows it.
- Why: Judgment + sheets.md Best practices - quote: Use a nonmodal view when you want to
  present supplementary items that affect the main task in the parent view. Desktop More is
  a non-modal dropdown (no aria-modal, outside-press closes) yet behaves modally for Tab -
  inconsistent with its own presentation and the three sibling contracts.
- Fix-spec (NOT applied): gate the trap exactly like SatPopoverShell.tsx:65 - change
  SatMoreMenu.tsx:45 guard to return early when NOT compact before the Tab-trap block
  (the compact flag already exists at line 32). Compact keeps the trap. No other change.

### M2 (Medium) - Save-failed role=alert renders UNDER the open navigator
- What: failed/superseded banner is fixed z-75 (SatSaveStatus.tsx:78); navigator panel is
  fixed z-80 (SatQuestionNavigator.tsx:183); More menu is z-84 (SatMoreMenu.tsx:104). An open
  navigator (up to 54dvh tall, bottom-anchored) covers the centered 680px-wide failure banner
  and its inline Retry/Take-over action. The contract comment promises the opposite
  (satOverlayZ.ts:46-47: save failures stay visible over the menu) but numbers put
  saveAlert(75) below navigator(80)/moreMenu(84).
- Why: popovers.md Best practices - quote: Do not show another view over a popover. Make sure
  nothing displays on top of a popover, except for an alert. Inverted here: a popover covers
  an alert. The failure banner IS the alert (assertive, actionable) and must paint above
  every non-blocking surface.
- Fix-spec (NOT applied): raise the failed/superseded branch only to z-85 (routeAlert layer:
  above navigator 80/moreMenu 84, at/below breakConfirm 86); keep offline/retrying at 65 and
  saving hint at 55. Update the satOverlayZ.ts:9-12 comment to match. Numbers only; no
  behavior or copy change.

### M3 (Medium) - Machine return-focus map points at triggers that do not exist (4/5 surfaces)
- What: defaultReturnFocus (satInteractionIntents.ts:42-55) resolves navigator to
  footer-navigator data-sat-focus, directions to topbar-directions, reading to topbar-reading,
  notes to topbar-notes. Grep: the ONLY data-sat-focus in shell chrome is topbar-more
  (SatExamTopBar.tsx:196); footer navigator exposes id only (SatExamFooter.tsx:54-61);
  directions/reading/notes buttons expose refs/ids, no data-sat-focus. So the controller
  effect (useSatInteractionController.ts:167-178) silently no-ops on those closes; focus
  return today rides entirely on component-level contracts (SatPopoverShell to triggerRef,
  Navigator to returnFocusId, MoreMenu to topbar-more fallback).
- Why: Judgment (no HIG page mandates the mechanism; HIG demands the outcome) + modality.md
  Best practices - quote: Always give people an obvious way to dismiss a modal view.
  Dismissal includes landing focus somewhere sane. Dual overlapping contracts (machine +
  per-component) with the machine half dead is a latent focus-loss trap for any future
  surface relying solely on the machine.
- Fix-spec (NOT applied), pick ONE: (A) mount the contract - add data-sat-focus=
  topbar-directions to the Directions button (SatExamTopBar.tsx:67-77), topbar-reading to the
  Display button (147-158), topbar-notes alongside notesButtonId (136-145),
  footer-navigator alongside navigatorButtonId (SatExamFooter.tsx:54-63); OR (B) delete
  defaultReturnFocus + the controller focus effect and document per-component return as the
  single contract (update useSatInteractionController.ts:163-178 comments). Either way add a
  test per surface: open, Escape, assert document.activeElement is the trigger.

### M4 (Medium) - Review-route timer is announcement-silent at thresholds (flow break)
- What: review header renders role=timer + per-tick label with NO polite announcer
  (SatReviewPage.tsx:85-103); no useStudentTimerAnnouncement import on the route. The 5-min
  auto-reveal + SatTimerWarning live only in the module shell (SatExamShell.tsx:157-180,
  406-413; shell mounts module-phase only per lines 86-87). A student sitting on Review
  across the 5:00/1:00 boundaries hears nothing and sees no warning while the module clock runs.
  Break screen has the same silence (SatBreakScreen.tsx:22-24) but waiting-context.
- Why: feedback.md Best practices - quote: The most effective feedback tends to match the
  significance of the information to the way it is delivered. Plus judgment: the module phase
  establishes threshold announcements as THE time-signal contract (300s/60s polite,
  useStudentTimerAnnouncement.ts:21-37); the review phase - where remaining time matters most
  (submit-now vs keep-checking) - drops the contract mid-flow.
- Fix-spec (NOT applied): wire the SAME hook into SatReviewPage.tsx:85-103 - add the sr-only
  polite span bound to useStudentTimerAnnouncement(remainingSeconds), which requires threading
  a remainingSeconds prop (optional number) into SatReviewPageProps (header currently takes
  remainingLabel only, line 15). Do NOT add per-second live text; do NOT auto-show the modal
  warning on review (would interrupt the submit decision - announce-only on review). Verify:
  sit on review across 300s implies one polite announcement.

### L1 (Low) - 5-min warning wears alertdialog for a display-only notice; Escape-less
- What: SatTimerWarning.tsx:21-26 role=alertdialog aria-modal=false; dismiss is button-only
  (38-46), no Escape path, no initial focus move; shell Escape ignores it (surface None =
  NOOP or closes a surface instead). Content is FYI + live clock, requires no decision.
- Why: alerts.md Best practices - quote: Avoid using an alert merely to provide information.
  And quote: Provide alternative ways to cancel an alert when it makes sense... Pressing
  Escape (Esc). An alertdialog promises a decision; this one offers dismissal only.
  Counter-quote (why Low not Medium): the 5-min mark IS time-critical in an exam, and
  feedback.md - quote: Use alerts to deliver critical - and ideally actionable -
  information. The gap is Escape parity, not the interruption itself.
- Fix-spec (NOT applied), pick ONE: (i) keep role, add Escape-to-dismiss (shell Escape
  partition gains a timerWarningVisible branch taking priority over surface-close, one press
  = dismiss only); (ii) OR downgrade to role=status + keep visual prominence (z 96, title,
  clock) - then no Escape needed. Either way keep: one-shot per module, re-arm rule,
  button label/aria-label pair as-is.

### L2 (Low) - Safe-button nouns deviate from HIG Cancel
- What: submit confirm pairs Keep checking + Submit anyway (SatReviewPage.tsx:191-205,
  satCopy.ts:81-82); leave confirm pairs Stay and continue + Leave without saving more
  (SatDirectionsScreen.tsx:158-173, satCopy.ts:100-101). Only break confirm uses literal
  Cancel (satCopy.ts:198). Placement is correct everywhere (safe leading, consequential trailing).
- Why: alerts.md Buttons - quote: Always use the title Cancel for a button that cancels the
  alert's action. Versus quote: Create succinct, logical button titles... Prefer verbs and verb
  phrases that relate directly to the alert text. Bluebook-familiar verbs aid recognition over
  generic Cancel - recorded as conscious-deviation candidate for Phase 04, not a defect.
  Destructive-side verbs already satisfy the specificity rule.
- Fix-spec (NOT applied): no change specified beyond Phase 04 owning the verdict - keep strings
  OR rename safe buttons to Cancel (copy-table-only change). Interaction geometry (order,
  styling, focus return via triggerRef/leaveButtonRef) stays identical either way.

### L3 (Low) - Save banners overlap the footer they sit above
- What: saving hint bottom 82px (SatSaveStatus.tsx:41), offline/retrying/failed bottom 78px
  (56,78) - all with safe-bottom - vs footer total height about 86px (min-h-70 + py-2,
  SatExamFooter.tsx:43-44). Centered 680px banners cover the footer navigator pill; the left
  saving hint (pointer-events-none, visual only) sits over the Back zone. Transient states
  only; retry/take-over actions remain clickable (banner paints above footer chrome).
  Navigator avoids this (bottom 86px, SatQuestionNavigator.tsx:183).
- Why: Judgment (reach/occlusion) + designing-for-ios.md Best practices - quote: Support
  interactions that accommodate the way people usually hold their device... easier... to reach
  a control when it is located in the middle or bottom area. Transiently covering the
  bottom-anchored navigator pill removes the primary question-switcher exactly while offline,
  when local navigation still works.
- Fix-spec (NOT applied): raise the three SatSaveStatus.tsx:41,56,78 offsets to
  bottom calc(96px + safe-bottom) - above the 86px footer + 10px air, matching navigator
  rhythm at 86px + panel. No z, role, or copy change.

### L4 (Low) - Hidden-timer auto-reveal overrides an explicit Hide at 5:00
- What: satTiming.ts:105-117 + SatExamShell.tsx:166-180: crossing 300s forces
  setTimerVisible(true) + warning, once per module; user may re-hide after. Override of an
  explicit user choice is announced (SatExamTopBar.tsx:105-109 live region, string at
  satCopy.ts:251-253) and explained in-warning (satCopy.ts:215: hidden timer is shown again).
- Why: Judgment (agency vs responsibility): HIG agency favors honoring Hide; exam
  responsibility (a timed high-stakes test) favors guaranteeing time awareness at 5:00.
  Announced + one-shot + re-hideable is the mildest possible override - recorded as
  accepted-trade-off candidate, consistent with prior documented-trade-off handling.
- Fix-spec (NOT applied): no change. Softer variant if Phase 05 wants it: reveal the WARNING
  only and leave timerVisible untouched (delete setTimerVisible(true) at SatExamShell.tsx:171,
  keep setTimerWarningVisible(true)); announcement string must then drop Timer shown
  (copy-table edit, Phase 04).

### L5 (Low) - Stale conflict-matrix comment contradicts shipped coexistence
- What: satInteractionIntents.ts:58-65 header says calculator/reference open closes the
  exclusive surface; but tool toggles resolve to null (119-121, refused no-ops) and the shell
  documents coexistence as the contract (SatExamShell.tsx:213-234). Comment-only; behavior is
  correct and tested.
- Why: Judgment: no HIG bearing - doc integrity. A reader auditing checklist (a) from the
  comment alone concludes single-surface INCLUDING tools, then finds tools independent.
- Fix-spec (NOT applied): rewrite the two comment lines (satInteractionIntents.ts:61-62) to:
  calculator/reference are runner-owned independent layers; intents refuse them here and
  opening a tool never closes the exclusive surface (shell coexistence contract).
  Zero behavior change.

### Passes worth recording (re-verified, no finding filed)

- Exclusive toggle replaces in one gesture: satInteractionIntents.ts:132-163 - opening B while
  A open swaps (no stacking); popovers.md - quote: When possible, let people close one popover
  and open another with a single click or tap. More to Help/Shortcuts/Break closes the menu
  first (SatExamShell.tsx:310-314), satisfying sheets.md - quote: close the first sheet before
  displaying the new one.
- Escape = exactly one semantic action: priority chain blocking, editor, surface, selection,
  line-reader, annotation mode, noop (satInteractionEscape.ts:20-31); shell cedes Escape to
  route modals + tools (SatExamShell.tsx:137-151); Radix owns modal Escape (SatCenterModal).
- Submit confirm quality: scope-naming title (satCopy.ts:229-231), counts summary (233-235),
  irreversibility (satCopy.ts:87), trailing consequential button - matches alerts.md placement
  + feedback.md warn-on-irreversible-data-loss rules.
- Break honesty: confirm (satCopy.ts:197) + veil (satCopy.ts:201) both state the timer runs;
  veil shows the LIVE clock (SatUnscheduledBreakVeil.tsx:50-56); leave-confirm distinguishes
  saved vs unsaved (satCopy.ts:99).
- Threshold-only announcements: 300s/60s, once each, reset above 300s
  (useStudentTimerAnnouncement.ts:21-37); per-tick label carries no live region
  (SatExamTopBar.tsx:89-99).
- Compact adapts popovers to sheets: all four popover instances swap anchored panels for
  bottom/centered sheets under 720px/560px (SatPopoverShell.tsx:132-150,
  SatMoreMenu.tsx:144-156, SatFloatingTool.tsx:166-197), per popovers.md Mobile - quote:
  Reserve popovers for wide views; for compact views, use all available screen space by
  presenting information in a full-screen modal view like a sheet instead.
- Safe-area coverage: every fixed surface (popovers, navigator, banners, transition screens,
  review header/footer) offsets with student-safe vars - full-width app with no notch
  clipping by construction.

## 6. Flow-level note (directions to complete)

Each screen is individually sound, but the module-to-review boundary drops two live contracts:
1. Threshold time-signals stop (M4): module shell owns the 300s/60s announcer, auto-reveal,
   and warning; the review route owns none of them while the module clock keeps running. A
   student deliberating keep-checking vs submit at 5:01 hears nothing at 5:00.
2. Surface exclusivity resets by route change (neutral, recorded): the interaction machine is
   module-phase-scoped; review/directions/break/complete are separate routes with their own
   single-dialog discipline (one SatCenterModal at a time each - verified: review confirm,
   directions leave-confirm, break veil). No route stacks two modals; no cross-route leak found.
No screen breaks the surrounding navigation (Back to question N, last-question to Review Page,
two-step submit, complete to dashboard all preserve scope and offer explicit exits). The one
continuity repair is M4 (announce-only on review).

## 7. Edge cases

- Blocked (proctor pause) + open surfaces: inert=blocked covers topbar/footer/navigator/notes
  (SatExamShell.tsx:256-260); save retry stays reachable outside inert (SatSaveStatus 415-421
  placement); Escape under gate = IGNORE (satInteractionEscape.ts:25); tool open + blocked =
  tool handler unregisters AND shell yields (floatingToolOpen) so Escape no-ops: consistent.
- Break veil vs pause vs expiry stacking: veil z-94 yields to submission 95 and blocking 100
  (SatUnscheduledBreakVeil.tsx:20-24 comment + satOverlayZ.ts:9-12 numbers) - order verified in
  contract, needs device-level test (section 8).
- Module change re-arms one-shots: reveal + warning reset when remaining jumps above 300s
  (SatExamShell.tsx:174-178); announcer resets above 300s (useStudentTimerAnnouncement.ts:23-25).
- Compact height (560px or less landscape): triggers sheet presentations for every popover/tool -
  H1 dual-modal repro lives here too, not just narrow widths.
- Notes draft + outside-press: outside-press commits the draft then closes
  (SatNotesPanel.tsx:63-79 handleClose to commitAndClose) - matches popovers.md - quote:
  Always save work when automatically closing a nonmodal popover.
- Calculator keepAlive hidden tree: closed-kept tree is hidden+inert+aria-hidden, no dialog
  role (SatFloatingTool.tsx:205-215) - does not join the modal count; H1 is open sheets only.
- Rapid Escape across tool+surface: tool closes first (shell yields), second press closes
  surface - one action per press preserved; verify by key test (section 8).

## 8. Verification (no source edits; checks a later wave runs)

1. Compact single-modal test (H1): 640x800 + 390x844 viewports; open Notes, open Calculator
   (button AND shortcut paths); assert aria-modal=true count <= 1; Tab-cycle stays in the
   visible sheet; close tool implies notes usable, focus on tool trigger.
2. Escape-partition key test (M1/H1/L1): matrix of surface x tool x route-modal x warning -
   each Escape asserts exactly one state change + focus location; desktop More open + Tab
   implies focus MUST leave the menu (M1 fix check).
3. Alert-over-popover paint test (M2): open navigator, force save-failed; banner + Retry
   visible and clickable above navigator; same with More open.
4. Focus-return map test (M3): each of the 5 surfaces - open, Escape, assert
   document.activeElement is the trigger (fails today for 4/5 at machine level; component
   level passes - pin BOTH levels).
5. Review threshold test (M4): review route with remainingSeconds sweeping 301 to 299 and
   61 to 59; assert one polite announcement each; assert no per-second announcements over 10
   ticks; assert submit-confirm still the only modal.
6. Banner geometry test (L3): 390x844 + desktop; offline/failed states imply banner rect does
   not intersect footer navigator pill rect.
7. Veil stacking test (edge): break veil open, simulate proctor pause, blocking veil covers;
   simulate expiry, submission covers; Return restores exact question (scroll preserved).
8. Typecheck + lint + existing suites: satTimerReveal.test, useStudentTimerAnnouncement.test,
   useSatInteractionController.test, SatExamShell.test (esp. aria-modal + announcement
   assertions) must stay green; update stale-behavior assertions only where the fix-spec
   intentionally changes behavior (M1 trap, M2 z, M4 review prop).

## 9. Definition of done

- This file (plans-sat-audit/phase-02-conventions-interaction.md) exists with objective,
  dependencies, files-read list (section 3), findings table with severity + file:line +
  numbers + HIG cite+quote-or-judgment + unapplied fix-specs (section 5: 1 High, 4 Medium,
  5 Low, 0 Critical), edge cases (section 7), verification (section 8), and this definition.
- Zero source edits: git status clean on src, src/index.css, domain/satCopy.ts
  (only this plan file written).
- Prior-audit re-verification recorded: no Critical found (confirms prior rating); top-bar
  density High re-verified with file:line (section 4f); light-only appearance untouched
  (Phase 01/03 lenses).
- Handoff: Phase 05 consumes H1/M1-M4/L1-L5 for dedupe (likely overlaps: M4 with Phase 04
  flow copy, L2 with Phase 04 vocabulary, L3 with Phase 03 spacing, H1 with Phase 01 AT
  impact) + wave sequencing (suggested: H1+M1+M3 interaction wave, then M2+M4+L1+L3
  convention wave, then L2+L4/L5 polish/docs).
