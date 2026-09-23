# SAT Student Transitions — Specification & Requirements

Status: approved for implementation (sat student delivery, `feat/sat-bluebook-overlays-tools`).

Scope: `src/features/student-delivery/**` (route, application selectors, motion, break screen) plus its tests.
Non-goals: server timing authority, break/entry policy, proctor surfaces, authoring.

---

## 1. Intent

The student must never watch the exam walk through a carousel of intermediate screens. A module
boundary (Module 1 → Module 2, in either section) happens **inside one continuous exam frame**:
the chrome, the timer and the layout stay put, the finished content is frozen and inert behind a
calm status surface, and the next module's content replaces it in place.

Only genuinely different moments get their own surface:

```text
pre-start  →  exam (M1 → M2 → …)  →  scheduled break  →  exam (M1 → M2)  →  finalizing  →  complete
```

The exam is one surface for the whole attempt; a module handoff changes its content, never its
identity.

### Requirements

| # | Requirement |
| --- | --- |
| R1 | At most one student-visible stage is active at any time; every stage change is owned by one presence host. |
| R2 | The exam frame is **not unmounted** across a module handoff, in any section. Its DOM node, tool hosts, zoom plane and measured viewport survive. |
| R3 | A module handoff renders the finished content frozen (`inert`, `aria-hidden`, `data-sat-transition-hold`) behind one live, announced status surface. |
| R4 | A same-section module handoff never renders the scheduled-break surface. |
| R5 | The scheduled-break surface appears only at a real section boundary, and stays **one mounted node** across `waiting-for-break` → `on-break` → `opening-next-section`. |
| R6 | The break timer element is never unmounted between phases (no layout jump); it is never replaced by a misleading `0:00`. |
| R7 | A handoff never escalates to a full-screen recovery/pre-start surface while a frame exists; recovery appears in the handoff status, in frame. |
| R8 | Question-level presentation stays instant: no content cross-fade, `data-sat-question-presentation="instant"` and `[data-sat-question-transition]` count 0 are preserved. |
| R9 | Reduced motion ⇒ every stage swap is instant (no exit layer, no cross-fade). |
| R10 | An exiting stage is `inert`, `aria-hidden` and marked `data-sat-stage-exiting`, so role queries and assistive tech see exactly one surface. |
| R11 | The attempt keeps its viewport lock and measured exam height across handoff and break (no re-measure, no scroll restore mid-attempt). |
| R12 | A handoff status may name the section clock the student is still on; it must never invent a module clock for a module that has not started. |

---

## 2. Current defects (evidence)

`src/features/student-delivery/routes/SatStudentSessionRoute.tsx` returns one of ~7 mutually
exclusive full-screen trees. `ui/motion/satPresence.ts` declares `exit` variants that no
`AnimatePresence` renders, so every swap is a hard cut with a fade-in only and the exam shell is
torn down at each boundary.

1. **Wrong boundary rule.** `betweenSections` = `phase === "break" || (phase === "directions" &&
   pendingSection?.displayOrder > 0)`. The pending *section's* `displayOrder` is not a boundary
   fact: with real payloads (Reading & Writing `0`, Math `1`) the Math M1 → M2 handoff is treated
   as between sections, so it renders `SatScheduledBreakScreen` ("Next section / Opening Math…")
   mid-section and tears the frame down. Section 1 keeps the frame, section 2 does not. The unit
   fixtures use `displayOrder: 0` for Math and hide this.
2. **The hold is a freeze, not a handoff.** The `hold-exam-frame` branch renders
   `heldFrame.element` with frozen props (its countdown stops) and is skipped exactly where the
   boundary rule misfires.
3. **Escalation churn.** After `SAT_ENTRY_RECOVERY_SURFACE_MS` (5 s) or a `noop`/failed entry the
   route swaps to `SatPreStartScreen reason="restoring"` and then `SatEntryRecoveryScreen` —
   up to three more screens per boundary.
4. **Break surface churn.** `SatScheduledBreakScreen` remounts per phase; its `<p role="timer">`
   disappears in `opening-next-section`, so the card jumps at the moment it is replaced.
5. **Continuity leak.** `examViewportActive` excludes `directions`/`break`, so
   `useStudentExamPageLock` / `useStudentExamViewport` release and re-acquire mid-attempt.
6. **Dead clock in transit.** During a handoff the controller's `remainingSeconds` reads `0` for a
   section-keyed cohort model (no active module ⇒ no section identity), which is why the frozen
   frame was the only value available.

