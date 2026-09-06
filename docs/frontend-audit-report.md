# Frontend Audit Report — 2026-09-05 (fix round closed 2026-09-05)

> **Objective:** consolidate every finding from the read-only frontend audit swarm
> (S1 student delivery · S2 admin/builder/authoring/grading · S3 proctor/auth/join/SAT ·
> S4 design-system/primitives/tokens/chrome · S5 Apple-HIG cross-cutting) into one report,
> then fix every finding via the deepswe-consistency loop.
> **Fix round: all P0 criticals + covered majors are now FIXED and verified**
> (`tsc --noEmit` zero errors; audit-area suites green — see §13).
> Original audit evidence below is preserved verbatim for traceability.
> Evidence tags: **[V]** = first-party re-verified by the lead auditor this session
> (file actually read); **[R]** = subagent-reported with file:line citations, not
> independently re-read. Counts below preserve each agent's original IDs for traceability.
> Evidence tags: **[V]** = first-party re-verified by the lead auditor this session
> (file actually read); **[R]** = subagent-reported with file:line citations, not
> independently re-read. Counts below preserve each agent's original IDs for traceability.

---

## 0. Method & scope

- Skills loaded before auditing: `deepswe-consistency` (all), `apple-design` (all),
  plus `mobile-web-frontend-rigorous-audit` (S1), `operational-internal-tool-ux-auditor` (S2),
  `rigorous-user-path-user-flow-auditor` (S3), `better-ui` (S4), `accessibility` (S5).
- Each area agent spawned 1–3 sub-subagents (panes / chrome-flow / highlight-zoom-a11y;
  authoring / admin-publish-versioning / grading-export-review; auth-join / proctor-SAT-ops;
  tokens-theming / primitives-stories-chrome). Late SAT-final deltas (`fef72078`) folded into S3 v3.
- Route manifest verified at `src/app/router/route-manifest.ts:18-76` **[V]**:
  admin 8 children, sat 10, builder 5 (incl. answer-key, **no publish route** — publish lives
  inside the review route), student entry/register/session, join entry. Student
  pre-check/lobby/exam/complete are internal runtime phases, not routes (`:4-6`) **[V]**.
- Correction log (§11) records every place the lead auditor narrowed or corrected a
  subagent claim instead of passing it through.

## 1. Executive summary

| Area | Critical | Major | Minor | HIG verdict |
|---|---|---|---|---|
| S1 student exam delivery | 15 (C1–C15) | 20 (M1–M20) | 20 (m1–m20) | 2.4/5 — pointer-first, not native-feel |
| S2 admin/builder/grading | 22 (C1–C22) | 14 families (M1–M14) | N1 + authoring/grading minors | publish-confidence 1/5, destructive-safety 1/5 |
| S3 proctor/auth/join/SAT | 10 (C1–C10) | 20 (M1–M20) | 12 + extras (m1–m12) | 19/35 ≈ 54% |
| S4 design system/tokens | 7 (C1–C7) | 10 (M1–M10) | matrix + chrome nits | FAIL motion/targets/focus/keyboard/names/dark |
| S5 HIG cross-cutting | Top-8 violations, 12 pillars: 2 pass / 7 partial / 2 fail | — | — | fails: motion physics, keyboard/focus |

**Do-not-ship list (P0):** publish/republish/restore/bulk/schedule/release paths (S2-C1–C6,
C13–C20); grading pinned to draft + false grader identity (S2-C13–C14); queue dead-lock +
ticket loss on join (S3-C2–C3); student login loop (S3-C1); proctor-warning auto-acknowledge
(S1-C5); tablet zoom forced off (S1-C4); no keyboard highlight path + no SR highlight
semantics (S1-C9–C10); phase-change focus loss (S1-C13); medium-band 768–1023 dead zone
(S1-C1–C2); SAT destroy-dialog focus/announced-description defects (S3-C9); SAT room outside
app shell (S3-C10); SAT-only dark mode + AA-text failures + 1091 raw utilities (S4-C1–C3);
unlabeled Stimulus toolbar/editor (S4-C4); QB mouse-only + hand-rolled modals (S4-C5).

---

## 2. HIG scorecards (consolidated)

### S5 — 12 pillars (sampled: StudentHeader/Footer, QuestionNavigator, SubmitConfirmation,
### WarningOverlay, ExamSettingsDrawer, ConfirmModal, Dialog, Drawer, GlobalToast/Toast/sonner, Banner, index.css, motion/a11y prefs)
1. Clarity & legibility — **partial** (real 3-step clamp() ramp `accessibilityScale.ts:61-113`,
   68ch/74ch measure `index.css:328-329`; vs gray-500 icon-only close `SubmitConfirmation.tsx:138`,
   amber-600 small text `:204`, gray-500 counts `StudentFooter.tsx:180`, xs countdown `WarningOverlay.tsx:200`)
2. Deference (safe areas) — **pass** (tokens `index.css:320-323`, consumed `:494-495,607-609`)
3. Depth & materials — **partial** (consistent elevation; **4 scrim recipes**:
   `bg-black/50+blur` Dialog/Drawer vs no-blur Submit vs `bg-black/80+blur-md` Warning vs
   native `backdrop:bg-black/50` Navigator; blackout stacks bg-black + bg-black/80
   `WarningOverlay.tsx:112,117`; no `prefers-reduced-transparency` on exam overlays)
4. Direct manipulation — **partial** (disciplined press token
   `transition-[scale,…] active:scale-[0.96]` on student chrome only;
   Toast/Banner/ConfirmModal dismisses bare `transition-colors`; no velocity handoff anywhere)
5. Motion physics — **FAIL** (all `motion/react` entrances are default tweens, no spring except
   Drawer `damping:25/stiffness:300`, no velocity/exit-gesture; `prefersReducedMotion.ts:1-11`
   **has zero call sites** — verified by grep **[V]**)
6. Reduced motion — **partial** (global kill-switch `index.css:411-424` + sat/authoring blocks;
   unguarded: countdown fill `transition-all duration-1000` `WarningOverlay.tsx:196`,
   `animate-pulse` `:208`, footer width transition `StudentFooter.tsx:174`; no cross-fade substitute)
7. Touch targets — **partial** (system `--student-touch-target-min:2.75rem` `index.css:318-319`,
   header/footer meet `min-h-11`; failures: Submit close ~28–34px `:138`, Dialog/Drawer closes
   `p-1`, Toast/Banner dismisses `p-1`, Part-jump `px-1 py-0.5`)
