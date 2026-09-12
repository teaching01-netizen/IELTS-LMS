# Phase 04 — Content, writing and user flow (Lens 5 + flow review)

## Objective

Audit every user-visible string and the end-to-end student flow (directions → module → navigator → review → confirm → complete, plus leave/break variants) through the Apple-design Content lens. Grade verb-led action labels, action-name continuity, capitalization consistency, error/empty/recovery copy, jargon leakage, pronoun perspective, and one-job-per-element. Propose replacement strings in Fix-spec only — NO source edits.

## Dependencies

- `plans-sat-audit/overall-plan.md` (Wave 1 parallel phase; disjoint plan file, shared read-only sources).
- HIG references: `writing.md`, `feedback.md`, `alerts.md`, `entering-data.md` (all opened and quoted below).
- Prior code-read audit (re-verified, not copied blindly): rating Good, no Critical; High = top-bar density + light-only; Medium = timer pill, reduced-motion, capitalization; Lows = saving text-only, H1/eyebrow naming. Capitalization and H1/eyebrow claims are re-verified with line evidence below; top-bar density / appearance / motion are owned by Phases 01–03.

## Files read (with line ranges inspected)

| File | Lines inspected |
|---|---|
| `src/features/student-delivery/domain/satCopy.ts` | 1–253 (whole vocabulary table) |
| `src/features/student-delivery/ui/shell/SatExamTopBar.tsx` | 1–249 (full: all tool labels, timer cell, More entry) |
| `src/features/student-delivery/ui/question/SatQuestionHeader.tsx` | 1–73 (full: flag + eliminator labels) |
| `src/features/student-delivery/ui/shell/SatExamFooter.tsx` | 1–114 (full: Back/Next/Review labels) |
| `src/features/student-delivery/ui/shell/SatQuestionNavigator.tsx` | 1–199 (full: legend + aria-labels + Review CTA) |
| `src/features/student-delivery/ui/review/SatReviewPage.tsx` | 1–211 (full: H1, counts, notices, confirm copy) |
| `src/features/student-delivery/ui/review/SatQuestionStatusGrid.tsx` | 1–73 (full: review legend) |
| `src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx` | 1–179 (full: meta, begin/leave copy, blocked reason) |
| `src/features/student-delivery/ui/transitions/SatCompleteScreen.tsx` | 1–58 (full: complete + terminated copy) |
| `src/features/student-delivery/ui/feedback/SatSaveStatus.tsx` | 1–108 (full: save nouns vs sentences) |
| `src/features/student-delivery/ui/shell/SatFooterSaveIndicator.tsx` | 1–61 (full: short-noun indicator) |
| `src/features/student-delivery/ui/break/SatUnscheduledBreakDialog.tsx` | 1–50 (full) |
| `src/features/student-delivery/ui/break/SatUnscheduledBreakVeil.tsx` | 1–68 (full) |
| `src/features/student-delivery/ui/shell/SatTimerWarning.tsx` | 1–49 (full) |
| `src/features/student-delivery/ui/help/SatShortcutsModal.tsx` | 1–72 (full) |
| `src/features/student-delivery/domain/satShortcuts.ts` | 1–64 (full: row labels) |
| `src/features/student-delivery/domain/satHelpContent.ts` | 1–64 (full: help titles/bodies/whereToFind) |
| `src/features/student-delivery/ui/question/SatStudentProducedAnswer.tsx` | 1–86 (full: help + error chain) |
| `src/features/exam-authoring/providers/sat/studentResponse.ts` | 1–90 (full: SPR validator messages) |
| HIG `writing.md` | 1–71 (full) |
| HIG `feedback.md` | 1–42 (full) |
| HIG `alerts.md` | 1–98 (full) |
| HIG `entering-data.md` | 1–53 (full) |

## HIG anchors used in this phase