---

## 3. Design

### 3.1 One stage selector — `application/satStudentSurface.ts`

The single owner of "what the student sees". Pure, primitive inputs, exhaustive:

```ts
export type SatStudentStageKind =
  | "exam" | "scheduled-break" | "pre-start" | "entry-recovery"
  | "finalizing" | "complete" | "terminated" | "error";

export type SatStudentStage =
  | { kind: "exam"; key: string;
      content: "live" | "opening" | "skew-hold" | "refreshing";
      pendingModuleTitle: string | null }          // set only while content === "opening"
  | { kind: "scheduled-break"; key: string;
      phase: "waiting-for-break" | "on-break" | "opening-next-section";
      remainingSeconds: number | null; nextSectionKey: SatSectionKey;
      entryProgress: "idle" | "starting" | "retrying" }
  | { kind: "pre-start"; key: string; reason: "initial" | "waiting" | "restoring" | "loading" }
  | { kind: "entry-recovery"; key: string; moduleId: string | null }
  | { kind: "finalizing"; key: string; failed: boolean }
  | { kind: "complete"; key: string }
  | { kind: "terminated"; key: string }
  | { kind: "error"; key: string; reason: "load" | "state" | "question" };
```

Decision order (first match wins):

1. `loadFailed` → `error:"load"`.
2. no data → `pre-start:"loading"`.
3. result or `phase === "complete"` → `complete`.
4. terminated (proctor or runtime) → `terminated`.
5. `allModulesFinal` and phase `directions`/`submitting` → `finalizing` (`failed` when an error is
   present).
6. `phase === "submitting"` → `finalizing`.
7. `phase === "break"` **or** the pending module starts a new section → `scheduled-break`.
8. `phase` module/review:
   - module resolved → `exam:"live"`;
   - module unresolved → `exam:"skew-hold"` when a fresh frame exists (≤ `SKEW_HOLD_MS`), else
     `exam:"refreshing"`.
9. `phase === "directions"`/`"loading"`:
   - initial entry → `pre-start:"initial"`;
   - entry blocked (runtime not live / proctor blocked / stage not ready) → `pre-start:"waiting"`;
   - a retained frame exists → `exam:"opening"`;
   - entry hold not expired → `pre-start:"restoring"`;
   - otherwise → `entry-recovery`;
   - `phase === "loading"` with data and no frame → `error:"state"`.
10. anything else → `error:"state"`.

**Boundary fact.** "The pending module starts a new section" is structural, not ordinal:
in exam order (sections by `displayOrder`, then modules by `displayOrder`), take the module
immediately before the pending module; the pending module starts a new section when that
predecessor lives in a different section. Unknown predecessor (first module / reload) ⇒ `false`.
Implemented as `moduleStartsNewSection(data, moduleId)` in `application/satRuntimeSelectors.ts`.

**Presence keys.** Stable for the lifetime of a moment so a phase change does not remount:

```text
exam:<schedule>:<attempt>:<candidate>
break:<…>:<nextSectionKey>
pre-start:<…>:<reason>      entry-recovery:<…>:<moduleId>
finalizing:<…>  complete:<…>  terminated:<…>  error:<…>:<reason>
```

### 3.2 One presence owner — `ui/stage/SatStudentStageHost.tsx`

```tsx
<SatStudentStageHost stage={stage}>{content}</SatStudentStageHost>
```

- Renders the stage as one layer inside a single `AnimatePresence` over an opaque
  `--sat-background` backdrop; layers are absolutely positioned so incoming and outgoing never
  fight for layout.
- Pure cross-fade (`satStageAnimation` in `ui/motion/satPresence.ts`, opacity only, durations from
  `ui/motion/satMotion.ts`).
- Reduced motion ⇒ the host renders the current layer without presence at all (instant swap).
- The exiting layer is `inert`, `aria-hidden="true"`, `data-sat-stage-exiting="true"`.
- Every layer carries `data-sat-stage="<kind>"` and `data-sat-stage-key="<key>"` so "exactly one
  active stage" is assertable in unit tests and e2e.

### 3.3 Exam frame continuity — route

- The route renders every branch through the stage host.
- The last resolved exam frame stays in `lastValidFrameRef` (element identity), so the handoff
  branch renders **the same element object** at the same tree position as the live branch: React
  reconciles it and the shell instance, DOM, tool hosts and zoom plane survive the handoff.