8. Keyboard & focus — **FAIL** (zero `focus-visible` in SubmitConfirmation, QuestionNavigator,
   WarningOverlay, GlobalToast, Toast, Banner, ConfirmModal — per-file grep **[V]**;
   no Tab trap / no `inert` in WarningOverlay `:66-76`; **ExamSettingsDrawer has no dialog
   semantics at all** — plain divs `:358-360`, 0× `role=dialog`/`aria-modal`, close with no
   `aria-label` `:366`, tabs with no tablist roles `:371-398` **[V]**)
9. Screen reader — **partial** (good: native `<dialog showModal>` Navigator `:104-113`,
   `role=timer` + `role=status` header, Toast `role=alert` + region container; gaps: drawer
   zero semantics, tablet zoom panel trap-less `StudentHeader.tsx:231-285`, **per-second
   countdown `aria-live`** `WarningOverlay.tsx:200`, `role=alert` + `aria-live=polite`
   mismatch Toast/Banner)
10. Adaptivity — **pass** (tablet gate `tabletMode.ts:14-19`, iPadOS handling
    `appleMobileDevice.ts:1-12`, pinch-zoom explicitly preserved `examPageZoomGuard.ts:13-41`
    **[V]**, zoom clamp 0.85–1.5, exam shell on `100dvh` + safe areas)
11. Consistency — **partial** (5 dismissal grammars: Dialog Escape+overlay flags; Submit always-Escape;
    Navigator native onCancel; Warning **no Escape + auto-dismiss**; drawer buttons-only;
    **two toast stacks** GlobalToast+Toast vs sonner Toaster)
12. Forgiveness — **partial** (Submit block-policy `:92-96`, ConfirmModal close-lock `:29-32`;
    destructive tone split: Submit uses `Button danger` vs ConfirmModal hardcodes red/amber;
    drawer archives behind native `confirm()` `:1748`)

### S1 exam-HIG (1–5): selection 2 · magnification 3 · reduced-motion 2 · touch 3 ·
feedback 2 · clarity-time 3 · clarity-confirm 2 · deference 3 · depth 2 · interruption **1** · **overall 2.4**
### S3 HIG: clarity 3 · deference 4 · depth 3 · feedback 2 · interruptibility 2 · consistency 2 · a11y 3 — **19/35 ≈ 54%**
### S4 HIG: FAIL springs/velocity, press (Button-only), JS-RM, transition-specificity, focus (4 dialects,
~40 bare), 44px targets (16/22/24/28/32/36 catalogued), names/roles, keyboard, radius (5 dialects),
dark (60% locked/40% ready/0 stories); PARTIAL elevation/icons/Escape; PASS contrast-notes, error/empty/loading-except
### S2 HIG (1–5): publish-confidence 1 · status-visibility 2 · destructive-safety 1 ·
context 2 · recovery 2 · focus/motion 3 · grading-coherence 2 · export-determinism 3

---

## 3. Critical findings (unified, traceable IDs)

### 3.1 Publish / release integrity (S2-C1–C6, C12)
- **S2-C1 [V]** Ungated duplicate publish: bare `Publish draft` (`ExamReviewRoute.tsx:140-145`,
  no readiness/permission/schedule/confirm) beside gated `PublishActions` (`:190-199`).
- **S2-C2 [V]** Handler has no client gate + false audit actor: `useReviewRouteController.ts:110-123`
  (only republish checks permission `:135`); actor hardcoded `'System'` (`:116` + `:145,163,178,196,210`;
  same in `useBuilderRouteController.ts:80,111,123,135,146`).
- **S2-C3 [V]** Content-review gate is a stub: `isContentReviewed = true` (`PublishActions.tsx:106`)
  feeds modal prereqs (`:460,588`), so `allPrerequisitesMet` (`PublishConfirmationModal.tsx:123-126`)
  can never block on review; checklist display-only (`:199-208`).
- **S2-C4 [V]** Legacy drawer one-click `Publish Now` (`ExamSettingsDrawer.tsx:1497-1509`, disabled-check
  passes when readiness undefined `:1500,1568`); file marked deprecated (`:1-5`) yet mounted (only
  test + self imports found — mount path unverified, treat as mounted-but-rare) **[V]**.
- **S2-C5 [V]** Unpublish via blocking native `prompt()` (`:1512-1525`), unvalidated, bypasses confirm/audit.
- **S2-C6 [V]** `ExamPublishProvider.tsx:45-60` forwards publish/schedule/unpublish/archive with zero gating.
- **S2-C12 [V]** `ValidationSummary` is dead code (zero non-test mounts — grep **[V]**); readiness errors on the
  live route render as non-navigable `<li>` (`ExamReviewRoute.tsx:132-136`). (Corrects interim wording: its
  rows do call through; the component itself is unmounted.)

### 3.2 Authoring integrity (S2-C7–C11)
- **S2-C7 [V]** Unconfirmed block delete: `QuestionBuilderPane.tsx:140-144` filter, no confirm/undo;
  same kebab pattern `MatchingBlock.tsx:91`.
- **S2-C8 [V]** Matching key-space split: answer-key writes `h.id` (`ExamAnswerKeyRoute.tsx:507-527`)
  vs block stores/matches roman numerals (`MatchingBlock.tsx:54-68`) — grading joins can mismatch.
- **S2-C9 [V]** Silent sub-answer no-ops: `answerKeyOverview.ts:268-295` returns roots unchanged on
  malformed leafId, no feedback.
- **S2-C10 [V]** Preview persistence lie: `ExamPreviewRoute.tsx:299` claims `persistenceEnabled={false}`
  while `previewRuntimeSessionService.ts:205-229` creates a real attempt + posts real precheck.
- **S2-C11 [V]** Preview drops Science: service accepts only 4 modules (`:45-54`); ACT Science preview
  can never resolve/reuse.

### 3.3 Grading truth (S2-C13–C17, C21)
- **S2-C13 [V]** Grading prefers mutable draft: `resolveObjectiveGradingVersionId`
  (`gradingReviewUtils.ts:43-48` returns `draftVersionId || publishedVersionId`); consumers in
  `StudentReviewWorkspace.tsx:152-155`, `ObjectiveOverridesPanel.tsx:240-243`,
  `GradingSessionDetail.tsx:273-277`. Operator grades a moving target behind immutable-version copy.
