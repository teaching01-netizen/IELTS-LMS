# Phase 05 — Submitting language + final verification

> Stage: PLAN ONLY (no implementation). Depends on Phases 01–04.
> Scope: submitting copy/pattern delta + repo-wide verification ONLY.
> No backend change. No finalize singleflight / submissionId change.
> Source of root causes: overall-plan R6 + DoD §6.

## 0. Objective

Close R6 and prove the whole SAT loading program repo-wide:

1. **Unify the two submitting patterns into one language** with a crisp
   single-pattern rule (when full-screen vs when inline overlay), converging
   all user-visible submitting strings onto `SAT_COPY` keys (exam-stress-safe,
   minimal copy change).
2. **Prove repo-wide**: single live region during submitting, no flicker
   (no valid-UI → full-screen-spinner swap), no regressions
   (IELTS / staff / preview untouched), and green gates:
   `tsc` + scoped `eslint` + affected `vitest` + full SAT suites +
   Playwright SAT smoke (+ a11y single-live-region).

Out of scope for this phase (must already be done by 01–04):
- Loading contract / `SatLoadingKind` (01), bootstrap waterfall / seed (02),
  tool-prewarm gating / bare branches (03), runner convergence / calm polling /
  `candidateId` identity fix (04). This phase touches ONLY the submitting
  branch + copy table + tests that assert them + the verification run.
- No spinner visual redesign, no token rename, no new stores, no payload change.

---

## 1. Dependencies — assumptions from Phases 01–04

Phase 05 MUST NOT start until each assumption below holds. If any fails,
send the phase back to the owning phase (see §10).

| # | Assumed done | Where it lives | How Phase 05 relies on it |
|---|--------------|----------------|---------------------------|
| A01 | `SatLoadingKind` contract (`initial \| module-refresh \| finalizing`) exists; `SatLoadingSurface` is the ONLY full-screen loader | `src/features/student-delivery/ui/feedback/SatStateSurfaces.tsx:47-67` + `src/features/student-delivery/domain/satCopy.ts` (Phase 01) | Submitting non-error branch renders `SatLoadingSurface` with kind=`finalizing` label only; no new loader component is introduced here |
| A02 | Hidden Desmos prewarm emits NO `role=status` and mounts ONLY where exam chrome can exist | `DesmosCalculator:26-28,67-86,87-104`, `SatCalculatorPanel:69,102,114`, `SatFloatingTool:159-167,202-210` (Phases 01+03) | Live-region count during submitting is meaningful (no hidden Desmos `*2` polluting the count) |
| A03 | SAT-skinned first paint; parent never shows admin skeleton for `providerKey=sat` past auth; child accepts seed / dedupes 3rd fetch | `StudentSessionRoute.tsx:49-51`, `useStudentSessionRouteData.loadStudentData`, `useSatExamController.ts:189-207` (Phase 02) | Verification "cold open = exactly one SAT surface" is attributable to submitting work, not re-litigating the waterfall |
| A04 | Bare loading/error branches (no `withCalculatorHost` / no hidden tool trees under loader or error) | `SatStudentSessionRoute.tsx:133-197,177-197` host + all `withCalculatorHost(...)` call sites (Phase 03) | Submitting branch keeps whatever bare/host wrapping 03 decided — 05 does NOT re-scope the host; it only changes copy + which surface renders |
| A05 | Atomic data+phase transitions; transient skew holds previous UI; polling skips identical revisions; `state.candidateId` trustworthy | `useSatExamController.ts:137-164,226-274,841-859`, `satRunnerReducer.ts`, `satRuntimeSelectors` (Phase 04) | Copy-matrix tests can deterministically drive `phase=submitting` vs `isSubmitting` without flake from skew; retry path semantics below are stable |
| A06 | Retry seam from defect-2 work exists and stays: `retryFinalization` valid in `phase=submitting` OR terminal-recovery directions state; singleflight in `finalizeAssessment`; stable `submissionId=attemptId` | `useSatExamController.ts:555-600` (singleflight), `:749-771` (`retryFinalization`), `:730-743` (`recoveryNeedsRetry`), `:602-637` (recovery effect), route `:220-250` directions secondary action | 05 MUST NOT change this behavior — only the copy that labels it. Any edit that touches the gateway call, dedupe key, or guard is out of scope and a repair trigger |

Non-negotiable invariants for every step in §4:
- `finalizeAssessment` singleflight via `finalizationInFlightRef` stays exactly as-is.
- Server call stays `satDeliveryGateway.submitAssessment(scheduleId, attemptId, { submissionId: attemptId })` (`useSatExamController.ts:567-569`).
- `retryFinalization` guard stays `((phase !== "submitting" && !recoveryNeedsRetry) \|\| isSubmitting) → return` (`:750`).
- No new backend endpoint, param, or payload field.

---

## 2. Affected / new files (submitting branch + copy table ONLY)

### 2.1 Files the implementer MAY touch