- `writing.md › Best practices` — "When labeling buttons and links, it's almost always best to use a verb."
- `writing.md › Best practices` — "Adopt capitalization rules that align with your app's style, then apply them consistently… Choose a style for each UI element type and use it consistently throughout your app — for example, title case for all alerts or sentence case for all headlines."
- `writing.md › Best practices` — "Give clear guidance and use consistent language throughout processes with multiple steps… Make it clear when a flow is complete by using language like 'Done.'"
- `writing.md › Best practices` — "Use possessive pronouns sparingly… If you do use possessive pronouns, use them consistently throughout your app, and try not to switch perspectives."
- `writing.md › Best practices` — "Write clear error messages… be clear about what someone can do to fix it… 'Choose a password with at least 8 characters.'"
- `writing.md › Best practices` — "Show hints in text fields… Show errors right next to the field, and instruct people how to enter the information correctly… Avoid robotic error messages with no helpful information, like 'Invalid name.'"
- `alerts.md › Buttons` — "Create succinct, logical button titles. Aim for a one- or two-word title that describes the result of selecting the button. Prefer verbs and verb phrases… Always use 'Cancel' to title a button that cancels the alert's action."
- `alerts.md › Buttons` — "Avoid using OK as the default button title unless the alert is purely informational."
- `alerts.md › Content` — "Write a title that clearly and succinctly describes the situation… Avoid writing a title that doesn't convey useful information — like 'Error'… If the title is a sentence fragment, use title-style capitalization, and don't add ending punctuation."
- `alerts.md › Content` — "Avoid explaining alert buttons. If your alert text and button titles are clear, you don't need to explain what the buttons do."
- `feedback.md › Best practices` — "Show people when a command can't be carried out and help them understand why."
- `entering-data.md › Best practices` — "Dynamically validate field values… When you verify values as soon as people enter them — and provide feedback as soon as you detect a problem — you give them the opportunity to correct errors right away."

## Findings

### F-04-01 (Medium) — Verb-led action labels: 5 of 6 graded PASS, 1 WEAK ("Take Break" restates its own dialog)

| Label under test | Where (file:line) | Verdict |
|---|---|---|
| Save and close | `satCopy.ts:40` (`questionNote.saveAndClose`) | PASS — verb-led, two-word, describes result. |
| Keep checking | `satCopy.ts:81` (`review.keepChecking`, rendered `SatReviewPage.tsx:197`) | PASS — verb phrase, safe-direction explicit, cancels the submit alert per `alerts.md › Buttons` ("Always use 'Cancel'…" spirit: safe exit named, not "OK"). |
| Submit anyway | `satCopy.ts:82` (`review.submitAnyway`, rendered `SatReviewPage.tsx:204`) | PASS — verb phrase naming the destructive result; pairs with irreversibility sentence `submit.cannotReturn` (`satCopy.ts:87`). |
| Back to question N | `satCopy.ts:226` (`satBackToQuestionLabel`, used `SatReviewPage.tsx:65-68`) | PASS — verb-led ("Back" as directional verb) + exact destination N; matches `writing.md › Best practices` multi-step guidance ("use the button label to hint at the next step"). |
| Take Break | `satCopy.ts:199` (`unscheduledBreak.takeBreak`, rendered `SatUnscheduledBreakDialog.tsx:44`) | WEAK — verb-led, but near-verbatim restatement of its own dialog title "Take an Unscheduled Break?" (`satCopy.ts:196`), violating `alerts.md › Content` ("Avoid explaining alert buttons… If your alert text and button titles are clear, you don't need to explain"). The button adds no new information about the result (timer keeps running). |
| Return to Test | `satCopy.ts:202` (`unscheduledBreak.returnToTest`, rendered `SatUnscheduledBreakVeil.tsx:63`) | PASS — verb-led, names destination; correct flow-completion language per `writing.md › Best practices` ("Make it clear when a flow is complete"). |

- **Why:** Five labels satisfy `writing.md › Best practices` ("When labeling buttons and links, it's almost always best to use a verb") and `alerts.md › Buttons` ("Prefer verbs and verb phrases that relate directly to the alert text"). "Take Break" is the exception: title and button say the same thing, so neither carries the consequence (time keeps running).
- **Fix-spec (NOT applied):** In `satCopy.ts:199`, change `unscheduledBreak.takeBreak` from `"Take Break"` to `"Start my break"` — keeps the verb, differentiates button from title, and signals the consequence (clock starts/keeps running) without adding a third sentence. Keep `confirmTitle` (`satCopy.ts:196`) unchanged. No component change needed (both read the same key).

### F-04-02 (Medium) — Action-name continuity BREAK: review destination has three names ("Go to Review Page" vs "Review answers" vs "Review your answers")