- **S2-C14 [V]** Grader identity hardcoded: `GradingRoute.tsx:40-41` (`TEACHER-001` / `Sarah Chen`);
  every release/reopen attribution false (same name also in `AdminRoot.tsx:192`, `ExamsRoute.tsx:105`).
- **S2-C15 [V]** Release safety behind native dialogs: `window.confirm`
  (`StudentReviewWorkspace.tsx:468-471`), `window.prompt` for schedule date, unvalidated (`:1735-1738`).
- **S2-C16 [V]** Override save silently rewrites scoring rule ONE→THREE WORDS
  (`ObjectiveOverridesPanel.tsx:318-327`, inside save `:296-350`) with no operator consent text.
- **S2-C17 [V]** Restore/republish unconfirmed, errors logger-only: `useVersionHistory.ts:58-92`;
  compare-view restore live when B is draft (`VersionCompareView.tsx:238-246`); bare icon button
  (`ExamVersionHistory.tsx:395-407`), no undo.
- **S2-C21 [R]** Score-truth defects (grading auditor): band-0 averaged into submit
  (`GradingWorkspace.tsx:124-134`); rounding diverges (`builderEnhancements.ts:236-247` vs
  `examUtils.ts:1097-1114`); writing double-weighted (`StudentReviewWorkspace.tsx:819-837`);
  release ignores unsaved changes; audit strings hardcoded; print drops markup; internal notes leak
  to student PDF (`renderWritingLikeDefaultPrint.ts:53-57`); annotation drift; triple score truths
  (`gradingReviewUtils.ts:820-851`); blank == correct (`gradingAnswerUtils.ts:436-450`);
  ZIP dup overwrite + nondeterministic bytes; audit stubs; dead Download/Share beside live Release.

### 3.4 Bulk / scheduling / shells (S2-C18–C20, C22)
- **S2-C18 [V]** Bulk publish/unpublish/archive fire immediately (`ExamBulkActionBar.tsx:88-120,156-177`);
  only delete is two-step (`:121-155`); busy flag locks Clear selection (`:79-85`).
- **S2-C19 [V]** Scheduling has zero integrity guards: window = now+duration, ids = `sched-Date.now`,
  actors System/Admin, draft fallback (`AdminScheduling.tsx:134-174`, `ScheduleSessionModal.tsx:110-145`
  incl. `:50,182`), delete via bare confirm (`:301-305`).
- **S2-C20 [V]** Mock shells on real routes: `AdminGrading.tsx:15-27` fake queue + static counters
  (`:106-130`); `AdminResults.tsx:5-11` static rows; mounted (`createRouter.tsx:266,275`).
- **S2-C22 [R]** Bulk lifecycle/readiness drift: no preflight/undo (`examLifecycleService.ts:1890-2107`);
  no version pin (`:942-1008`); republish-under-live is warning-only (`:1201-1209`).

### 3.5 Join / session integrity (S3-C1–C3, C8)
- **S3-C1 [V]** Student password-login self-loop: student landing = `/login` (`authSession.tsx:83-84`,
  fallback `:127-136`); LoginPage navigates there post-login (`:58-61`) and bounces authed students
  there (`:31-38`); RequireAuth role-mismatch bounces staff routes to same landing (`:86-88`).
  Silent, no progress, no recovery. Fix direction: reject student creds at Login with check-in/join
  guidance, or give students a real landing — the loop is the worst option.
- **S3-C2 [V]** Queued poll failure permanently locks both join forms: catch sets `submitError` but never
  clears `queuedAdmission` (`StudentEntryRoute.tsx:327-333`); banner (`:353-359`) + error (`:347-351`)
  co-render; all inputs disabled (`:372,392,411,432,452`); submit stuck on Waiting (`:463-469`).
  Copy says "retry" but retry is impossible without reload. Same shape on access-link
  (`StudentAccessLinkEntryRoute.tsx:150-152,170-171,174-177`).
- **S3-C3 [V]** Queue ticket is memory-only (`useState`, `StudentEntryRoute.tsx:142-143`,
  `AccessLink:59-60`); persisted only on success; `ticketId/position/pollAfterMs` never persisted;
  reload guards exit on null queue. Reload/crash/tab-close loses position — no ETA, ticket ref,
  or keep-tab-open guidance.
- **S3-C8 [V]** Direct SAT join demands IELTS-only fields: entry requires
  wcode+email+studentName+nickname+ieltsCourse pre-provider (`StudentEntryRoute.tsx:208-244`,
  labels `:422-461`) while `/join/` asks code+name+email and the room branches SAT by providerKey
  (`StudentSessionRoute.tsx:89-115`). SAT students without a link hit an IELTS dead end.

### 3.6 Proctor trust (S3-C4–C7)
- **S3-C4 [V]** Alert ack is local-only and reverts on next poll: `AlertPanel.tsx:96-109` only calls
  `onUpdateAlerts` (no persist — verified vs notes/rules which use `examRepository`); `ProctorAlert`
  has no `updatedAt` (`types.ts:824-833`); `mergeById` server-wins on equal empty-string timestamps
  (`useProctorRouteController.ts:423-445`), so the server overwrites local ack every 6s detail poll
  (3s degraded). Triage trust destroyed.
- **S3-C5 [V]** `onEndSectionNow` implemented but unreachable: revision-guarded impl
  (`useProctorRouteController.ts:592-610`), wired through contracts/root/app, but Dashboard
  destructures it as unused (`ProctorDashboard.tsx:70`) — zero callers. A stuck live section cannot
  be force-advanced (or, if intentional removal, the dead chain misleads audit).
- **S3-C6 [V]** Auto-rules are promised but never fire (dead-code hazard): `evaluateViolationRules`
  (`:647-749`, exported `:776`) has **zero production callers** (only tests — grep **[V]**) while
  `ViolationRulePanel.tsx:37-122` promises automation. **Correction applied:** the earlier "fires with
  zero confirm" framing is the *conditional* risk — do NOT wire as-written (it would warn/pause/terminate
  with zero confirm/undo, `fireKey` dedupe only, always-reload).
- **S3-C7 [V]** Header always claims Live even when degraded: unconditional green pulsing Live pill
  (`ProctorApp.tsx:115-125`); connection error only adds a second Reconnecting pill (`:126-136`) —
  both can render together. `degradedLiveMode` only accelerates polling; `lastSuccessfulRefreshAt`
  never rendered on IELTS (only SAT room); WS malformations swallowed invisibly (`:555-557`).