| File | Lines (as inspected 2026-09-11) | Allowed delta |
|------|---------------------------------|---------------|
| `src/features/student-delivery/routes/SatStudentSessionRoute.tsx` | submitting branch `:265-306`; directions terminal-recovery `:220-250`; inline overlay `:400-410`; host `:133-197` (read-only) | Copy refs only: replace the 6 hardcoded submitting strings with `SAT_COPY` keys; wire `SatSubmissionOverlay` props to the same keys. NO branch-structure change except passing already-computed `exam.autoSubmitted / exam.answersRecorded / exam.isSubmitting / error` through. NO host re-scoping (03 owns it). |
| `src/features/student-delivery/ui/feedback/SatControlFeedback.tsx` | `SatSubmissionOverlay` `:58-86` (defaults `:59-61`, `resolvedTitle` `:68`, surface `:70-75`) | Change defaults to reference `SAT_COPY.submit.*` (import already present `:2`). Keep props + classNames + `role="status" aria-live="polite" aria-atomic="true"` byte-identical. Add optional `note` default from copy; do NOT add new props unless a copy-matrix test requires it. |
| `src/features/student-delivery/domain/satCopy.ts` | `submit:` block `:84-91` | ADD at most 4 keys (see §3.1 table). Do NOT rename or reword existing keys (`timeExpiredFinalizing`, `finalizingResponses`, `submitting`, `almostUp`). New keys follow existing punctuation: em dash `\u2014`, ellipsis `\u2026`. |
| Tests (may create/edit) | see §7 | Copy-matrix test, single-live-region test, keep/extend `sat-finalization-recovery.test.tsx` assertions for labels. No prod-code behavior change to satisfy tests — tests assert the converged copy. |

### 2.2 Files the implementer MUST NOT touch (read-only evidence)

| File | Why it is read-only in Phase 05 |
|------|---------------------------------|
| `src/features/student-delivery/hooks/useSatExamController.ts` (`:555-600, :639-728, :749-771, :880-897, :992-996`) | Finalize singleflight, `submitModule` pipeline, `retryFinalization`, `setAutoSubmitted(true)` on timeout, `setAnswersRecorded(true)` after flush+submit ack — behavior frozen. Read to get flag semantics for the copy matrix only. |
| `src/features/student-delivery/application/satRunnerReducer.ts` (`:234-244`) | `submit` (review→submitting) / `completed` (submitting→complete) transitions frozen. |
| `src/features/student-delivery/ui/SatExamShell.tsx` (`:250-268` inert, `:423-429` `SatSaveStatus` outside inert) | `blocked`→`inert` wiring + save-status placement frozen. Read to state live-region ownership. |
| `src/features/student-delivery/ui/feedback/SatSaveStatus.tsx` (`:35-114`) | Save states (`idle/saving/offline/retrying/failed/superseded`) frozen. Read to prove no competing live region during submitting. |
| `src/features/student-delivery/ui/feedback/SatStateSurfaces.tsx` (`:47-67` loading, `:13-45` error) | Surface semantics frozen (01 owns). |
| `src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx` (`:18-24, :118-127`) | Terminal-recovery secondary action frozen except its LABEL key (which converges per §3.1). |
| `src/features/student-delivery/ui/review/SatReviewPage.tsx` (`:67, :170`) + `domain/satSubmitReadiness.ts` | Review submit button copy (`SAT_COPY.submit.submitting` while `isSubmitting`) frozen — must keep passing. |
| Backend, gateway, persistence engine, IELTS / staff / preview routes | Explicit non-goals. Any diff here fails the gate. |

---

## 3. Contracts / interfaces

### 3.1 Submitting copy matrix (the normative table)

After Phase 05, EVERY user-visible submitting string comes from `SAT_COPY.submit`.
Existing keys are reused verbatim; new keys are additive (names proposed — implementer
keeps names only if review agrees; VALUES below are exact, including punctuation):