- Handoff content (`exam:"opening"`) renders, inside the stage layer:
  1. the retained frame inside a wrapper marked `data-sat-transition-hold`, `inert`, `aria-hidden`
     (this also keeps `useSatShortcuts`' existing keyboard guard working), and
  2. `SatModuleHandoffFrame`'s live status card **as a sibling of that wrapper** — outside the
     hidden subtree, so its status and its Retry button are reachable and announced.
- The card states `opening` → `retrying` in frame: "Opening …" → "Still opening …" plus
  *Retry now* (`exam.retryModuleEntry`). `SatEntryRecoveryScreen`/`SatPreStartScreen` remain for
  the no-frame paths only (first module, reload mid-handoff).
- The card may show the remaining **section** clock (`exam.handoffSeconds`); nothing states a
  module countdown for a module that has not started.
- Question/answer content still swaps instantly (R8): no content cross-fade anywhere.

### 3.4 Break surface — `ui/break/SatScheduledBreakScreen.tsx`

- One mounted node for the whole break; identity comes from the stage key, never the phase.
- The `<p role="timer">` element is mounted from the first phase to the last. In
  `opening-next-section` it is kept in the DOM, `aria-hidden`, and `visibility: hidden` inline, so
  the card does not jump and no `0:00` is ever presented as remaining time.
- Copy per phase is unchanged; the run-out phase keeps naming the entry progress.

### 3.5 Continuity plumbing

- `examViewportActive` covers the whole attempt (`module`, `review`, `directions`, `break`,
  `submitting`), so the page lock and the measured exam height never toggle mid-attempt.
- Controller exports `handoffSeconds: number | null` — the shared section clock while the published
  stage still names the section the pending module belongs to (section-keyed and stage-keyed cohort
  models); `null` when the frame has no authority.

---

## 4. Acceptance criteria

Unit / route (jsdom, `npx vitest run`):

1. `deriveSatStudentStage` table: every combination of phase, frame, pending-module section and
   entry flags yields exactly one stage; a handoff in the **Math** section (fixture
   `displayOrder: 1`) yields `exam:"opening"`, never `scheduled-break`.
2. `moduleStartsNewSection`: M1 → M2 same section ⇒ false; last module of a section → first module
   of the next ⇒ true; first module / unknown ⇒ false.
3. Route handoff: the live module frame → submit → handoff keeps the *same* `sat-exam-shell` DOM
   node, shows one status card, never the break surface; a failed first entry escalates to
   "Still opening …" + Retry in frame; the retained content is inert (`inert`, `aria-hidden`,
   radio click and `Control+Alt+x/c` do nothing).
4. Route stages: exactly one `[data-sat-stage]` is active; role queries see one surface (exiting
   layers are excluded by `aria-hidden`).
5. Break: one node across all three phases; no `role="timer"` in `opening-next-section`, but the
   timer element stays in the DOM.
6. Reduced motion: stage swaps are instant — no exiting layer remains.
7. Proctor pause still owns the screen; termination still wins over the retained frame.

E2E (`playwright test --config playwright.sat-transition.config.ts`, needs `TEST_DATABASE_URL`):

8. Across M1 → M2 in **both** sections, `sat-exam-shell` is visible before, during and after the
   handoff, and `[data-sat-transition-hold]` never replaces it.
9. The break surface appears only after the section clock ends, keeps one node through
   `waiting-for-break` → `on-break`, and only one `[data-sat-stage]` is active at a time.
10. No horizontal overflow at 390×844, 768×1024, 1440×900 on every stage.

---

## 5. Risks and decisions

- **Frozen frame props.** The retained frame is a React element with its props frozen at the last
  live render; its countdown therefore stops. Accepted: the handoff card carries the live section
  clock, and a running-looking clock is never faked. A future iteration may promote the handoff to
  a real runner phase so the frame re-renders live.
- **One shell remount remains.** Review → next module remounts the shell (different content shape
  in the same frame). The surface identity, page lock and measured height survive, so there is no
  flash; only transient tool UI resets.
- **Exit layers in tests.** Exiting stages stay in the DOM for one exit duration. They are
  `aria-hidden`, so role queries ignore them; assertions on a *departing* surface by test id or text
  must use `waitFor`.
- **Pause.** A proctor pause keeps its own full-screen surface (Bluebook parity); it is now
  cross-faded rather than cut.