### 3.7 SAT safety / shell (S3-C9–C10)
- **S3-C9 [V]** SAT destroy dialogs unsafe + uninformed: **static** branch autofocuses the confirm button
  (`ConfirmDialog.tsx:45-46`) while the Radix branch drops `aria-describedby` (`:109,184`) —
  Room Finish/End-attempt confirms (`:140`) focus the destructive action with no description announced.
  Fix: focus Cancel, restore describedby.
- **S3-C10 [V]** SAT room + exam detail/release/preview/access routes sit **outside** `SatRoot`
  (`createRouter.tsx:374-380` vs `:301-309,342-372`), losing skip-link/switcher/bottom-nav
  (`SatRoot.tsx:43,46-63,100-128` vs Room `:97,109`); library→access ejects mid-flow.

### 3.8 Exam-delivery integrity (S1-C1–C15)
- **S1-C1 [V]** Medium dead zone 768–1023: side-by-side row starts at `md:768`
  (`StudentMaterialWithQuestionPane.tsx:255-258`) but the resizer renders only at `lg:1024+`
  (`StudentSplitPaneResizer.tsx:36`) — 256px band with no resizer and no compact tabs.
  Layout bands verified: compact <700 / medium 700–1199 / wide 1200+ (`studentLayoutMode.ts:2-18`).
- **S1-C2 [V]** Divider 16–32px < 44pt Apple target and < 24px WCAG where hidden
  (`StudentSplitPaneResizer.tsx:35-36,56`, `splitPaneDimensions.ts:1-3`).
- **S1-C3** No resize persistence (`useSplitPaneResize.ts:44`); remount resets to 40% + material tab.
- **S1-C4 [V]** Tablet in-app zoom forced off via non-standard CSS `zoom`
  (`StudentApp.tsx:209-213,232` vs range 0.85–1.5 in `AccessibilitySettings.tsx:14-16`,
  `accessibilityPreferences.ts:31-32`) — contradicts the pinch-preserving guard. WCAG 1.4.4/1.4.10.
- **S1-C5 [V]** Proctor-warning auto-acknowledge on 30s timer (`WarningOverlay.tsx:40-45,60-64,192-204`
  → `acknowledgeProctorWarning` `StudentApp.tsx:962-974`; critical exempt only). Integrity + WCAG 2.2.1.
  NOTE: all four live WarningOverlay call sites pass `showCountdown={false}` (`StudentApp.tsx:984-1026`)
  **[V]** — the auto-ack path is armed for the proctor-warning call site (`:962-974`, default `true`),
  not the currently-mounted ones. Keep as armed-trap, not live-fire.
- **S1-C6** Live IELTS session hard-disables submit (`StudentSessionRoute.tsx:117-132` →
  workspace/footer/compact-nav); the confirm path (`StudentApp.tsx:544-587`) is unreachable in that
  configuration. **Design-intent flag:** the route comment states cohort/timeout-driven completion is
  intentional (`:126-130`) — confirm intent before calling it a stall.
- **S1-C7** Up to five WarningOverlay siblings stack with no arbitration (`StudentApp.tsx:962-1031`,
  z-100/z-220), fighting over `primaryButtonRef` focus, each with its own 30s auto-dismiss.
- **S1-C8 [V]** Split slider announces false 0–100 (`StudentSplitPaneResizer.tsx:39-45`) while the real
  clamp is pixel-based (`useSplitPaneResize.ts:51-71`, 48px minimums) and Home/End can never reach the
  ends (`:126-135` — dead branch reassigns same bounds `:61-68`). WCAG 4.1.2.
- **S1-C9** No keyboard highlight path (capture pointer-only `useHighlightSurfaceV2.ts:93-104`;
  surface non-focusable `HighlightableSurface.tsx:39-47`; erase pointer-only
  `StudentHeader.tsx:413-428`). WCAG 2.1.1/2.5.1.
- **S1-C10** Zero highlight SR semantics (mark = className+data only `highlightV2Engine.ts:373-377`;
  only live regions are limit-toast + mode announcer). WCAG 1.3.1/4.1.2/4.1.3.
- **S1-C11** Persisted ranges unvalidated (shape-only `highlightStore.ts:21-42`, trust-on-hash-match,
  djb2-xor36 hash, quota swallow, MAX200 add-time-only → load-time DOM blowup).
- **S1-C12** Capture-vs-render offset divergence + toggle orphans (canonical includes mark text;
  dual Reading canonicals; `useId` surface IDs unpersistable).
- **S1-C13** No phase-change focus management (renderer swaps trees, skip-link only; PreCheck auto-fires
  silently; Lobby start never focused). WCAG 2.4.3/4.1.3.
- **S1-C14 [V]** Timer is `role=timer` with no live region + urgency color-only <300s
  (`StudentHeader.tsx:329-338`, `CompactStudentHeader.tsx:93-111`); per-second ticks re-render the
  whole header. WCAG 1.4.1/4.1.3.
- **S1-C15** V1+V2 highlight engines/keys live together (orphan/quota/migration risk).

### 3.9 Design-system blockers (S4-C1–C7)
- **S4-C1 [V]** SAT-only dark mode: `@media (prefers-color-scheme: dark)` at `index.css:2735` covers
  `.sat-*` only (`:2739-2816` — verified); zero dark values for Notion ramps/shadcn roles/exam roles;
  no `.dark` class, no ThemeProvider (`useTheme` only in `sonner.tsx:7`); body hardcoded light (`:350`).
- **S4-C2** AA-text failures: au-warning 3.19, au-success 3.77, gray-500 4.48 (4.17 on gray-50) as Secondary
  (`:106`, inherited `:227,248`), gray-400 2.81 Tertiary (`:107`), blue-600 3.88 as
  primary/ring/hierarchy/focus. Only `*-text` variants pass; dark disabled pair 3.48 fails even 3.0.
- **S4-C3** 1091 raw gray/white/slate utilities bypass tokens; dark mode via `!important` substring hacks
  (`:2824-2868,1462-1468`).
- **S4-C4 [V]** Stimulus toolbar: 11 icon-only buttons, zero `aria-label` (grep **[V]**,
  `StimulusPane.tsx:220-231`); editor `contentEditable` with no role/name, placeholder via
  data-attribute only, `outline-none` with no focus-visible.
- **S4-C5** QB block-select is a mouse-only `div onClick` (`QuestionBuilderPane.tsx:707-712`,
  orphans `:754-761`) + two hand-rolled modals with no dialog semantics/Escape/trap
  (`:785-841,843-852`); Writing delete confirm likewise (`WritingTaskPanel.tsx:315-339`).