| # | Situation | State predicate | Surface | Exact string (or key) |
|---|-----------|-----------------|---------|-----------------------|
| C1 | Manual final submit, final module, no error | `phase === "submitting" && !error && !autoSubmitted` | Full-screen `SatLoadingSurface` (route `:301-305`) | `SAT_COPY.submit.finalizingResponses` = `"Finalizing SAT responses\u2026"` (already exists `:89`) |
| C2 | Timeout auto-submit, final module, no error | `phase === "submitting" && !error && autoSubmitted === true` | Full-screen `SatLoadingSurface` | `SAT_COPY.submit.timeExpiredFinalizing` = `"Time expired \u2014 submitting your saved answers."` (already exists `:88`) |
| C3 | Mid-exam module submit, shell still mounted (module/review awaiting ack) | `phase === "module" \| "review" && isSubmitting === true` (route `:410`) | Inline `SatSubmissionOverlay` over inert shell | Title: C1 or C2 by `autoSubmitted` (SAME keys — overlay default `title="Finalizing module…"` is DELETED and replaced by `finalizingResponses`); note: new `SAT_COPY.submit.finalizingNote` = `"Your latest responses are being verified."` (moved verbatim from overlay default `:60`) |
| C4 | Finalization failed AFTER answers recorded (flush + V2 submit acked, result generation failed) | `phase === "submitting" && error && answersRecorded === true` (route `:277-284`) | Full-screen error panel `role="alert"` + Retry | Title: new `SAT_COPY.submit.answersRecordedTitle` = `"Your answers are recorded — finishing the result…"` (verbatim move of `:278`); body: new `SAT_COPY.submit.answersRecordedBody` = `"The result could not be generated just now. Keep this screen open; it will complete automatically, or retry now."` (verbatim move of `:283`) |
| C5 | Finalization failed BEFORE answers recorded (send failed, answers safe locally) | `phase === "submitting" && error && answersRecorded === false` | Full-screen error panel `role="alert"` + Retry | Title: new `SAT_COPY.submit.submissionInterruptedTitle` = `"Submission interrupted — your answers are safe"` (verbatim move of `:279`); body: new `SAT_COPY.submit.submissionInterruptedBody` = `"The final step could not be sent just now. Your saved answers remain on this device and the server."` (verbatim move of `:284`) |
| C6 | Retry action (both C4/C5 + directions terminal-recovery) | `onClick={retryFinalization}`, `disabled={isSubmitting}` | Button label | Idle: reuse directions secondary label — new `SAT_COPY.submit.retryFinalization` = `"Retry finalization"` (verbatim move of route `:295` / `:246`); pending (`isSubmitting`): new `SAT_COPY.submit.retryingFinalization` = `"Retrying…"` (verbatim move of `:295` / `SatDirectionsScreen:125`). Both call sites use the SAME two keys. |
| C7 | Terminal recovery on directions (all modules final, no result, error) | `recoveryNeedsRetry === true` (controller `:733-743`), route `:223-249` | `SatDirectionsScreen` secondary action | SAME C6 keys (no separate copy). Pending state `secondaryActionPending={isSubmitting}` unchanged. |

Rules:
- **Verbatim moves only.** No rewording, no sentence-case changes, no new reassurance clauses. Rationale: exam-stress-safe; any wording change needs UX + a11y re-review and is out of scope.
- **Uniqueness constraint:** `satCopy.test.ts:25-33` asserts strings are unique within each section. The 4–5 new `submit.*` values above are already pairwise distinct — verify before merge.
- **No duplicate sources:** after 05, `grep -rn "Finalizing module" src/features/student-delivery` must return ZERO hits (the overlay default is gone); `grep -rn "Time expired" src/features/student-delivery` must hit ONLY `satCopy.ts` + tests.
- Review-page button (`SatReviewPage:170` `SAT_COPY.submit.submitting` = `"Submitting\u2026"`) is NOT part of this matrix and does not change.

### 3.2 Single-pattern rule (when full-screen vs when inline overlay)

```
phase === "submitting"
  → FULL-SCREEN pattern. No SatExamShell mounted. Exactly one of:
     - SatLoadingSurface (no error) with C1/C2 label, OR
     - error panel role="alert" (error) with C4/C5 + C6 retry.
     - SatSubmissionOverlay NEVER renders here (it needs a shell).
     - SatSaveStatus does NOT render here (it lives inside SatExamShell).

phase === "module" | "review" && isSubmitting === true
  → INLINE pattern. Shell stays mounted, inner region inert:
     - SatSubmissionOverlay (C3) fixed overlay z-[95] role="status".
     - SatExamShell props.blocked includes isSubmitting
       (route :381 interactionBlocked → :426 blocked → shell :264-268 inert).
     - SatSaveStatus (outside inert, shell :423-429) keeps its own state;
       during a healthy submit it is idle (renders null) — see §3.3.
     - SatLoadingSurface NEVER renders here (would be a second pattern).

All other phases → neither pattern. Directions terminal-recovery uses C6/C7
secondary action, NOT either submitting surface.
```

Why two patterns remain (and why that is correct, per R6 "both correct per phase"):
full-screen is the terminal handoff (no exam chrome left to hold); inline is the
transient ack wait (exam chrome + answers still on screen, must stay visible but
inert). Phase 05 unifies the LANGUAGE, not the layout.

### 3.3 Live-region ownership during submitting

| Pattern | Live region owner (exactly one) | What must be silent |
|---------|--------------------------------|---------------------|
| Full-screen loading (C1/C2) | `SatLoadingSurface` `role="status" aria-live="polite"` (`SatStateSurfaces:49-53`) | No `SatSubmissionOverlay`, no `SatSaveStatus` (no shell), no Desmos prewarm status (01+03 guarantee), error panel absent (mutually exclusive branch) |
| Full-screen error (C4/C5) | Error panel `role="alert"` (route `:271-274`) — assertive, carries title+body+detail | Retry button has no live role; detail `<p>` is plain text. Exactly one `role="alert"` in the tree. |
| Inline overlay (C3) | `SatSubmissionOverlay` `role="status" aria-live="polite" aria-atomic="true"` (`SatControlFeedback:70-75`) | Shell content underneath is `inert` (not just aria-hidden) so its live regions (timer reveal announcement `SatExamShell:276`, save-status) cannot double-announce; `SatSaveStatus` must be `idle → null` during a healthy submit — if it is non-idle (offline/retrying/failed/superseded) that state is a SEPARATE truth with its own region, and the test must assert the pair is intentional (see §7.3), never two `role=status` for the same event |
| Directions terminal-recovery (C7) | Directions error `<p role="alert">` (`SatDirectionsScreen:93-100`) | Secondary retry button silent; no submitting surface mounted |