- **What:** The last-question footer CTA reads `"Go to Review Page"` (`satCopy.ts:68` `navigation.reviewAnswers`, rendered `SatExamFooter.tsx:93`); the navigator's bottom CTA reads the same key (`SatQuestionNavigator.tsx:175`); an alias `"Review answers"` (`satCopy.ts:69` `reviewAnswersAlias`, "stays as an alias for e2e compat") is a second name for the same destination; the review H1/eyebrow reads `"Review your answers"` (`satCopy.ts:78` `review.eyebrow`, rendered `SatReviewPage.tsx:108`); the exit path reads `"Back to questions"` (`satCopy.ts:70`) or `"Back to question N"` (`satCopy.ts:226`). So the flow teaches: Go to **Review Page** → land on **Review your answers** → exit via **Back to questions**. Three nouns (Page / answers / questions) for one loop. By contrast the timer Hide/Show pair is continuous: top-bar toggle (`SatExamTopBar.tsx:113-118`), review toggle (`SatReviewPage.tsx:97-100`), help entry "Hide / Show" (`satHelpContent.ts:38`), and copy keys `timer.hideTimer`/`showTimer` (`satCopy.ts:117-118`) all use the same two verbs.
- **Why:** Violates `writing.md › Best practices` ("Give clear guidance and use consistent language throughout processes with multiple steps… use consistent language"; "Build language patterns. Consistency builds familiarity"). A multi-step loop whose entry name, H1, and exit name all differ forces re-reading at exactly the high-stakes moment (pre-submit).
- **Fix-spec (NOT applied):** Canonicalize on **Review** + answers (judgment: "answers" is the student's object, "Page" is chrome): (1) `satCopy.ts:68` `navigation.reviewAnswers` → `"Review answers"`; (2) delete the alias at `satCopy.ts:69` after migrating the e2e selector to the canonical key (grep `reviewAnswersAlias` consumers first); (3) keep H1 `review.eyebrow` (`satCopy.ts:78`) as `"Review your answers"` (H1 may carry the pronoun; CTA stays bare — see F-04-06); (4) no change to `satBackToQuestionLabel` (exact-N exit is the correct specific case of "Back to questions"). Verify: footer CTA visible text === navigator CTA visible text === review H1 minus pronoun.

### F-04-03 (Medium) — Capitalization consistency map: 3 element types break their own rule (table)

Rule applied per `writing.md › Best practices` ("Adopt capitalization rules… then apply them consistently… Choose a style for each UI element type and use it consistently"): buttons/CTAs, alert/modal titles, and headings were each mapped separately. Sentence-case body copy is consistent throughout and not tabled.

| Element type | House rule observed | Conformers (file:line) | Breakers (file:line) |
|---|---|---|---|
| Button / CTA labels | Sentence case, verb-led | "Save and close" `satCopy.ts:40`; "Keep checking" `satCopy.ts:81`; "Submit anyway" `satCopy.ts:82`; "Back to questions" `satCopy.ts:70`; "Begin module" `satCopy.ts:93`; "Leave exam" `satCopy.ts:95`; "Take over" `satCopy.ts:126`; "Retry now" `satCopy.ts:127`; "Return to Test" is the breaker → see next column | "Take Break" `satCopy.ts:199` (Title Case verb + noun); "Go to Review Page" `satCopy.ts:68` (Title Case, P capitalized); "Back to dashboard" `satCopy.ts:112` is sentence-case conformer — but complete-screen neighbors "SAT complete" `satCopy.ts:109` / "Complete" eyebrow `SatCompleteScreen.tsx:13` mix proper-noun + fragment casing |
| Alert / modal titles | Title Case fragments, no period (per `alerts.md › Content`) | "Take an Unscheduled Break?" `satCopy.ts:196`; "Leave this exam?" `satCopy.ts:98`; "Mark for Review" `satCopy.ts:59`; "Option Eliminator" `satCopy.ts:61`; "Keyboard Shortcuts" `satCopy.ts:175`; "5 minutes remaining" is the breaker → next column | "5 minutes remaining" `satCopy.ts:213` (sentence case where every sibling alert title is Title Case); "SAT complete" `satCopy.ts:109` (sentence-case fragment used as an H1/title — should read as Title Case fragment "SAT Complete" or sentence H1; currently neither rule) |
| Section / group headings | Title Case | "Question Menu" `satCopy.ts:182`; "Highlights & Notes" `satCopy.ts:184`; "Line Reader" `satCopy.ts:185`; "Option Eliminator" `satCopy.ts:188`; "Navigation" `satCopy.ts:177`; "Test Tools" `satCopy.ts:178`; help entries "Zoom and Magnification" `satHelpContent.ts:25`, "Testing Timers" `satHelpContent.ts:37` | "Display" heading `satCopy.ts:178` is a conformer; breaker is review eyebrow/H1 "Review your answers" `satCopy.ts:78` — sentence case in the H1 slot where directions H1 (`SatDirectionsScreen.tsx:53` section label) and complete H1 (`SatCompleteScreen.tsx:14`) are Title/Name case |
| Inline status nouns (footer indicator) | Short nouns, sentence case | "All answers saved" `satCopy.ts:131`; "Saving answers" `satCopy.ts:132`; "Offline — kept on this device" `satCopy.ts:133`; "Save needs attention" `satCopy.ts:134` — all consistent (prior "saving text-only" Low is confirmed as nouns-with-icon; see F-04-04) | None — this type is clean |

- **Why:** Each breaker violates the type rule its siblings follow, i.e. the `writing.md` consistency requirement quoted above. User impact is low in isolation (all strings are still intelligible) but the audit's prior Medium on capitalization is confirmed and now localized to 4 strings.
- **Fix-spec (NOT applied):** (1) `satCopy.ts:199` → `"Start my break"` (also fixes F-04-01); (2) `satCopy.ts:68` → `"Review answers"` (also fixes F-04-02); (3) `satCopy.ts:213` `timerWarning.title` → `"5 Minutes Remaining"` (Title Case fragment, no period, per `alerts.md › Content` fragment rule); (4) `satCopy.ts:109` `transitions.completeTitle` → keep `"SAT complete"` ONLY if H1s are declared sentence-case house-wide — otherwise → `"SAT Complete"`; record the decision in the plan registry (Phase 05) because it also settles the H1/eyebrow Low (F-04-07). None of these change keys, layouts, or tests beyond string assertions.

### F-04-04 (Low) — Error/empty/recovery copy: SPR chain is exemplary; save-failed and directions-blocked meet the bar; one gap (offline banner lacks inline recovery)

- **What (PASS cases with file:line):**
  - SPR help + error: help sentence "Fractions use a/b, max 5 characters (6 with a leading minus)." (`SatStudentProducedAnswer.tsx:77`) + blur-only validation (`SatStudentProducedAnswer.tsx:34-43`) + per-cause messages in `studentResponse.ts:31-78` ("Use only digits, a decimal point, a fraction bar, or a leading minus sign." :36; "SAT responses allow at most 5 characters…" :46; "A minus sign can appear only once, at the beginning." :50; "Use either a fraction or a decimal, not both." :55; "Fractions must use numerator/denominator form, such as 3/4." :74; "A fraction denominator cannot be zero." :78). Empty is explicitly not an error (`SatStudentProducedAnswer.tsx:35-39`), preserving the legal unanswered state.
  - Save failed/blocked with recovery: failed banner shows `saveFailure ?? "Save failed."` (`SatSaveStatus.tsx:84`) + inline "Retry" (`SatSaveStatus.tsx:97-104`); superseded shows "Opened in another session — answers here are paused." (`satCopy.ts:125`) + inline "Take over" (`SatSaveStatus.tsx:86-96`); review hard-block shows reason + "Retry now" link (`SatReviewPage.tsx:161-171`).
  - Directions blocked reason: disabled Begin carries `aria-describedby="sat-directions-start-blocked"` (`SatDirectionsScreen.tsx:109`) resolving to paused body or "The start button enables when the proctor opens this module." (`SatDirectionsScreen.tsx:136-142`).
  - Unanswered notice tone: "Some questions are still unanswered. You may still submit the module." (`satCopy.ts:79`, rendered `SatReviewPage.tsx:128`) — neutral, permissive, no blame, no interjection.
- **What (GAP):** The offline banner (`SatSaveStatus.tsx:52-72`) shows "Offline — answers kept on this device." (`satCopy.ts:122`) with NO inline recovery action — the "Retry now" button renders only in the `retrying` branch (`SatSaveStatus.tsx:62`). A student who sees "Offline" has no verb to act on (wait? retry? keep working?).
- **Why:** The passing cases satisfy `writing.md › Best practices` ("Write clear error messages… be clear about what someone can do to fix it"), the hint/error pairing ("Show hints in text fields… Show errors right next to the field, and instruct people how to enter the information correctly"), and `feedback.md › Best practices` ("Show people when a command can't be carried out and help them understand why"). The offline gap violates the same rules: it names the state but offers no next step. SPR specifically satisfies `entering-data.md › Best practices` ("Dynamically validate field values… provide feedback as soon as you detect a problem") via sanitize-on-type + validate-on-blur (never error mid-keystroke).
- **Fix-spec (NOT applied):** In `SatSaveStatus.tsx:52-72`, render the existing `SAT_COPY.saveStatus.retryNow` button in the `offline` branch too (same classes as the `retrying` branch), OR — if product prefers no manual retry while offline — append a no-verb reassurance clause to `satCopy.ts:122`: `"Offline — answers kept on this device. Keep working; saving resumes automatically."` Judgment: prefer the clause (offline retry usually fails; a dead button is worse than guidance). Keep `retrying` branch unchanged.

### F-04-05 (Low) — Jargon/filler sweep: zero user-visible leaks; "module" is the deliberate house term, "stimulus/superseded/veil" stay internal

- **What:** Grep of `src/features/student-delivery/ui` for `module|stimulus|superseded|veil|Terminated|Return\b` shows: "stimulus" appears only in test node-ids (`SatQuestionRenderer.test.tsx:20,33`, `nodeId: 'stimulus:…'`) — never rendered; "superseded" appears only as `SatSaveBannerState` union member + comment (`SatSaveStatus.tsx:3-9`) — the user-visible string is "Opened in another session — answers here are paused." (`satCopy.ts:125`); "veil" appears only in comments, layer names (`breakVeil`), and test ids — user-visible title is "Unscheduled Break" (`satCopy.ts:200`); "module" IS user-visible by design ("Begin module" `satCopy.ts:93`, "Submit module" `satCopy.ts:85`, "You cannot return to this module after submitting." `satCopy.ts:87`, "5 minutes remain in this module." `satCopy.ts:215`) — it is the Bluebook house term taught on the directions screen meta line ("32 minutes · 27 questions", `SatDirectionsScreen.tsx:57-61`).
- **Why:** Judgment (no HIG page bans domain terms outright; `writing.md › Best practices` says "Choose words that are easily understood… Create a list of common terms, and reference that list to keep your language consistent"). "Module" passes because it is taught before use (directions screen), used identically everywhere (no section/test/block synonyms), and matches the external Bluebook vocabulary students arrive with. The internal terms correctly never reach the surface.
- **Fix-spec (NOT applied):** None. Guardrail for Phase 05 registry: add a vocabulary lint rule — fail on user-visible `stimulus|superseded|veil|terminated` outside comments/tests; allowlist `module`.

### F-04-06 (Low) — Possessive-pronoun and perspective consistency: consistent "your"-for-artifacts pattern; two flagged spots are intentional or acceptable

- **What:** Pronoun sweep of `satCopy.ts` finds "Your/your" in: display subtitle "Your answers are not affected." (:19); review eyebrow "Review your answers" (:78); "submitting your saved answers" (:88); "Your saved answers stay saved." (:99); "Your next section opens automatically…" (:107); "Your unofficial practice score is ready." (:111); paused title "Your timer is paused" (:153); shortcuts footnote "your operating system" (:192); break confirm "while you're away" (:197); veil "Your timer is still running." (:201); timer warning "Your hidden timer is shown again." (:215). No "my", no "we", no "our" anywhere in user-visible copy. Perspective: second-person-for-student-artifacts (answers, timer, score, break) vs bare nouns for chrome ("All answers saved" :131, "Question note" :37, "Display" :18).
- **Why:** Satisfies `writing.md › Best practices` ("Use possessive pronouns sparingly… use them consistently throughout your app, and try not to switch perspectives. Avoid using *we* altogether"). The file uses "your" only where it disambiguates ownership under stress (whose answers? whose timer? whose score?) and bare nouns for shared chrome — a defensible, consistently applied pattern. The double-"saved" in "Your saved answers stay saved." (:99) is flagged separately (F-04-08), not here.
- **Fix-spec (NOT applied):** None, except: if F-04-02 canonicalizes the review CTA to "Review answers" (bare), keep the H1 "Review your answers" (pronoun) — the CTA/H1 difference is then a deliberate type-level rule (CTAs bare, H1s may own the pronoun), to be recorded in Phase 05. No string changes in this finding.

### F-04-07 (Low) — H1/eyebrow naming (prior Low CONFIRMED, downgraded to keep): review H1 duplicates its eyebrow; complete H1 duplicates its eyebrow

- **What:** Review header stacks section label + "Review your answers" as subhead (`SatReviewPage.tsx:80-83`) and then repeats "Review your answers" as the H1 (`SatReviewPage.tsx:108`) — identical string twice within ~100px. Complete screen stacks eyebrow "Complete" (`SatCompleteScreen.tsx:13`) above H1 "SAT complete" (`SatCompleteScreen.tsx:14`) — same word twice. Directions screen does NOT have this problem: eyebrow "Digital SAT" (`SatDirectionsScreen.tsx:52`), H1 = section label (:53), subhead = module title (:54-56) — three distinct levels.
- **Why:** Judgment (no HIG page forbids H1/eyebrow echo directly; closest is `writing.md › Best practices` "Consider each screen's purpose… put the most important information first" and `alerts.md › Content` on titles carrying new information). Impact is polish-only: screen-reader heading navigation still works (one H1 per screen), visual users just read a stutter.
- **Fix-spec (NOT applied):** Review: change the header subhead (`SatReviewPage.tsx:82`) from `{moduleTitle} · {eyebrow}` to `{moduleTitle}` alone (the H1 below already says "Review your answers"); OR change H1 to include scope: `"Review {moduleTitle} answers"` via a parameterized copy key (e.g. `satReviewTitle(moduleTitle)`). Judgment: prefer the first (one-line, no new key). Complete: change eyebrow (`SatCompleteScreen.tsx:13`) from `"Complete"` to the section-agnostic `"Digital SAT"` (matches directions eyebrow, fixes casing pair in F-04-03).

### F-04-08 (Low) — "Your saved answers stay saved. Unsaved work on this question may be lost." — redundant + subtly alarming (leave-confirm body)

- **What:** Leave-confirm body `satCopy.ts:99`, rendered twice (`SatDirectionsScreen.tsx:152-156` as modal description + visible paragraph). "saved…stay saved" stutters; "Unsaved work on this question may be lost" introduces a second category ("unsaved work") the app otherwise never names (SPR empty-is-legal, autosave-everywhere language), at the exact moment of a destructive-adjacent exit.
- **Why:** `alerts.md › Content` ("In all alert copy, be direct, and use a neutral, approachable tone… avoid being oblique"; "Include informative text only if it adds value… keep it as short as possible") and `writing.md › Best practices` ("Be clear… If you can use fewer words, do so"). The sentence is doing genuine work (leave ≠ submit; current keystroke may not be flushed) but spends 16 words to say it and seeds doubt about the save system two screens before the student must trust it.
- **Fix-spec (NOT applied):** `satCopy.ts:99` → `"Answers you've already saved stay saved. Anything you're typing right now may not."` Two sentences, same two facts (saved = safe; in-flight = at risk), no new term ("anything you're typing" names the actual risk instead of the abstract "unsaved work"), pronoun pattern preserved (F-04-06). Keep title `leaveConfirmTitle` and both buttons unchanged. Note: modal `description` prop (`SatDirectionsScreen.tsx:152`) inherits the fix automatically (same key).

### F-04-09 (Low) — One-job-per-element spot check: 3/3 PASS (timer cell, navigator pill, footer buttons)

- **What:**
  - Timer cell (`SatExamTopBar.tsx:88-120`): the time value (`role="timer"`, :89-99) displays; the Hide/Show pill (:110-119) toggles; threshold announcements live in separate sr-only regions (:102-109). Display, control, and announcement are three elements — PASS.
  - Navigator pill (`SatExamFooter.tsx:54-71`): opens the navigator; label "Open question navigator. Question N of M" (:62) describes the action, not the state — PASS. (Presentation quirk: mobile shows "N of M" :66 vs desktop "Question N of M" :67 — deliberate brevity, not a vocabulary break; both share the aria-label.)
  - Footer Back/Next (`SatExamFooter.tsx:73-110`): Back is quiet (:32-33), Next/Review is filled-accent (:29-30); last question swaps the Next slot for a visually distinct Review action (list icon, no chevron, :84-97) — never reuses one shape for two destinations — PASS.
- **Why:** Judgment mapped to `writing.md › Best practices` ("Consider each screen's purpose") + `feedback.md › Best practices` ("Consider integrating status feedback into your interface… near the items it describes"). Each element does exactly one job and says exactly that job.
- **Fix-spec (NOT applied):** None.

## Checklist mapping (a–g)

- (a) Verb-led labels: graded in F-04-01 (5 PASS, 1 WEAK with fix-spec).
- (b) Action-name continuity: F-04-02 (review triple-name BREAK + timer continuity PASS).
- (c) Capitalization map: F-04-03 (table; 4 strings to normalize).
- (d) Error/empty/recovery: F-04-04 (SPR exemplary; save/directions/unanswered PASS; offline-recovery GAP with fix-spec).
- (e) Jargon/filler: F-04-05 (zero leaks; "module" allowlisted with rationale).
- (f) Pronouns/perspective: F-04-06 (consistent "your"-for-artifacts; no "we"; no change).
- (g) One-job-per-element: F-04-09 (3/3 PASS).

## Flow walk — directions → module → navigator → review → confirm → complete (+ leave/break variants)

| Step | Surface copy (as read) | Vocabulary break? |
|---|---|---|
| Directions meta | "Digital SAT" / section H1 / module title / "32 minutes · 27 questions" (`SatDirectionsScreen.tsx:52-61`) | None — teaches "module" before use. |
| Directions meta-note | "Calculator cleared between modules. The timer begins when you start." (`satCopy.ts:94,97`) | None — two facts, two sentences. |
| Begin | "Begin module — {Module N}" (`SatDirectionsScreen.tsx:112-116`) | None; verb + scope. |
| Blocked start | "The start button enables when the proctor opens this module." (:136-142) | None (names who + what; cf. F-04-04). |
| Module: tools | Highlight / Question note / Display / Calculator / Reference / More (`SatExamTopBar.tsx:122-202`) | Minor: top-bar says "Question note" (:138) while help/shortcuts say "Highlights & Notes" (`satHelpContent.ts:42-44`, `satShortcuts.ts:32`) — the note tool's two names. Low; Bluebook parity is the likely reason; flag for Phase 05 dedupe, no fix-spec here. |
| Module: flag | "Mark for Review" / "Option Eliminator" (`SatQuestionHeader.tsx:28-68`) | None — Bluebook terms, stable pressed state, help entries match (`satHelpContent.ts:53-63`). |
| Module: SPR | "Enter your answer" + fraction help + per-cause errors (F-04-04) | None — exemplary. |
| Navigator | "{Section} Questions" H2 + legend Current/Answered/Unanswered/Flagged (`SatQuestionNavigator.tsx:90-128`) + "Go to Review Page" CTA (:175) | BREAK → F-04-02 (CTA name vs H1). Legend word "Flagged" matches copy key `flag.flagged` (:54) — good; note review grid legend reuses the same key (`SatQuestionStatusGrid.tsx:42`) — good. |
| Review | H1 "Review your answers" + counts "N answered / N unanswered / N flagged" (`SatReviewPage.tsx:108-120`) + notice (unanswered/all-answered) + "Back to question N" / "Submit module" footer (:141-159) | BREAK → F-04-02 (H1 vs entry CTA); echo → F-04-07 (H1 = subhead). Counts use bare state nouns — good. |
| Confirm | Title "Submit {Module} answers?" (`satCopy.ts:230`) + "N unanswered · N flagged. You cannot return…" (`satCopy.ts:234`, :87) + "Keep checking" / "Submit anyway" | None — scope + counts + irreversibility + two verbs; model confirm. |
| Complete | "Complete" / "SAT complete" / "All responses submitted. Your unofficial practice score is ready." / "Back to dashboard" (`SatCompleteScreen.tsx:13-27`) | Echo → F-04-07; casing → F-04-03. "Back to dashboard" is the only "Back to…" that exits the exam (vs "Back to question/questions" which stay inside) — acceptable, distinct verb object ("dashboard"). |
| Leave variant | "Leave exam" → "Leave this exam?" → "Your saved answers stay saved…" → "Stay and continue" / "Leave without saving more" (`satCopy.ts:95-101`) | Stutter → F-04-08. Button "Leave without saving more" is honest (in-flight loss) and verb-led — good. |
| Break variant | "Take an Unscheduled Break?" → "Your testing time will continue…" → "Cancel" / "Take Break" → veil "Unscheduled Break" / "Your timer is still running." / "Return to Test" (`satCopy.ts:195-203`) | WEAK → F-04-01 ("Take Break" restates title). Veil copy itself is clean (state + live timer + one verb). "Cancel" for the break dialog vs "Keep checking"/"Stay and continue" elsewhere: three safe-exit names across three dialogs — deliberate per-dialog specificity, acceptable (each names its own context), no fix-spec. |
| Timer warning | "5 minutes remaining" + "5 minutes remain in this module. Your hidden timer is shown again." + "Close" (`satCopy.ts:213-215`, `SatTimerWarning.tsx:28-46`) | Casing → F-04-03. Dismiss uses generic `help.closeButton` "Close" (:45) rather than a verb — acceptable for a non-destructive informational alertdialog per `alerts.md › Buttons` ("In informational alerts only, you can use 'OK' for acceptance"); "Close" is the precise equivalent. No fix-spec. |
| Terminated variant | "Session ended" / "Your SAT attempt has ended" / proctor note / "Return" (`SatCompleteScreen.tsx:33-57`) | "Return" (bare, :53) vs "Return to Test" (break veil) — two Returns with different destinations. Low; flag for Phase 05: consider "Back to dashboard" to match complete-screen exit (both leave the exam). No fix-spec here (needs product decision on terminated routing). |

## Edge cases

1. Zero-question module: review counts render "0 answered / 0 unanswered / 0 flagged" (`SatReviewPage.tsx:113-120`) — grammatically fine ("0 unanswered"); `allAnswered` notice (:80) correctly shows since `unanswered === 0`. No copy change.
2. Single-question module: `satBackToQuestionLabel` yields "Back to question 1" — correct; footer last-question logic (`SatExamFooter.tsx:37`) shows Review immediately — the "Go to Review Page" triple-name (F-04-02) is most visible here; fix covers it.
3. All-flagged-none-answered: confirm summary "3 unanswered · 3 flagged" (`satCopy.ts:234`) — uses middle dot, no Oxford ambiguity; fine.
4. SPR max-length edge: help "max 5 characters (6 with a leading minus)" (`SatStudentProducedAnswer.tsx:77`) exactly matches validator limits (`studentResponse.ts:1-2,39-41`) — verified consistent, no fix.
5. Hidden-timer review: review shows "Timer hidden" noun (`SatReviewPage.tsx:91`) reusing `timer.hidden` (`satCopy.ts:115`) — same key as top-bar aria-label (`SatExamTopBar.tsx:95`) — continuous, no fix.
6. Offline-at-submit: readiness chain surfaces "You are offline. Answers are kept on this device." (`satCopy.ts:138`) on the review footer — distinct from banner "Offline — answers kept on this device." (:122): em-dash vs period + "You are" prefix. Near-duplicate intentional (banner = status, footer = blocker reason); acceptable, no fix — but Phase 05 should record the pair as deliberate.
7. Superseded-at-submit: save banner owns "Take over" recovery; review footer shows generic blocked-error + Retry — two recoveries for one lease state. Edge is rare (multi-session); no copy fix here — flag for Phase 05 interaction registry.
8. Break veil + proctor pause stacking: veil says "Your timer is still running." while a covering pause veil would say "Your timer is paused" — contradictory sentences stacked in z-order. Copy is correct per-layer (each truthful when visible); layering is Phase 02 territory. No copy fix.

## Verification

- [ ] Grep `SAT_COPY` + `satHelpContent` + `satShortcuts` for user-visible `stimulus|superseded|veil|terminated` (expect zero outside comments/tests/keys) — F-04-05 guardrail.
- [ ] Assert footer CTA text === navigator CTA text === "Review answers" post-fix (F-04-02); update e2e alias selector.
- [ ] Assert all CTA labels match `^[A-Z][a-z]+( [a-z]+)*` (sentence case) except Title-Case alert titles + "SAT" proper noun (F-04-03).
- [ ] Render review footer in offline + retrying + failed + superseded states; confirm each shows reason + exactly one recovery verb (F-04-04).
- [ ] SPR matrix: empty → no error; each validator code → documented message adjacent to field with `role=alert`; help text unchanged (F-04-04).
- [ ] Screen-reader pass: review H1 announced once with new subhead; confirm title includes module scope; leave/break dialogs announce consequence before buttons.
- [ ] 320px + 200% zoom: "Start my break" (F-04-01) and "Review answers" (F-04-02) fit CTA pills without truncation (measure on device; German/RTL pseudo-locale overflow check).
- [ ] Zero source edits: `git status --porcelain` clean on `src/` (this phase wrote only this plan file).

## Definition of done

- [x] All 13 assigned source files + 4 HIG pages read fully (table above).
- [x] Checklist (a)–(g) each graded with file:line evidence.
- [x] Findings table complete: 9 findings (0 Critical, 0 High, 2 Medium, 7 Low), each with severity + What(file:line + numbers) + Why(HIG cite+quote or judgment) + Fix-spec (exact strings, NOT applied).
- [x] Full flow walked step-by-step with every vocabulary break noted (table above; breaks point to findings, proposed strings live in Fix-spec only).
- [x] Edge cases (8), verification (8 checks), and this definition of done recorded.
- [x] ONLY file written: `plans-sat-audit/phase-04-content-flow.md`. No source file edited.