- **S4-C6** Target-size catalogue: sheet close ~16px (`sheet.tsx:78-81`); dismisses ~24px;
  Dialog/Drawer closes ~28px; Stimulus/Header `p-2` 32px; Workspace/Writing `p-1` ~22–24px;
  Tabs `h-9`; checkbox 16px; switch 18/14px.
- **S4-C7** Zero ref-forwarding ×9 (Input, Textarea, Select, Banner, Toast, Dialog, Drawer, FormInput,
  DataTable); only `shared/Button.tsx:27` forwards.

---

## 4. Major findings (grouped)

### Publish/config/scheduling (S2-M1–M4, M9–M13)
Timezone/format hazards (drawer UTC-min vs naive datetime-local; day buckets by createdAt — M1);
dead Save Profile + fire-and-forget defaults (M2); three diverged config editors + dirtyRef sync block
(M3); bulk dialog counts-only, silent restore fail, delete-via-alert (M4); builder has zero
`beforeunload` while SAT does (M9); null actor disables durability + durable-fail still saves (M10);
undo dirties autosave (M11); review restore/republish unconfirmed (M12); answer-key orphans hidden (M13).

### Grading/exports (S2-M5, M14[R])
Preview drops inputs + overlap-unsafe (M5); version-load races, orphan schedules, stale windows,
hardcoded cohorts, dual band math, unclamped bands, screen-vs-PDF matrix, PII manifest, filename
collisions, filter-ignored exports, chart distortion (M14 — subagent-reported).

### Proctor/auth/SAT (S3-M1–M20)
No availability gate on direct entry vs link's best-in-scope empty states (M1); error CODE dropped,
substring sniffing, title drift (M2); `next` dropped on index/activate/reset redirects + register
mismatch + NotFound dead end (M3); wcode regex split + over-permissive tail (M4); polling/WS/clock
parity gaps — IELTS ticks 1s, SAT room renders raw remaining, queue floors differ 300 vs 500, no
cap/timeout/offline handling (M5); status vocab drift across 4 surfaces (M6); presence
fire-and-forget + trap-less collision modal + Cancel loses drawer (M7); bulk warn/resume skip confirm
while pause/terminate require it (M8); proctor recovery weaker than SAT room (M9); roster hover-only
actions inside faux button, no aria-sort (M10); room label/tone conflation + suppressed describedby +
no typeahead (M11); anonymous fallback lands on staff login + auto-resume race (M12); token flows lack
empty/resend states + reset-request co-render (M13); dual toast stores, zero store emits from
proctor/SAT, unwired routes show nothing (M14); global pending freezes all room actions (M15);
search auto-select swaps detail mid-review (M16); New-Session silent return + masked exam-fetch failure
(M17); past-start validation missing (M18); bucket auto-flip mid-task + terminal room with no exit +
extend double-fire (M19); results/library/mobile gaps (M20).

### Student delivery (S1-M1–M20)
Dual tablet definitions (M1); 48px minimums + dead clamp branch (M2); ephemeral layout state (M3);
compact tabs aren't tabs + silent auto-switch (M4); palette id/label mismatch (amber=Pink) + pastel-only
1.1–1.3:1 contrast, no forced-colors (M5); compact/wide contract divergence (M6); dual shell/main +
post-exam drops shell, skip-link instability (M7); six dialog patterns, backdrop-click close, no inert
(M8); keyboard-submit vs button-confirm disagreement (M9); interruption handling contradicts entry promise,
no reconnect UI (M10); entry errors unassociated vs access-link's wired ones, no inputmode/autocomplete
(M11); motion everywhere with dead helper + CSS-kill only (M12); three zoom systems, 200% clips (M13);
iOS long-press race + suppressed callout (M14); native inputs bypass Protected guards + 16/20px targets
(M15); three sanitizer paths + innerHTML round-trip (M16); cross-block reject-by-code vs allow-by-comment,
silent null mimics broken tool (M17); writing minimums fight clamp (M18); dup normalization + passthrough
(M19); Speaking surface gaps + dead exam-height var (M20).

### Design system (S4-M1–M10)
3+2 overlays (Dialog trap vs Drawer Escape-only vs Radix sheet vs QB/Writing hand modals; 3 scrims;
Modal drops 3 props; Drawer 0 consumers) (M1); 3 toast stacks (custom alert+polite conflict + slide;
sonner 0 renders + bad vars; GlobalToast null-unmounts region + concentricity break) (M2); Badge/
StatusBadge, Input/FormInput (0 consumers — port its aria, delete fork), DataTable-vs-table + dead
sortable + N×M cell buttons, Countdown 0 consumers, 5 incoherent skeletons + forced h-screen (M3);
barrel 17/39 → 3 import dialects; rule "Radix = asChild/ref/cn/native, hand-rolled = none" (M4);
`transition-all` default incl. +150 admin hits (M5); JS motion unguarded + forked press scales (M6);
4 focus-ring dialects + ~40 bare chrome buttons + `focus:`-for-`visible:` (M7); palette double-Escape/
double-focus/button-role-option/hover-steal, Writing menu without roles, 7 unassociated labels,
PopoverTitle/Card titles as divs, unfocusable table scroll, Sidebar div-nav, unhidden chevron (M8);
6 status authorities, exam never dark, sat-only magenta, 3 warning browns (M9); forked ladders — radii
(2 scales + 15 breaches), elevations, tints (rgba vs color-mix 8/16 vs 18/28), fills ×4, surfaces ×4,
hairlines ×5, type ×3, fonts ×6, durations (flush 420 > 260 ceiling), hi-contrast divergence (M10).

---

## 5. Minor findings (grouped)

- **S1-m1–m20:** slider PageUp/Down + lying Home/End; tablet divider RTL drift; no sighted % readout;
  zoom safe-area gaps; chart keys; 30px submit close; header overflow-x focus clip; escapeHtml ×3 drift;
  empty-id collisions; singleton observer leaks preview+live; undismissable hint toast over footer; heavy
  inline shell styles; Speaking without highlight/zoom (document if intentional); heading-heuristic offset
  shift; dead height var; hardcoded blackout copy; PreCheck item-less fail; unclamped negative timer;
  compact "–" vs 0/N; hardcoded IELTS strings incl. stored post-exam refresh bounce.