Global invariants (prove in tests, §7.3):
- While ANY submitting surface is visible: `document.querySelectorAll('[role="status"]')` length is exactly 1 (loading path) and `[role="alert"]` length is exactly 1 (error path, and then status count is 0).
- Hidden prewarm contributes 0 (assert `[data-sat-tool-window][aria-hidden="true"] [role="status"]` count is 0, or no iframe at all per 03's bare-branch rule).
- `SatControlBanner role="status"` (warning, `:14-16`) and `SatBlockingOverlay` (alertdialog) never co-render with submitting surfaces — if `blocked && isSubmitting` (pause lands mid-submit), the submitting surface wins announcement priority; the pause veil renders but its focus-trap must not steal focus from the retry button (edge E5).

---

## 4. Step-by-step implementation (copy convergence ONLY)

> Precondition: `git status` clean; Phases 01–04 merged. Implementer reads the four
> files in §2.1 fully before touching anything.

**Step 1 — Add the missing copy keys (additive, no reword).**
File: `src/features/student-delivery/domain/satCopy.ts` (`submit:` block `:84-91`).
Append inside `submit:` (naming negotiable, values exact):
```ts
finalizingNote: "Your latest responses are being verified.",
answersRecordedTitle: "Your answers are recorded — finishing the result…",
answersRecordedBody: "The result could not be generated just now. Keep this screen open; it will complete automatically, or retry now.",
submissionInterruptedTitle: "Submission interrupted — your answers are safe",
submissionInterruptedBody: "The final step could not be sent just now. Your saved answers remain on this device and the server.",
retryFinalization: "Retry finalization",
retryingFinalization: "Retrying…",
```
Check: `npx vitest run src/features/student-delivery/domain/__tests__/satCopy.test.ts` still passes (uniqueness within `submit` section).

**Step 2 — Point the overlay at the copy table.**
File: `src/features/student-delivery/ui/feedback/SatControlFeedback.tsx:58-86`.
- Change defaults: `title = SAT_COPY.submit.finalizingResponses`,
  `note = SAT_COPY.submit.finalizingNote`.
- Change `:68` to `autoSubmitted ? SAT_COPY.submit.timeExpiredFinalizing : title`.
- No other edit. Verify no visual diff except the title string when manual
  (`"Finalizing module…" → "Finalizing SAT responses…"` — the intended convergence).

**Step 3 — Point the full-screen submitting branch at the copy table.**
File: `src/features/student-delivery/routes/SatStudentSessionRoute.tsx:265-306`.
- Error titles `:277-279` → `exam.answersRecorded ? SAT_COPY.submit.answersRecordedTitle : SAT_COPY.submit.submissionInterruptedTitle`.
- Error bodies `:282-284` → `...answersRecordedBody : ...submissionInterruptedBody`.
- Retry label `:295` → `exam.isSubmitting ? SAT_COPY.submit.retryingFinalization : SAT_COPY.submit.retryFinalization`.
- Loading label `:303` → `exam.autoSubmitted ? SAT_COPY.submit.timeExpiredFinalizing : SAT_COPY.submit.finalizingResponses`.
- Keep: `role="alert"` wrapper, detail `<p>{error}</p>`, `disabled={exam.isSubmitting}`,
  `onClick={() => void commands.retryFinalization()}`, `withCalculatorHost(...)` wrapping untouched.

**Step 4 — Converge the directions terminal-recovery label (same keys, no new copy).**
File: same route `:246-248` + `SatDirectionsScreen:118-127` (props contract unchanged).
- Route: `secondaryActionLabel={terminalRecoveryFailed ? SAT_COPY.submit.retryFinalization : undefined}`.
- Directions screen `:125`: `{props.secondaryActionPending ? SAT_COPY.submit.retryingFinalization : props.secondaryActionLabel}`
  (currently hardcoded `"Retrying…"`). Props interface (`:21-23`) unchanged.

**Step 5 — Confirm the inline call site needs no logic change.**
File: route `:410` stays `{exam.isSubmitting ? <SatSubmissionOverlay autoSubmitted={exam.autoSubmitted} /> : null}`.
It inherits convergence from Step 2. Do NOT add `note` / `title` props (defaults now correct).
Confirm `:381` `interactionBlocked` and `:426` `blocked` still include `exam.isSubmitting`.

**Step 6 — Repoint any test fixtures that hardcoded the old overlay title.**
- `grep -rn "Finalizing module" src e2e` → update expectations to `SAT_COPY.submit.finalizingResponses`.
- `grep -rn "Finalizing SAT responses" src e2e` → expectations should import `SAT_COPY`, not re-hardcode.
- No prod-code change beyond Steps 1–4 to satisfy tests.

**Step 7 — Run the verification checklist (§8) in order; fix ONLY copy/test drift.**
If anything beyond copy/test fails, STOP — it belongs to Phases 01–04 (see §10 repair routing).
Explicitly out of scope: touching `finalizeAssessment`, `submitModule`, reducer, shell inert, save-status, gateway, persistence.

---

## 5. Important code / pseudocode (branch sketch ONLY — behavior frozen)

Reference sketch for the reviewer (NOT a rewrite — shows converged labels on the
existing structure; `withCalculatorHost` / guards / handlers unchanged):

```tsx
// SatStudentSessionRoute.tsx — submitting branch (existing structure, converged labels)
if (state.phase === "submitting") {
  if (error) {
    return withCalculatorHost(
      <div className="sat-ui grid min-h-[100dvh] place-items-center …" role="alert">
        <div className="w-full max-w-md text-center">
          <h1>{exam.answersRecorded
            ? SAT_COPY.submit.answersRecordedTitle
            : SAT_COPY.submit.submissionInterruptedTitle}</h1>
          <p>{exam.answersRecorded
            ? SAT_COPY.submit.answersRecordedBody
            : SAT_COPY.submit.submissionInterruptedBody}</p>
          <p>{error}</p>  {/* server detail, plain text, no live role */}
          <button
            onClick={() => void commands.retryFinalization()}
            disabled={exam.isSubmitting}
          >
            {exam.isSubmitting
              ? SAT_COPY.submit.retryingFinalization
              : SAT_COPY.submit.retryFinalization}
          </button>
        </div>
      </div>
    );
  }
  return withCalculatorHost(
    <SatLoadingSurface
      label={exam.autoSubmitted
        ? SAT_COPY.submit.timeExpiredFinalizing
        : SAT_COPY.submit.finalizingResponses}
    />
  );
}

// Inline pattern (module/review, unchanged logic — inherits overlay convergence)
{exam.isSubmitting ? <SatSubmissionOverlay autoSubmitted={exam.autoSubmitted} /> : null}

// Overlay (defaults now from copy; resolvedTitle logic unchanged)
export function SatSubmissionOverlay({
  title = SAT_COPY.submit.finalizingResponses,
  note = SAT_COPY.submit.finalizingNote,
  autoSubmitted = false,
}: { title?: string; note?: string; autoSubmitted?: boolean }) {
  const resolvedTitle = autoSubmitted ? SAT_COPY.submit.timeExpiredFinalizing : title;
  /* …existing role="status" surface unchanged… */
}
```

Flag semantics reminder (read-only, from the controller — do NOT reimplement):
- `autoSubmitted`: `useState(false)` (`:992`); set `true` ONLY in the zero-remaining effect (`:895`) before `submitModule`; cleared on identity change (`:100`) and never cleared on success (phase leaves module/review so it stops mattering). Drives C2 vs C1 and overlay title.
- `answersRecorded`: `useState(false)` (`:996`); set `true` inside `finalizeAssessment` after `flush()` + `submit()` ack (`:566`); cleared on identity change (`:101`). Drives C4 vs C5. Sticky `true` through retry loops by design (once recorded, stays recorded for the attempt).
- `isSubmitting`: set around `submitModule` (`:645/:715`) and `retryFinalization` (`:753/:769`); drives overlay visibility, retry disabled state, and shell `blocked`.

---

## 6. Edge cases (must be handled or explicitly asserted)

| # | Edge | Expected behavior (no new behavior — assert existing) | Test hook |
|---|------|------------------------------------------------------|-----------|
| E1 | Timeout copy: auto-submit fires on zero remaining | `setAutoSubmitted(true)` before `submitModule`; full-screen shows C2 (timeout), overlay would show C2 if still inline. Manual submit shows C1. | Copy-matrix tests force `autoSubmitted` true/false; controller test asserts flag set in timeout effect |
| E2 | `answersRecorded` split | Error AFTER ack → C4 (reassuring, "keep open; completes automatically"); error BEFORE ack → C5 (safe-locally). Sticky-true: after C4, a second failure still shows C4. | Copy-matrix renders both; recovery test asserts flag timing |
| E3 | `retryFinalization` pending | Button disabled + label `retryingFinalization` while `isSubmitting`; guard prevents double-fire (singleflight). Label flips back on failure. | Fire retry, assert disabled + label, then failure label |
| E4 | Recovery polling resolving underneath the error panel | Bootstrap carrying `result` recovers submitting→complete (recovery test `:115-142`) WITHOUT requiring a click; error panel unmounts to `SatCompleteScreen`. Copy must not trap the student (C4 body says "will complete automatically"). | Existing recovery test stays green; e2e/manual checklist watches panel→complete transition |
| E5 | `blocked` (paused) during submit | Shell inert covers exam grid; submitting surface keeps announcement priority; `SatSaveStatus` retry / Take over stay outside inert and reachable (WCAG 2.1.1). Pause veil focus-trap must not steal focus from Retry. Post-05 a11y test asserts focus Noel. | Single-live-region + focus test with `blocked=true + isSubmitting=true` |
| E6 | Offline submit | `persistence.flush()` throws → `submitModule` catch → `refresh(false)` → likely no result → C5 error panel. Copy must say "safe on this device" (it does). Retry when back online either resolves via polling or manual retry. No new offline copy in this phase. | Recovery test with rejected flush; assert C5 title |
| E7 | Terminal recovery on directions (defect-2 seam) | Directions secondary action uses SAME C6 keys; `secondaryActionPending={isSubmitting}`; clicking replays stable `submissionId=attemptId` exactly once (existing test `:144-168` asserts `ids == ["attempt-a","attempt-a"]`). | Keep that test green; add label assertion |
| E8 | Identity change mid-submit (attempt switch) | Effect `:94-106` resets `isSubmitting/autoSubmitted/answersRecorded` + dispatches fresh runner state; stale gateway resolutions are dropped by generation check. No submitting copy lingers for the old attempt. | Identity test (existing `useSatExamController.identity.test.tsx`) stays green |
| E9 | Review-page double-submit | `SatReviewPage:78` early-returns while `submitting`; button shows `SAT_COPY.submit.submitting`. Unchanged. | `satSubmitReadiness.test.ts:46-56` stays green |
| E10 | Reduced motion / exam stress | Spinner has `motion-reduce:hidden`; copy strings are short, no blame language, no new animation. No test change — visual check in e2e. | Manual checklist |

---

## 7. Tests

### 7.1 Copy-matrix tests (NEW — the core of Phase 05)

New file: `src/features/student-delivery/routes/__tests__/SatSubmittingCopy.test.tsx`
(uses `@testing-library/react`; mocks `useSatExamController` — do NOT hit the gateway).

Cases (each renders `SatStudentSessionRoute` with canned `exam` object or renders
the two surfaces directly — prefer route-level for C1/C2/C4/C5, overlay-level for C3):

1. Manual finalizing: `phase="submitting", error=null, autoSubmitted=false`
   → `getByRole("status")` text is `SAT_COPY.submit.finalizingResponses`.
2. Timeout finalizing: same with `autoSubmitted=true`
   → text is `SAT_COPY.submit.timeExpiredFinalizing`.
3. Inline overlay manual: render `<SatSubmissionOverlay autoSubmitted={false} />`
   → title `finalizingResponses` + note `finalizingNote`.
4. Inline overlay timeout: `autoSubmitted={true}` → title `timeExpiredFinalizing`.
5. Error + recorded: `phase="submitting", error="boom", answersRecorded=true`
   → `getByRole("alert")` contains `answersRecordedTitle` + `answersRecordedBody` + retry button `retryFinalization`.
6. Error + not recorded: `answersRecorded=false` → `submissionInterruptedTitle` + `submissionInterruptedBody`.
7. Retry pending: same as 5/6 with `isSubmitting=true` → button disabled + text `retryingFinalization`.
8. Directions terminal-recovery: render route in `phase="directions"` with all-final attempts + error → secondary button `retryFinalization`; with `isSubmitting=true` → `retryingFinalization` + disabled.
9. No-hardcode guard: assert `SatSubmissionOverlay.defaultProps`-equivalent — import the component and check its default render equals the copy keys (catches future drift back to `"Finalizing module…"`).

### 7.2 Recovery tests (KEEP GREEN, extend labels only)

- `src/features/student-delivery/hooks/__tests__/sat-finalization-recovery.test.tsx`
  - `:115-142` polling recovery → complete. ADD: assert no second `submitAssessment` call (singleflight intact).
  - `:144-168` retry replays stable id exactly once (`submissionId=attemptId`). ADD: assert the route-level retry button label uses `SAT_COPY.submit.retryFinalization` (import copy in the test; no prod change).
- `src/features/student-delivery/application/__tests__/satRunnerReducer.test.ts:115-116` submit→submitting→complete path stays green (no change).
- `src/features/student-delivery/hooks/__tests__/useSatExamController.identity.test.tsx` stays green (identity reset incl. `autoSubmitted/answersRecorded`).

### 7.3 A11y single-live-region test (NEW or extend)

New or extended file: `src/features/student-delivery/ui/feedback/__tests__/SatSubmittingLiveRegion.test.tsx`:

```tsx
// For each of C1/C2 (loading), C4/C5 (error), C3 (overlay over inert shell):
const statuses = container.querySelectorAll('[role="status"]');
const alerts = container.querySelectorAll('[role="alert"]');
// loading path: statuses.length === 1 && alerts.length === 0
// error path:   alerts.length === 1 && statuses.length === 0
// overlay path: statuses.length === 1 (the overlay) — shell timer/save regions silent or absent
// hidden prewarm: container.querySelectorAll('[aria-hidden="true"] [role="status"]').length === 0
// hidden prewarm: container.querySelectorAll('iframe[title*="Desmos"], iframe[title*="desmos"]').length === 0
//   on loading/error branches (per 03 bare-branch rule)
```

Also assert: error panel has `aria-atomic` semantics via title+body in one `role="alert"`
(no split announcements); retry button is focusable and NOT `disabled` when idle;
when `isSubmitting`, button is `disabled` (no focus trap loss).

### 7.4 E2E flicker / instrumentation checklist (Playwright — manual + scripted)

Existing specs: `e2e/sat-student-accessibility.spec.ts` (harness `/__dev/sat-accessibility`),
`e2e/sat-product-workspace.spec.ts` (prod smoke). No new spec file required unless the
team wants the loader-count automated; otherwise run this checklist against the dev harness
and record counts in the sign-off note:

**How to count loaders / iframes / live-regions** (paste into DevTools console or a
Playwright `page.evaluate` during the submitting state):
```js
// 1. Visible loading surfaces (exactly 1 expected in C1/C2)
document.querySelectorAll('.sat-ui [role="status"]').length;
// 2. Desmos iframes (0 expected on submitting/error branches per 03)
document.querySelectorAll('iframe[src*="desmos"]').length;
// 3. All live regions (1 expected: the single status OR the single alert)
document.querySelectorAll('[role="status"], [role="alert"]').length;
// 4. Hidden live regions (0 expected)
document.querySelectorAll('[aria-hidden="true"] [role="status"], [aria-hidden="true"] [role="alert"]').length;
// 5. Flicker check: hold previous UI — script a poll-refresh during module phase
//    (or throttle network to 3G) and assert no full-screen spinner mounts:
//    document.querySelectorAll('.sat-ui.grid.min-h-\[100dvh\]').length stays 0
//    while exam chrome ([data-testid="sat-exam-shell"]) stays visible.
```

Checklist:
- [ ] Cold SAT open: exactly one SAT-skinned surface, no admin skeleton flash (DoD 1).
- [ ] Throttled poll during module phase: exam UI holds, no full-screen spinner (DoD 2).
- [ ] Force finalization error (offline / kill gateway in dev): C5 panel appears with Retry; go back online → auto-recovers to complete without click (E4).
- [ ] Timeout path (set clock to 0:00 in harness): C2 copy appears, not C1.
- [ ] Keyboard: Tab reaches Retry when idle; focus visible; Escape does not dismiss submitting surfaces.
- [ ] Reduced motion: spinner hidden, copy unchanged.
- [ ] IELTS / staff / preview smoke: open each, confirm no copy or surface change (spot-check, §8.5).

---

## 8. Verification (FULL command list — run in order, record output)

> Phase 05 is not done until every line below is green and pasted/linked in the sign-off note.
> Commands assume repo root `remix_-ielts-proctoring-system`.

```bash
# 0. Clean baseline
git status --short && git log --oneline -3

# 1. Typecheck (whole repo — must be zero errors)
npm run typecheck
#  → tsc --noEmit

# 2. Lint — scoped first (fast signal), then full
npx eslint src/features/student-delivery/routes/SatStudentSessionRoute.tsx   src/features/student-delivery/ui/feedback/SatControlFeedback.tsx   src/features/student-delivery/domain/satCopy.ts   src/features/student-delivery/routes/__tests__/SatSubmittingCopy.test.tsx   src/features/student-delivery/ui/feedback/__tests__/SatSubmittingLiveRegion.test.tsx
npm run lint
#  → eslint . (whole repo; IELTS/staff drift fails here)

# 3. Unit — affected first, then full SAT suites
npx vitest run src/features/student-delivery/routes/__tests__/SatSubmittingCopy.test.tsx   src/features/student-delivery/ui/feedback/__tests__/SatSubmittingLiveRegion.test.tsx   src/features/student-delivery/domain/__tests__/satCopy.test.ts   src/features/student-delivery/hooks/__tests__/sat-finalization-recovery.test.tsx   src/features/student-delivery/application/__tests__/satRunnerReducer.test.ts   src/features/student-delivery/ui/feedback/SatSaveStatus.test.tsx   src/features/student-delivery/hooks/__tests__/useSatExamController.identity.test.tsx   src/features/student-delivery/ui/transitions/SatTransitionScreens.test.tsx   src/features/student-delivery/domain/__tests__/satSubmitReadiness.test.ts
npx vitest run src/features/student-delivery
#  → full student-delivery suite (catches shell/review/directions regressions)

# 4. Full unit (optional but recommended before sign-off)
npm run test:run
#  → vitest run (whole repo)

# 5. E2E — SAT smoke + a11y (headed once locally if flaky)
npm run e2e:sat-a11y
#  → playwright test --config playwright.sat-a11y.config.ts (chromium, webkit, touch-chromium)
npx playwright test --config playwright.prod-smoke.config.ts -g "SAT|sat"
#  → SAT-only slice of prod smoke (adjust -g to the repo's SAT test titles; run full
#    prod-smoke only if the slice passes and time allows)

# 6. Drift guards (zero-tolerance greps — paste output)
grep -rn "Finalizing module" src/features/student-delivery e2e || echo "OK: no stale overlay title"
grep -rn "Time expired" src/features/student-delivery | grep -v satCopy | grep -v __tests__ || echo "OK: timeout copy centralized"
grep -rn "Retry finalization\|Retrying" src/features/student-delivery --include="*.tsx" | grep -v satCopy | grep -v __tests__ || echo "OK: retry copy centralized"
grep -rn "role=.status.\|role=.alert." src/features/student-delivery/ui/feedback || echo "CHECK: region inventory above"
```

### What must stay green for IELTS / staff / preview (§8.5)

- `npm run typecheck` and `npm run lint` cover those trees — zero new warnings/errors there.
- Full `vitest run src/features/student-delivery` includes preview-controller tests
  (`useSatPreviewController.test.tsx`, `SatPreviewRoute.test.tsx`) — they must pass untouched.
- Staff (`src/products/sat/*`, `src/features/exam-authoring/*`) and IELTS suites must pass
  in the full `npm run test:run` with NO snapshot updates attributable to this phase.
- E2E preview route (`SatPreviewRoute` keeps its own controller by design) — spot-open preview,
  confirm submitting copy changes did not leak (preview never renders `phase=submitting`).
- If ANY IELTS/staff/preview test fails, the phase is NOT sign-offable even if all SAT tests pass
  (see §10).

---

## 9. Definition of Done (overall DoD §6 restated as checkable gates)

| Gate | Overall DoD source | Checkable assertion for Phase 05 |
|------|-------------------|----------------------------------|
| G1 | §6.1 cold open = one SAT surface, no admin flash | E2E checklist §7.4 cold-open item passes; no Phase-05 diff touches parent skeleton or bootstrap (prove via `git diff --stat` showing ONLY §2.1 files) |
| G2 | §6.2 poll/refresh never swaps valid UI for spinner | Unchanged by 05 (04 owns) — 05 proves no regression: full `student-delivery` suite + throttled-poll checklist item pass |
| G3 | §6.3 loading/error/submitting branches = zero hidden Desmos iframes, exactly one live region | A11y test §7.3 passes for C1–C5 + console counts in §7.4 recorded (statuses=1/alerts=1, iframes=0, hidden-live=0) |
| G4 | §6.4 `candidateId` trustworthy + reducer/identity tests | Identity + reducer + recovery tests green, untouched semantics (singleflight + `submissionId=attemptId` asserted) |
| G5 | §6.5 tsc + eslint + affected vitest + SAT e2e smoke green; no IELTS/staff/preview regression | §8 command list fully green; §8.5 spot-checks recorded |
| G6 | §6.6 no backend change; no new store; no spinner redesign | `git diff` shows no backend/gateway/persistence/store/CSS-spinner changes; copy diff is verbatim moves + additive keys only |
| G7 (R6 close-out) | Two submitting patterns → one language; copy converges | Copy matrix §3.1 fully implemented: all 7 rows render from `SAT_COPY.submit`; stale-string greps (§8.6) return OK; copy-matrix tests §7.1 green |

### Sign-off procedure

1. Implementer posts: (a) `git diff --stat` + full diff of §2.1 files, (b) pasted output of EVERY §8 command (or CI links), (c) §7.4 counts + checklist ticks, (d) confirmation that §8.5 trees are untouched.
2. Reviewer (main agent) verifies: single-pattern rule §3.2 holds in the diff; live-region table §3.3 matches the a11y test; no behavior edit outside copy (search diff for `submitAssessment|submitModule|finalizationInFlightRef|dispatch|inert|hydrate` — any hit outside tests = repair).
3. On pass: mark Phase 05 DoD complete → close R6 → close the program. On fail: route per §10.

---

## 10. What sends a phase back for repair (non-exhaustive)

- **Back to Phase 05 (this phase):** wrong/extra copy (any user-visible submitting string not in §3.1 table); stale `"Finalizing module…"` survives anywhere; second live region during submitting (status count ≠ 1 / alert count ≠ 1); retry button not disabled while `isSubmitting`; directions secondary label diverges from C6 keys; any test in §7.1/§7.3 failing.
- **Back to Phases 01–04:** hidden Desmos status/iframe appears during submitting (01/03); admin skeleton flashes on cold open (02); poll replaces valid UI with spinner or skew flakes the copy tests (04); `candidateId` mismatch in any phase (04); singleflight broken (two `submitAssessment` calls for one finalize) or `submissionId !== attemptId` (04 + gateway contract — stop and escalate, never "fix" in 05).
- **Full stop (needs main-agent decision):** any IELTS/staff/preview regression; any request to reword copy beyond verbatim moves; any proposal to merge the two LAYOUTS into one (the two patterns are intentionally distinct per §3.2 — unifying layout is explicitly out of scope); any backend/payload change proposal.