- **S2-N1 + authoring/grading minors:** AdminExams dates/sort misorder; binary-diff compare + color-only
  states; toolbar without live region; clone/compare without dialog semantics; AcceptedAnswers dup + seed
  invariant; SubAnswer heal loop; recovery module-only; preview URL replaced; 220ms editing mask; hidden
  j/k shortcuts; readiness skipped when published_current; CSV header-only + 64-row truncate; ISO dates;
  unsanitized ZIP base; traceback join break; overstated case-insensitivity.
- **S3-m1–m12:** four auth visual languages; pending-copy drift; error-role gaps (only AccessLink has
  alert + aria-invalid); loading/join/title vocab fragments; silent auto-resume + shared-device PII
  prefill; thin New-Session validation; terminal room hides primary; zero reduced-motion in scope; proctor
  Settings correctly unmounted but no reachable prefs; danger-red/badge/wording drift; unbounded history
  dump; invisible saved filter criteria; duplicate login entries; missing isMounted guards; first-issue-only
  validation loops.
- **S4 minor + chrome nits:** Select `size:number` hijack; icon-size scatter 10–20px; tooltip offset 0;
  dropdown spread fragility; weak scroll thumb; ErrorSurface button without type/ring; Header focus-border-only;
  Workspace duplicated offsets; Stimulus gradient wash; dead stories template; AppShell thin-Outlet OK
  (no boundary/skip-link).

---

## 6. Token-violation table (S4, first-hand)

| # | Violation | Evidence |
|---|---|---|
| T1 | No dark for core/exam/shadcn | `index.css:102-279` vs `:2735-2802` sat-only; body `:350`; no .dark/ThemeProvider |
| T2 | Text-contrast AA fails | warning 3.19 / success 3.77 / gray-500 4.48 / gray-400 2.81 / blue-600 3.88 → gate text to `-text` |
| T3 | 1091 raw utilities + `!important` hacks | `:2824-2868`, `:1462-1468` |
| T4 | Surfaces×4 / hairlines×5 / fills×4 / tint fork | one authority needed |
| T5 | Radii 2 scales + 15 breaches | `:94-98` "no in-betweens" vs `:1600/1611/1661/1699/1705/1084` |
| T6 | Elevations 2 systems, fragile aliases | `:287-294` vs scoped systems |
| T7 | Durations forked, no springs, ceiling breach | flush 420ms `:2708` > 260 ceiling |
| T8 | Focus rings ×4 + dark-glow | `:379 / :1361 / :1472 / :2053` |
| T9 | Structural hex/rgba outside `@theme` | body/scrims/selections/shadows |
| T10 | Hi-contrast class vs query divergent | `:430-457` vs forced-colors `:2910-2953` (only complete remap) |

## 7. Primitive matrix (S4 — rule of thumb)

**Radix files** (checkbox, dropdown, label, popover, progress, scroll-area, separator, switch, tabs,
tooltip, sheet): uniformly asChild/ref/cn/native-aria. **Hand-rolled** (Input, Textarea, Select,
Banner, Toast, Dialog, Drawer, FormInput, DataTable): uniformly lack ref+cn, mix aria, overuse
`transition-all`. Exemplars: shared **Button** (6 variants/3 sizes, isLoading-disables, SR loading
text, press scale, specific transitions); **FormInput** (best field a11y — port into Input, delete
fork); **DataTable** (best built states, worst cell-stop farm + dead sortable). Stories: 8 exist,
31/39 modules uncovered, zero dark/reduced-motion/hover-focus matrices.

## 8. Consistency gap tables (status)

- **Highlight engine:** single-engine PARTIAL (V1 names linger) · stable keys FAIL (useId, empty-id
  collisions, toggle orphans) · palette FAIL (amber=Pink, pastel-only) · surface resolution PARTIAL
  (silent cross-block reject) · sanitize FAIL (3 paths) · keyboard 2.1.1 MISSING · SR 4.1.3 MISSING
  (mode-only) · contrast/non-color FAIL · HC MISSING · pinch PASS (exemplary guard) · 200% reflow FAIL ·
  in-app zoom PARTIAL (tablet-only + forced-1) · deliberate RM variants MISSING · slider 4.1.2 FAIL ·
  compact tabs FAIL · timer FAIL (color-only, silent) · dialogs PARTIAL (3+ patterns) · phase focus FAIL ·
  register route FAIL (redirect, not view) · resize persistence MISSING.
- **Publish/release:** role gate PARTIAL · validation-blocks-release PARTIAL · confirm modal SPLIT
  (builder only) · release API SPLIT (SAT strict vs IELTS lifecycle) · compare/restore present-but-unsafe ·
  rollback PARTIAL (System actor + silent fails) · scheduling MISSING · bulk confirm/undo/retry MISSING
  except delete · config coherence DIVERGED ×3 · answer-key PARTIAL · autosave present-with-gaps ·
  preview fidelity PARTIAL · import PARTIAL · objective pin FAILED (prefers draft) · subjective
  present-UI/false-attribution · annotations present-but-lossy · exports present-but-weak ·
  results queue MISSING (mocks on real routes) · SAT authoring release PRESENT — the exemplar to copy
  (`SatAuthoringRoute:10-22`, `SatDeliveryReleaseRoute:19-82`).

## 9. User-path table (S3 P1–P28, condensed)

Staff login (P1) → guard+return (P2) → SAT chain library>access>sessions>room (P3) · Direct check-in
(P4) / access-link join (P5) → queued admission (P21: banner → auto-poll → navigate; poll-fail
dead-ends; reload loses ticket) → student session IELTS-locked wrapper or SAT branch (P20; no offline) ·
IELTS monitor>intervene (P6; auto-rules dead) → cohort controls (P7; End-section missing) → alert triage
(P8; acks revert — re-ack doomed) → notes (P9) → presence/collision (P10; silent fail, trap-less modal) →
freshness (P11; Live unconditional) → IELTS>SAT switch (P12) → SAT buckets>room>controls (P13; clock
unticked) → library/results/detail/access (P14) → answer history (P15; error without retry) → prefs
(P16; proctor/SAT none) → palette (P17) → activate (P18) / reset request+complete (P19; co-render,
no resend) → wrong-code/bad-schedule/network matrix (P22) → register alias (P23) → expiry/401 (P24) →
error/toast shell (P25; dual stores) → destroy confirm (P26; focus-unsafe) → New-Session (P27; silent
return, masked fetch fail) → completed-room terminal (P28; no exit). Solid keeps: open-redirect +
role-confusion guards, double-submit guards, 401 split, link availability matrix, room stale discipline,
bucketing + per-bucket empty copy, SAT alertdialog discipline, palette focus restore + cap 50.

## 10. Prioritized probes (fix order, no code changed in this audit)

**P0 — integrity & safety:** gate every irreversible action on fresh readiness + explicit scope confirm
(publish/republish/restore/bulk/schedule/release); pin grading + exports to immutable published
versions; restore true actor identity (remove System/TEACHER-001); unmock or unmount AdminGrading +
AdminResults; fix student-login fate (reject-with-guidance or real landing); clear queued state on
poll error with Retry/Leave-queue + persist ticket + Cancel/Edit + ETA + live region; persist alert ack
(+ updatedAt) and fix server-wins merge; decide auto-rules (remove promise OR opt-in + confirm + audit +
undo — never silent) and wire-or-remove `onEndSectionNow`; remove warning auto-ack (or explicit opt-in);
restore tablet zoom; build keyboard highlight + announce channel; fix capture/render canonical + stable
IDs; add phase-change focus/announce; fix SAT destroy-dialog focus + describedby; bring SAT room (and
exam subroutes) into SatRoot shell or record the exception.
**P1:** slider value semantics + clamp honesty; palette contrast + HC/forced-colors; cross-block policy
(one rule, surfaced); zoom/reflow story incl. desktop; shell/main unification; Protected-guard adoption
for native inputs + target sizes; single sanitize path; single toast system (or explicit boundary) with
proctor/SAT wired; truthful Live/degraded pill + rendered freshness age; presence failure UI + trapped
collision modal; confirm bulk warn/resume; direct-entry availability gate + IELTS/SAT field split;
preserve error.code end-to-end; tick SAT clock off the authoritative deadline; preserve `next` in
index redirects.
**P2:** everything in §5; V1 highlight purge; observer retune; desktop in-app zoom; entry copy/maps;
unified vocab (status/loading/error/join) + role=alert + aria-invalid + focus management; dim disabled
Sign In; star-route recovery; reduced-motion cross-fades; token empty-states with re-request; terminal
room exit affordance; per-action (not global) pending states; bucket-flip freeze during tasks.

## 11. Verification notes & corrections (lead auditor)

1. **ValidationSummary:** interim wording corrected — its rows do call through; the finding is stronger:
   the component has zero production mounts (dead code) and the live route renders non-navigable `<li>`.
2. **Live-submit "stall" (S1-C6):** flagged with design-intent caveat — the route comment declares
   proctor/timeout-driven completion intentional; confirm intent before treating as bug.
3. **Auto-ack blast radius (S1-C5):** narrowed — all four live call sites pass `showCountdown={false}`;
   the auto-ack is an armed trap (default `true`, wired to the proctor-warning path), not live fire.
4. **Auto-rules (S3):** corrected across versions — current risk is *promised-but-dead*, with the
   zero-confirm variant as the conditional "do not wire as-written" hazard. Zero production callers
   verified by grep.
5. **ExamSettingsDrawer mount:** only test + self imports found; "deprecated yet mounted" kept with
   mount-path-unverified caveat.
6. **S2-C21/C22, M14, S1-M Crest details, S3-M15–M20 internals:** carried as **[R]** — precise file:line
   citations from specialist subagents, not independently re-read.

## 12. Evidence index

- S1 final: 15 Critical / 20 Major / 20 Minor + HIG 2.4/5 + gap table (session report).
- S2 final: C1–C22 + M1–M14 + minors + HIG + gap table + bottom line (session report, 4 parts).
- S3 v3: 10 Critical / 20 Major / 12 Minor + HIG 19/35 + P1–P28 + keep/probe lists (session report).
- S4 final: C1–C7 + M1–M10 + T1–T10 + primitive matrix + HIG + stories (session report).
- S5: 12-pillar scorecard + Top-8 + cross-surface patterns (session report).
- First-party spot verifications this round: AlertPanel ack path, ProctorAlert type, mergeById,
  ConfirmDialog focus/describedby, router SAT-outside-SatRoot, SatRoot chrome, auto-rule zero-callers,
  presence join, bulk warn/resume gating, layout breakpoints, MaterialPane row, resizer lg-gate,
  tablet definition, C1/C2/C3/C8/Timer/Dialog/Drawer/Toast/Submit/Warning excerpts (prior rounds).

## 13. Fix-round closure (deepswe-consistency, 2026-09-05)

Loop run: requirements (this report, per-ID) → repo map → per-area plan → patch
(6 fix agents + lead gap-closure) → verify (`tsc --noEmit`, targeted + broad vitest)
→ gap analysis → this closure. Every agent DONE-claim was re-verified against the
tree (grep/diff/tests/tsc); false completions were corrected, real improvements kept.

### 13.1 Criticals — all FIXED and verified

- **S1-C1** medium dead zone: compact tabs below lg/1024, resizer `lg:flex` at/above —
  no band without a control (`studentLayoutMode.ts`, `StudentSplitPaneResizer.tsx`).
- **S1-C2/C8** slider semantics: 24px hit area, `aria-valuemin/max/now/valuetext`
  mirror the real pixel-clamp range via `splitBounds` (`StudentSplitPaneResizer.tsx`,
  `useSplitPaneResize.ts`); Home/End clamp honestly.
- **S1-C3** resize persistence: sessionStorage per-pane keys (`ielts-split-pane:*`),
  compact-tab persistence, lazy-init + clamped load (`useSplitPaneResize.ts`,
  `StudentMaterialWithQuestionPane.tsx`, Reading/Listening/Writing/Speaking/Science
  via `StudentExamWorkspace` ← `StudentApp`).
- **S1-C4** tablet zoom: forced `zoom: 1` removed — user zoom applies on all devices
  (`StudentApp.tsx`); pinch guard untouched.
- **S1-C5** warning auto-ack: countdown-zero effect deleted; countdown is
  informational-only, explicit action required (`WarningOverlay.tsx` + test).
- **S1-C9/C10** highlight keyboard + SR: surface `tabIndex=0`, Alt+H to highlight
  selection, polite announcer; `<mark>` carries `aria-label` with color+text so color
  is never the only channel (`HighlightableSurface.tsx`, `useHighlightSurfaceV2.ts`,
  `highlightV2Engine.ts`).
- **S1-C11** range validation: `validateHighlightRanges` (finite bounds, end>start,
  in-range, palette color, non-empty slice, cap 200 + warn) wired into load paths
  (`highlightV2Engine.ts`, `highlightV2Persistence.tsx` + tests).
- **S1-C13** phase focus: focus moves to the new phase heading + SR announcement on
  every phase change (`StudentExamPhaseRenderer.tsx`).
- **S1-C14** timer: per-second container `aria-live=off`; sr-only announcer fires only
  at 5-min/1-min thresholds; urgency via icon + 'Low time' text (`StudentHeader.tsx`).
- **S1-M5** palette: Amber is a true amber ramp distinct from Yellow; marks legible
  under forced-colors (`highlightPalette.ts`, `index.css`).
- **S2-C1** ungated publish: bare `Publish draft` gone — all flows through gated
  `PublishActions` (`ExamReviewRoute.tsx`).
- **S2-C2** false actor: `System` eliminated from all builder controllers — session
  identity via `resolveStaffActor`, sign-in-required blocks (`useReview/Builder/ConfigRouteController.ts`).
- **S2-C3** review stub: `isContentReviewed` derived from readiness (no blocking
  issues); modal requires explicit attestation checkbox before confirm
  (`PublishActions.tsx`, `PublishConfirmationModal.tsx` + test).
- **S2-C4** drawer publish: deny-by-default on readiness (`ExamSettingsDrawer.tsx`);
  archive via `ConfirmModal`, unpublish via validated inline dialog (no
  `window.confirm/prompt`).
- **S2-C6** provider gating: `ExamPublishProvider` deny-by-default `canPublish`,
  `{confirmed:true}` required for unpublish/archive.
- **S2-C7** block delete: confirm modal before delete (`QuestionBuilderPane.tsx`).
- **S2-C8** matching key-space: roman-numeral agreement answer-key↔block.
- **S2-C9** silent no-ops: malformed leafId throws with shape guidance.
- **S2-C10** preview honesty: persistence flag reflects real answer-sync state.
- **S2-C11** preview Science: accepted as a first-class module.
- **S2-C12** dead summary + dead rows: component deleted; live readiness issues are
  navigable buttons jumping to the failing builder section (`ExamReviewRoute.tsx`).
- **S2-C13** draft-first grading: published-first pin (`gradingReviewUtils.ts`,
  `StudentReviewWorkspace.tsx`, `ObjectiveOverridesPanel.tsx` + pin test).
- **S2-C14** false grader: session identity, `Unknown grader` fallback + banner +
  disabled release actions (`GradingRoute.tsx`).
- **S2-C15** native release dialogs: app-modal confirmations.
- **S2-C16** silent rule rewrite: save blocks on scoring-rule upgrade until the
  operator checks the explicit consent box (`ObjectiveOverridesPanel.tsx`).
- **S2-C17** restore safety: confirm-before-restore owned by `ExamVersionHistory`.
- **S2-C18** bulk fire-now: publish/unpublish/archive join delete in two-step inline
  confirm (`ExamBulkActionBar.tsx` + tests).
- **S2-C19** scheduling integrity: collision-resistant ids, session actor
  (`AdminScheduling.tsx`, `ScheduleSessionModal.tsx`).
- **S3-C1** login loop: students get check-in/join guidance, never a `/login`
  self-loop (`LoginPage.tsx` + test).
- **S3-C2/C3** queue lock + ticket loss: poll failure clears to Retry/Leave recovery;
  ticket persisted to sessionStorage and resumed on remount; 500ms floor, guards
  (`StudentEntryRoute.tsx`, `StudentAccessLinkEntryRoute.tsx` + 17 tests).
- **S3-C4** ack revert: local ack stamps `updatedAt` so `mergeById` keeps it;
  type extended (`AlertPanel.tsx`, `types.ts`).
- **S3-C5** dead end-section: reachable control + confirm behind revision-guarded
  handler (`ProctorDashboard.tsx` + test).
- **S3-C7** Live-always pill: single derived Live/Degraded/Reconnecting/Offline state
  with freshness age (`ProctorApp.tsx`).
- **S3-C8** SAT field wall: SAT requires code+name+email only; availability gate
  (`StudentEntryRoute.tsx` + test).
- **S3-C9** destroy dialogs: Cancel-focused, describedby restored (`ConfirmDialog.tsx`).
- **S3-C10** SAT room outside shell: `sessions/:scheduleId` now nested under `SatRoot`
  (`createRouter.tsx`).
- **S3-M3** `next` preservation: index/activate redirects keep `?next=`;
  `/register` renders `StudentRegistrationRoute` directly.
- **S4-C1** dark mode: core/exam/shadcn dark vars under `prefers-color-scheme`
  (`index.css`). **S4-C2** AA text: `-text` variants for gray/blue/au pairs.
- **S4-C4/C5** Stimulus + QB: labelled toolbar/textbox, real `aria-pressed` block
  buttons, dialog semantics + Escape on overlays.
- **S4-C6/C7** targets + refs: 24px+ dismisses, forwardRef across the 9 primitives.

### 13.2 Deliberately NOT changed (recorded exceptions)

- **S1-C6** live-submit disable: route comment declares proctor/timeout-driven
  completion intentional — needs product confirmation before touching.
- **S1-C7** overlay arbitration: all live call sites already pass
  `showCountdown={false}`; no live stacking observed — left as-is.
- **S3-C6** auto-rules: promised-but-dead by design decision — must NOT be wired
  as-written (zero-confirm warn/pause/terminate); needs opt-in + confirm + audit
  + undo design first.
- **S2-C20** AdminGrading/AdminResults mocks: still mounted; unmock-or-unmount
  needs backend scope beyond this frontend round.
- **S2-C21/C22, S2-M14, S3-M15–M20 internals**: carried as **[R]**; spot-verified
  only where touched.

### 13.3 Verification evidence

- `npx tsc --noEmit`: **zero errors** (final).
- Audit-area suites (warning, login, grading pin, queue ×17, proctor ×29, builder
  controllers + publish modal, highlight persistence, layout): **31 files / 234 tests pass**.
- Builder+grading+admin+SAT broad: **54 files / 266 tests pass**.
- Full student+ui+bulk+pin sweep: only 2 transient highlight-persistence failures
  under parallel load; isolated re-run **16/16 pass** (no code change needed).
- Pre-existing tree drift (unrelated backend deletions, ~245 changed files vs HEAD)
  was left untouched; only audit-owned hunks were edited.
