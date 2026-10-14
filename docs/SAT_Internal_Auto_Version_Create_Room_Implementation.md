# SAT Internal — Automatic Exam Versioning & One-Action Room Creation

**Implementation specification (frontend + supporting backend contract)**  
**Repository:** https://github.com/teaching01-netizen/IELTS-LMS  
**Reviewed:** 2026-10-14, `main` (Git tree `b0be8c0e246fc8bb4d71a6bcb9d050ab32c93810`)  
**Document status:** Implemented in this repository (backend `internal/satrooms`, migration `0088_sat_room_operations.sql`, `POST /api/v1/sat/exams/{id}/rooms`, `GET /api/v1/sat/room-operations/{key}`, `GET /api/v1/sat/exam-config/defaults`). Deviations from the proposal: a release is reused when the working draft is an untouched clone of the current release (`exam_versions.revision = 0`) rather than via a stored fingerprint; Create exam configures settings through a "Customize settings" disclosure in one dialog instead of two stages; Settings keeps its existing per-section editors and gains the Results & scoring group; the score-report switch remains a live exam-level setting.
**Scope:** Digital SAT Internal only. Existing IELTS/ACT flows must remain unchanged.

**Formal verification (2026-10-14):** See [the proof report](../verification/lean/sat-auto-room/PROOF_REPORT.md). The pinned Lean model establishes conditional safety; production correctness is **NOT ESTABLISHED**. Verification fixes add mandatory revision fences, an immutable response snapshot in migration `0089_sat_room_response_snapshot.sql`, and actor/exam-scoped unknown-operation recovery. Only an opaque operation key persists in tab session storage; roster/request data stays in memory and is unavailable for retry after reload or expiry. A retained key can still query a committed outcome. Legacy receipts without a response snapshot cannot promise exact original response fields. The fingerprint/equal-scope requirements below remain stronger than the documented clone/coverage implementation; they are not claimed as verified.

---

## 0. Executive decision

**Eliminate manual publishing from the Digital SAT authoring experience.** Staff create an exam, configure its rules once, edit and save questions/settings, and select **Create room** when ready. That action transparently validates and captures the **latest server-committed exam** as an immutable student-facing version and creates a room pinned to it. Existing rooms keep their original version. Opening or saving an exam **does not** create a published release; creating a room does.

**Three user-visible activities:**

1. **Create exam:** enter the exam name and configure exam-level settings (using prepopulated SAT defaults), then create the draft.
2. **Edit exam:** author content; save continuously using the existing acknowledged-save/co-edit infrastructure; adjust all exam-level configuration under **Settings**.
3. **Create room:** enter room-specific options; press **Create room** once. The system handles save acknowledgment, validation, version creation/reuse, and room creation. The room details page opens on success.

**One primary CTA, not two:** there is no Publish, Publish changes, Publish & create, version-source radio group, publish notes, or publish-scope selector in the staff room-creation journey. Version details are informational only (e.g. “This room will use the latest saved exam”). Preserve versioning, validation, auditing, and immutability *internally*.

**Recommended rollout architecture:** implement a **single backend-coordinated create-room operation** with transaction-safe publication and room creation. Do *not* implement the feature merely as sequential frontend `publish()` then `createLink()` calls: that exposes partial success, orphan releases, uncertain retries, and cross-tab races.

---

## 1. Verified current repository findings

| File or service | Current role / change required |
|---|---|
| [`src/features/exam-authoring/ui/shell/ExamWorkspaceHeader.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/shell/ExamWorkspaceHeader.tsx) | The header currently chooses Publish as primary for drafts and Create room for published exams. Replace lifecycle-based dual actions with one **Create room** primary action whenever permission allows. |
| [`src/features/exam-authoring/ui/publish/SatCreateRoomFlow.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/publish/SatCreateRoomFlow.tsx) | Already coordinates publish + access-link creation in two calls, but includes published-vs-draft selection, scope confirmation, publish readiness UI, and reconciliation. Simplify to a room form using the new composite endpoint. |
| [`src/features/exam-authoring/ui/publish/ExamPublishSheet.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/publish/ExamPublishSheet.tsx) | Separate manual publishing surface. Remove from SAT primary journeys; retain only temporarily behind a compatibility flag if other callers require it. |
| [`src/features/exam-authoring/ui/publish/useSatPublish.ts`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/publish/useSatPublish.ts) | Implements collaboration flush, committed-shell refresh, readiness checks, draft fences, and publish receipt handling. Reuse the flush/acknowledgment concepts, **not** the two-call publish/create UX. |
| [`src/products/sat/routes/SatExamLibraryRoute.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/products/sat/routes/SatExamLibraryRoute.tsx) | Creation currently asks only for name; enhance to configure exam-specific defaults and save them atomically with creation. Remove user-facing Published/Drafts vocabulary that implies manual publication where appropriate. |
| [`src/products/sat/routes/SatNewSessionFlow.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/products/sat/routes/SatNewSessionFlow.tsx) | Global Rooms entrypoint currently filters to previously published exams. Allow any viable SAT exam; use the same create-room coordinator. |
| [`src/products/sat/routes/SatSessionsRoute.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/products/sat/routes/SatSessionsRoute.tsx) | Its Create room control should support exams never manually published. |
| [`src/features/exam-authoring/ui/access-links/AccessLinkEditorSheet.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/access-links/AccessLinkEditorSheet.tsx) | Existing robust editor for room name, section scope, session type, adaptive/forced/teacher-selected M2 routing, audience, access mode, time window, and roster. Keep these as **room-specific**, not exam creation settings. |
| [`src/features/exam-authoring/ui/settings/ExamSettingsPage.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/settings/ExamSettingsPage.tsx) / [`DeliverySettingsPanel.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/settings/DeliverySettingsPanel.tsx) | Already expose module timing, breaks, routing threshold. Expand into one coherent exam-settings ownership surface. |
| [`src/features/exam-authoring/ui/release/ScoreReportSettingPanel.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/release/ScoreReportSettingPanel.tsx) | The score report toggle is exam-level but currently read live by the backend (changes affect historical attempts). Move its editor to Settings, and explicitly decide historical behavior before claiming version immutability covers it. |
| [`src/features/exam-authoring/ui/release/ScoreConverterPanel.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/release/ScoreConverterPanel.tsx) | A separate exam-versioned estimated-score converter exists. Preserve the current scoring contract; never silently confuse it with global SAT score conversion. |
| [`src/products/sat/SatRoot.tsx`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/products/sat/SatRoot.tsx) | Existing SAT navigation and collaboration boundary. Maintain boundary across exam Questions/Settings/Rooms and ensure no unmount loses unsaved work. |
| [`backend/go/internal/exams/service.go`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/internal/exams/service.go) | `Publish` seals the current draft and updates published pointers in a transaction, with revision fences and an operation key. Extract reusable transaction-scoped release logic for composite room creation. |
| [`backend/go/internal/exams/sat_initialization.go`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/internal/exams/sat_initialization.go) | SAT drafts already receive Reading & Writing and Math sections, two branches per Module 2, default timings (RW 32 min; Math 35 min), routing policy, and scoring config. Extend creation to accept validated overrides without duplicating initialization logic. |
| [`backend/go/internal/accesslinks/service.go`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/internal/accesslinks/service.go) | `Create` atomically creates a schedule, access link, and roster and pins a *previously published* version. Extract an in-transaction creation helper for the composite operation. |
| [`backend/go/cmd/api/main.go`](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/cmd/api/main.go) | Register the new SAT-specific endpoint. Keep existing `/v1/exams/{id}/publish` and access-link endpoints for backward compatibility while migrating callers. |

**Architecture constraint:** the current `Publish` implementation **seals the working draft** (`current_draft_version_id = NULL`). Existing screens explicitly reopen or request a new draft later. The new UI must hide this lifecycle detail **without** turning read requests into writes or losing in-flight collaboration edits. See §7.4.

**Existing publish-scope constraint:** publish scope (`full`, `reading-writing`, `math`) and access-link `enabledSections` are two different layers. The new design must retain their validation/security semantics, while removing their redundant user-facing exposure.

---

## 2. User experience specification — what staff see

### 2.1 Main SAT exam editor

- Header: exam name; subtle save indicator **Saving… / Saved / Unable to save**; **Preview** (secondary); **Create room** (only primary action); More menu.
- Tabs: **Questions | Rooms | Responses | Settings**. These remain genuine URL-backed routes for deep links, Back/Forward and reload.
- Remove all prominent **Publish**, **Publish changes**, **Review publication** actions for SAT.
- A small, non-blocking status line can say: **“Changes are saved automatically. A room uses the latest saved exam.”** Avoid draft/publish concepts in standard copy.
- If editing is blocked by actual permissions, hide or disable Create room based on server-provided capability with an accessible explanation.
- Never enable an unsafe Create action while critical edits are unacknowledged; allow opening the form while saving, but gate submission and explain the current state.

### 2.2 Create exam: initial one-time configuration

Use a dedicated, keyboard-accessible **Create exam** flow, not a tiny name-only modal overloaded with dozens of fields. A two-stage dialog/page is appropriate because the initial decision includes multiple independent setting groups:

**Stage 1 — Exam details**
- Exam name (required; unique slug if supported by existing rules).
- Exam sections: Full SAT (default), Reading & Writing only, or Math only **only if product policy explicitly supports authoring a partial exam**. Keep section-scoped *rooms* separately available even for full exams.
- Preset: **Standard Digital SAT** (default), with an explicit **Customize settings** option.

**Stage 2 — Exam configuration**
- RW Module 1 duration, RW Module 2 lower/higher duration (default 32 minutes each).
- Math Module 1 duration, Math Module 2 lower/higher duration (default 35 minutes each).
- Break between sections (derive default from server blueprint; do not hardcode an unverified value in frontend).
- Adaptive Module 2 thresholds per section (prefilled with the server-calculated operational-question defaults; do not require users to compute them).
- Per-exam score report visibility for Classroom completion (default per existing product policy).
- Versioned scoring-converter settings **only if managed per exam**; otherwise show a read-only “Uses global SAT conversion policy” link to the existing dedicated admin Settings surface. Do not make a second independent global editor.
- If existing exam-level SAT classroom plan or other exam-level grading policy is configurable, expose it under the appropriate advanced settings group; keep genuinely runtime-owned controls read-only.
- Group advanced controls into **Timing**, **Adaptive routing**, **Results / Scoring**. Present all supported settings, but keep advanced sections collapsible, with sensible defaults visible in a summary.
- Sticky footer actions: **Back / Create exam**; show server error inline, focus first invalid field; preserve choices when moving between stages.
- After creation: navigate to the Questions tab with all settings already persisted. There must never be a half-created exam waiting for a second client call to save settings.

**Recommended copy:** “You can change exam settings later in Settings. Rooms already created will keep their exam content and delivery configuration.” If some policies intentionally act live (such as current score-report visibility), state that exception precisely instead of promising full immutability.

### 2.3 Settings: one authoritative home for exam-level options

Use the **same reusable field group components and Zod schema** in Create exam and Settings, but keep distinct save modes:
- Create exam: submit one full exam-configuration object in a single operation.
- Settings: edit existing values; persist with revision-fenced mutation(s); show confirmed save state.
- Settings groups: **General**, **Sections & timing**, **Adaptive routing**, **Results & scoring**, and **Advanced / runtime policies**.
- General: exam name, default delivery sections/preset if supported.
- Sections & timing: each delivered module and section break.
- Adaptive routing: threshold and any existing exam-level classroom-plan settings. Keep *per-room* forced/easy/hard/teacher-picks M2 routing in Create room.
- Results & scoring: report access toggle, exam-level scoring info, global score conversion link/summary. Preserve authorization boundaries.
- Runtime policies: retain read-only controls until corresponding typed write contract, auditing, and regression tests exist (`RuntimePolicyPanel.tsx` already warns about this).
- Avoid maintaining two independent UI implementations for the same field. Use a reusable `ExamConfigFields` component with a normalized `ExamConfig` domain model.
- Visually indicate unsaved data; on navigation, use an existing dirty-state protection pattern. No success toast for every keystroke.

### 2.4 Create room: one submit, transparent version capture

The existing `AccessLinkEditorSheet` is a good base. New entrypoints must all lead to the same form:

- From Exam > Questions, Rooms, Preview (if appropriate): context exam is preselected.
- From global SAT > Rooms: choose **any SAT exam** with permission (not only published exams), then see the same fields.
- Default fields: **Room name** (required), **Session type** (Practice / Classroom), **Sections delivered**, **Access** (existing defaults), **Availability** (Anytime / Scheduled).
- Conditional Classroom fields: **Module 2 routing** (Adaptive default, Force lower, Force higher, Teacher chooses). Keep this on the room because classrooms can run the same exam with different teaching modes.
- “More options”: audience filters, roster import, scheduling details and optional advanced room controls. Keep accessible and preserve data when expanded/collapsed.
- Omit: publish version chooser, publish scope chooser, publish notes, pre-publish dialog, extra confirmation after successful validation.
- A plain line under the exam name: **“A saved exam version will be created automatically for this room.”** If no changes have occurred since the previous room, avoid implying a new version number will be minted.
- Footer has **Cancel** and the single **Create room** primary action. After submission, the button shows **Preparing room…**; show substatus (Checking saved changes → Checking exam → Preparing version → Creating room) when the operation genuinely reaches those states. Never fabricate progress percentages.
- Success: navigate to room details; show shareable student link, room code / start procedure as supported; show version number in a secondary Details disclosure.

### 2.5 Unready exam: precise inline error, not a Publish page

If validation detects missing questions, invalid routing, unavailable media, or unsupported settings:
- Keep the create-room form open, preserving all typed fields.
- Show a concise **“Room not created — fix 3 exam issues”** summary.
- Each issue offers a direct **Fix question / Fix setting** link, reusing existing `resolvePublishIssueDestination` routing where possible.
- **Never create a partial student room.** No room link or schedule should exist after a definitive validation error.
- Returning from a fix should restore the room form's in-progress draft, subject to a fresh revision check; use route-state or a shared in-memory draft, not sensitive query strings. If reload persistence is needed, scope it to the staff user and exam, with an expiry.
- Revalidate server-side on the next submission. UI validation is convenience only.

---

## 3. Important configuration ownership boundaries

**Exam-level settings** are configured once at creation, revisited in Settings, and (unless deliberately defined as live global policy) captured in the version delivered to each room:
- Sections and module structure, default timings, break timings.
- Adaptive grading/routing thresholds and per-exam teaching plan where supported.
- SAT tool policy where the existing backend actually exposes a typed editable contract.
- Exam score-report policy (see compatibility decision below).
- Exam-specific score policy/converter if retained.

**Room-level settings** are chosen each time the room is made:
- Room name, session type, Classroom Module 2 override, room section subset, audience / roster.
- Student access mode, availability schedule, opening/closing times, room-specific permissions where supported.
- Room lifecycle (active, paused, revoked), proctor actions, live adjustments.

**Global SAT settings** stay in the admin-wide settings surface, not duplicated in each exam:
- Organization/global SAT score-conversion policy and its history (existing `/sat/score-conversion`).
- System-owned defaults and operational runtime protections.

**Specific compatibility warning:** the current `ScoreReportSettingPanel.tsx` explicitly says its toggle is read live and **affects past attempts**. Decide one product rule and test it: recommended future behavior is **snapshot per room** if historical consistency matters; alternatively retain the existing global/live visibility semantics and label it accurately. Changing the toggle's screen location alone does not change its backend semantics.

**Another compatibility warning:** global SAT score-conversion changes may intentionally rescore historic attempts in this product. Do **not** quietly pin that global scoring policy to a room merely because exam-content versioning becomes automatic. The versioned *exam content/config* and the separately governed *global conversion table* must have distinct and documented historical behavior.

---

## 4. Automatic versioning — exact rules

### 4.1 User mental model

- A staff member edits the **working exam**; edits are server-acknowledged.
- Creating a room creates or reuses an **immutable release snapshot** from the latest saved exam.
- Every room has exactly one immutable `publishedVersionId`.
- Further edits never change a running, completed, or scheduled room's captured content/configuration.
- There is **no Publish button** and no version-management task for ordinary staff.

### 4.2 Reuse-versus-new-version algorithm

Let `effectiveFingerprint` be a **server-computed canonical hash** of all fields that change student delivery for the selected sections, including the relevant content/question revisions, question order, asset identifiers, durations, routing configuration, scoring policy/version where applicable, and effective section scope. Do **not** hash frontend JSON in an arbitrary key order; normalize server-side. Do **not** include mutable room name, roster, window, or unrelated UI metadata.

1. Server locks/resolves the current committed exam and expected draft revision.
2. If a valid published release already has the **same effective fingerprint and same deliverable scope**, reuse its version ID for the new room.
3. Otherwise validate the committed draft and create the next immutable version, assigning a monotonically increasing version number for the exam, then pin the room to that exact version.
4. Commit the release (if needed), room backing schedule, access link, roster, and the operation-result receipt together.
5. Repeating the same operation key with the same request returns the exact original room and version; a different request using the same key is a conflict.

**Important:** The current schema may not persist a content fingerprint. Introduce a durable `release_fingerprint` / `effective_scope` on `exam_versions` or an equivalent immutable release-lookup index only after auditing existing columns, constraints, and historical releases. Do not rely only on `current_published_version_id`, because the newest published version may be for a different subset of sections. Reuse only immutable versions whose fingerprint and delivery scope are equal. Make the fingerprint algorithm itself versioned, e.g. `sat-release-fp:v1`.

### 4.3 Example scenarios

| Scenario | Correct behavior |
|---|---|
| First room from a completed new exam | Validate, create initial release (e.g. v1), create room pinned to v1. |
| Second room without exam changes and same scope | Reuse v1, create a *new* room pinned to v1. |
| Author changes one Math question, saves, creates another room | Create v2, pin the new room to v2. Old room stays on v1. |
| New room uses Math only, old room uses Full SAT | Different effective scopes; reuse only a release validated/captured for the Math scope. |
| Two staff create rooms concurrently from same revision/scope | Serialize version selection; release is created at most once, but distinct operation keys create distinct rooms. |
| Same staff double-clicks or retries after timeout | Same idempotency key returns the same room, not a duplicate. |
| Draft changed on another tab after form opened | Return 409 `EXAM_REVISION_CHANGED`; preserve form, offer Refresh exam. Do not silently deliver unexpected content. |
| Media validation fails | Return structured issue list; publish/version and room writes roll back; no student link. |
| Room creation fails mid-transaction | No orphan publication or schedule; retry is safe. |
| Room already started/completed, exam later edited | Previous room's content, routing, scoring snapshots (where versioned), and results remain stable. |

### 4.4 The publishing/draft lifecycle compatibility choice

**Pragmatic first implementation (preferred for this repository):** keep the current server lifecycle, where publishing seals the draft, **but hide it completely from staff**. After room creation, the next *explicit edit action* automatically opens the next draft from that published version, using existing `ReopenDraft` / `requestAuthoringDraftOnEntry` semantics. No `GET`, page mount, preview, or background polling should create drafts. Once reopened, editing/autosaving proceeds as before. This preserves current backend assumptions and minimizes risky changes to attempt delivery.

**Possible later improvement (not required for initial rollout):** implement a permanently editable working copy where a release is an immutable clone of the draft. That requires changing draft-pointer semantics, clone behavior, revision tracking, and every release-state consumer. Do not mix this deeper change into the initial one-action room rollout unless it is independently designed and regression-tested.

**Non-negotiable safety:** never seal a draft while its collaboration provider has unacknowledged local edits. The frontend must call the existing `flushAndWaitForSaved` barrier before submitting; the backend must then check its own committed revision under lock. A client-only wait is not sufficient.

---

## 5. New API contract (proposed)

### 5.1 Unified room creation endpoint

`POST /api/v1/sat/exams/{examId}/rooms`

Authenticated staff action. The backend authorizes the actor for this exact exam and room-creation privilege; it should *not* rely on the frontend hiding a button.

```json
{
  "operationKey": "a-client-generated-stable-uuid-for-this-submission",
  "expectedExamRevision": 18,
  "expectedDraftVersionId": "working-version-id-or-empty-string",
  "expectedDraftRevision": 46,
  "room": {
    "name": "October SAT Math Classroom",
    "enabledSections": ["math"],
    "satSessionMode": "classroom",
    "satRoutePolicy": "adaptive",
    "audienceType": "anyone",
    "audienceLabel": null,
    "accessMode": "student_code",
    "availabilityType": "anytime",
    "opensAt": null,
    "closesAt": null,
    "selectedStudents": []
  }
}
```

Notes: the implemented contract requires `expectedExamRevision` and `expectedDraftVersionId`; use **an empty string** for `expectedDraftVersionId` when no working draft exists, and omit `expectedDraftRevision` in that case. When a working draft exists, its revision is also required. The server resolves the exact current release under lock. The request uses the existing access-link enum values; reuse current `CreateAssessmentAccessLinkRequest` validation rather than creating incompatible room rules. `operationKey` is created at form submission time and reused for retries of that same attempt; it is **not** minted anew after a timeout. Exact field names can adapt to existing Go conventions, but publish revision and room idempotency must be part of the same operation.

**201 Created** (new room) or **200 OK** (replayed operation):

```json
{
  "room": {
    "id": "access-link-id",
    "scheduleId": "backing-schedule-id",
    "examId": "exam-id",
    "publishedVersionId": "immutable-version-id",
    "name": "October SAT Math Classroom"
  },
  "version": {
    "id": "immutable-version-id",
    "number": 3,
    "scope": "math",
    "createdNow": true
  },
  "exam": {
    "revision": 19
  }
}
```

The example is **illustrative**, not an existing endpoint. Actual response should return the existing access-link representation to avoid adding another adapter; include release information in a compatible envelope or typed property. `createdNow` indicates whether the release was generated in this operation, not whether the room was newly created.

**Error contract** (stable machine codes, localized-friendly user copy):

```json
{
  "code": "EXAM_NOT_READY",
  "message": "Fix the exam issues before creating a room.",
  "issues": [
    {
      "code": "MISSING_MODULE_QUESTIONS",
      "path": "sections.math.modules.m1",
      "message": "Add the required questions to Math Module 1."
    }
  ],
  "currentExamRevision": 19
}
```

| HTTP | Code | Frontend action |
|---|---|---|
| 400 / 422 | `ROOM_INVALID` | Show room field errors, focus first invalid control. |
| 422 | `EXAM_NOT_READY` | Show question/setting/media issues, deep-link to fixes. |
| 403 | `ROOM_CREATE_FORBIDDEN` | Explain access, do not retry automatically. |
| 409 | `EXAM_REVISION_CHANGED` | Preserve room draft, refresh committed exam, explicitly retry. |
| 409 | `OPERATION_KEY_CONFLICT` | Do not retry with changed payload under same key. |
| 409 | `OPERATION_IN_PROGRESS` | Read/query operation receipt; do not issue a new create key. |
| 503 / network ambiguity | `OUTCOME_UNKNOWN` | Query operation status by key; show Check status, block a second submit until resolved. |

Provide `GET /api/v1/sat/room-operations/{operationKey}` (scope to actor/org/exam and permissions), or an equivalent existing authorized receipt lookup. Never attempt to reconcile only by room name + timestamps; legitimate rooms can share names.

### 5.2 Exam creation API

**Prefer extending** the current SAT exam creation contract in a backward-compatible way, rather than POST exam then N PATCH calls:

`POST /api/v1/exams`

```json
{
  "providerKey": "sat",
  "providerExamType": "SAT",
  "title": "Practice Test 06",
  "configuration": {
    "preset": "standard_sat",
    "sections": {
      "reading-writing": {
        "enabled": true,
        "module1Minutes": 32,
        "module2LowerMinutes": 32,
        "module2HigherMinutes": 32,
        "breakAfterMinutes": 10,
        "minimumCorrectForHigher": 14
      },
      "math": {
        "enabled": true,
        "module1Minutes": 35,
        "module2LowerMinutes": 35,
        "module2HigherMinutes": 35,
        "breakAfterMinutes": 0,
        "minimumCorrectForHigher": 12
      }
    },
    "showClassroomScoreReport": false
  }
}
```

**The numeric thresholds and break values above are examples only**; populate creation defaults from the **backend** SAT blueprint and derived operational-question rules, not these example numbers. The API should first expose `GET /api/v1/sat/exam-config/defaults` or incorporate a versioned `defaults` record in existing provider metadata. Validate on the server and apply all config overrides within the same `Create` transaction that calls `initializeSATDraftTx`.

Do not mix per-room routing choices into initial exam configuration. If `sections.enabled` cannot be made fully safe with the current SAT blueprint, default to always creating the full SAT structure and let each room select sections instead; this is the lowest-risk starting point.

### 5.3 Settings API

Use the existing revision-fenced `PATCH /v1/assessment-authoring/exams/{examId}/sections/{sectionId}/delivery-settings`, `PUT /sat-classroom-plan`, `PUT /sat-score-converter`, and exam metadata update endpoints where they already fit. For truly unified save behavior, introduce a typed SAT exam-config command that updates multiple related settings **atomically**, with `expectedExamRevision` and `expectedDraftRevision`; implement it only if the existing per-section mutation semantics cannot meet the UX safety contract.

Suggested typed model (frontend):

```ts
export type SatSectionKey = 'reading-writing' | 'math';

export interface SatSectionConfig {
  enabled: boolean;
  module1Minutes: number;
  module2LowerMinutes: number;
  module2HigherMinutes: number;
  breakAfterMinutes: number;
  minimumCorrectForHigher: number;
}

export interface SatExamConfig {
  preset: 'standard_sat' | 'custom';
  sections: Record<SatSectionKey, SatSectionConfig>;
  showClassroomScoreReport: boolean;
  // Keep global scoring conversion outside this object.
}
```

Use current backend constraints for minima/maxima and question-count-dependent thresholds. A type declaration alone is not sufficient validation.

---

## 6. Backend implementation plan (necessary for a correct frontend)

### 6.1 Service boundaries

Add SAT-specific orchestration in a **new service**, for example `backend/go/internal/satrooms/service.go`; do not move SAT-only decisions into shared IELTS paths.

Responsibilities:
1. Authenticate and authorize staff for exam and room creation.
2. Parse and validate the proposed room input (reuse `accesslinks` normalizers and `ParseSATSession`).
3. Check the persisted draft/media before publication; preserve existing `verifySATPublishMedia` gate. Never perform network/object-store I/O while holding long-lived database locks if it can be safely done beforehand; **re-fence the revision** inside the transaction.
4. Within **one DB transaction**: claim composite `operationKey`, lock exam/version in canonical order, verify expected revision, compute/lookup effective release fingerprint, validate deliverable section scope, create-or-reuse immutable published release, create backing schedule/link/roster, persist operation result receipt, and append authoring/release events.
5. Commit, then return the created room receipt, regardless of projection/list refresh speed.

**Refactor required:** `exams.Service.Publish` and `accesslinks.Service.Create` currently each begin their own transaction. Extract internal `...Tx` helpers (`publishDraftTx`, `createAccessLinkTx`, `pinExamVersionTx`) and let both old handlers and the new SAT operation call those helpers. **Never nest** independent `runner.WithTx` calls and assume atomicity.

**Lock order:** choose one documented order everywhere (exam entity → working version and its relevant rows → release candidate/uniqueness record → schedule/link), and keep it consistent to prevent deadlocks. Add retry on specifically classified DB deadlocks at the service boundary only when the idempotency key preserves exactly-once semantics.

**Media preflight:** the repo currently preflights before entering the `Publish` transaction and then checks version/revision inside. Keep this two-layer guard; a stale preflight cannot authorize a different draft.

### 6.2 Version creation and audit

- Persist immutable content/config revisions and assets for a release, using the existing question snapshot/copy behavior.
- Preserve existing `sat_publish_scope` semantics. For a Math-only room, its release must be validated for Math only and `enabledSections` must stay a subset; otherwise reject.
- Reuse release only if server-confirmed fingerprint, scope, and needed policy identity match.
- Ensure `(exam_id, version_number)` remains unique and next-version assignment is serialized.
- Keep `exam_events`, outbox/realtime notifications, and release/audit receipts consistent with current `Publish` behavior.
- Do not edit or re-point rooms already created; their `publishedVersionId` remains stable.
- Publish failure after preflight must roll back the entire new room operation.
- If a preexisting published release is reused, **do not** mark it as newly published or bump version.

### 6.3 Durable idempotency, operation status and errors

Current publishing has an operation-key table (`authoring_operation_keys`) and existing room UI attempts fuzzy reconciliation after a lost response. For the composite call:
- Introduce a unique, durable `sat_room_operations` receipt keyed by a scoped operation key (e.g. `(org_id, actor_id, operation_key)`), with **request hash**, `exam_id`, `room_id`, `release_id`, timestamps and status/result.
- Create the receipt inside the same transaction as version + room writes. If background preflight/processing is asynchronous, explicitly model `pending`, `complete`, and `failed` with a separate lease protocol; do not pretend atomicity across separate commits.
- Replay returns the exact same room. Same key/different request returns 409.
- If user edits room fields after an unsuccessful but potentially committed attempt, first resolve the previous key. Start a new key only after a **definitive** no-commit outcome.
- Treat genuine unavailable-state as uncertainty, not automatically as failure.

### 6.4 First-time creation and Settings

- Extend `CreateRequest` and `initializeSATDraftTx` to accept a typed validated config, using the SAT blueprint as the defaults source. Persist exam entity, version, sections, module durations, routing and score report policy in **one creation transaction**.
- Do not accept or silently ignore unsupported keys; reject malformed config with per-field errors.
- Settings writes must use explicit expected revisions and server acknowledgment; concurrent editors should see conflicts instead of silently overwriting each other.
- For published-only exams, automatically reopen the draft on a user-initiated first edit, **not** on route entry/read.

### 6.5 Data migration and compatibility

Before altering tables, inspect current actual production schema and migration policy (`backend/go/cmd/migrate/MIGRATION_POLICY.md`). Prepare additive, reversible migrations as appropriate:
- New release fingerprint/index metadata if required.
- Composite operation receipts and unique idempotency constraint.
- New exam config columns **only** if settings cannot be represented in the existing version/section records. Avoid storing the same setting redundantly in JSON and columns.
- Historical versions receive `fingerprint = NULL` unless correctly backfilled; don't assume a hash can be computed from incomplete legacy snapshots.
- Existing rooms, attempts, results, published versions and student links must remain readable and stable.
- Keep legacy publish endpoint operational during rollout. Prevent old frontend clients from creating a room against the wrong version; version-pin every request.

---

## 7. Frontend architecture & detailed file changes

### 7.1 Keep existing technologies

- **React 19 / TypeScript / Vite / React Router:** keep as is.
- **TanStack Query:** server state, mutations, cache invalidations, recovery/refetch; never use global Zustand for authoritative exam version data.
- **React Hook Form + Zod:** standardized validation, dirty tracking, and accessible error/focus flow for Create exam and Create room.
- **Radix + existing `sat-` components/Tailwind tokens:** accessible dialogs, field labels, progress announcements, keyboard focus; do not build a parallel UI kit.
- **Yjs/Hocuspocus:** retain the current collaboration provider and acknowledgment barrier, while forbidding room creation from uncommitted content.
- **Vitest/Testing Library/Playwright:** unit, integration, E2E accessibility and concurrency.

### 7.2 Suggested feature organization

Keep existing module boundaries, add **focused** files rather than one 900-line orchestration component:

```text
src/features/exam-authoring/
  contracts/
    satExamConfig.ts                 # typed exam configuration
    satCreateRoom.ts                 # composite request/response + error types
  api/
    satExamConfigApi.ts              # defaults/config endpoints
    satCreateRoomApi.ts              # POST room + GET operation receipt
    satCreateRoomQueries.ts          # mutation, keys, invalidations
  application/
    useCreateSatRoom.ts              # mutation orchestration & ack barrier
    useSatExamConfigForm.ts          # creation/settings shared form adapter
    satRoomErrorMapper.ts            # typed server error -> user-facing issue
  ui/
    create-exam/
      CreateSatExamFlow.tsx          # staged flow, no separate save step
      SatExamConfigFields.tsx        # shared editable fields
      SatExamConfigSummary.tsx
    create-room/
      SatCreateRoomSheet.tsx         # room-only fields/summary/submit
      SatCreateRoomIssueList.tsx     # validation issues + deep links
      SatRoomCreationStatus.tsx      # accessible pending + uncertainty
    settings/
      ExamSettingsPage.tsx           # expand, reusing SatExamConfigFields
      DeliverySettingsPanel.tsx      # keep existing routing/timing controls
```

Keep working components where possible; actual filenames are suggestions, not a demand to duplicate `AccessLinkEditorSheet` or break old imports.

### 7.3 Header and navigation

`ExamWorkspaceHeader.tsx`:
- Remove `onPublish`, `publishLabel`, `publishDisabledReason`, and publish-based primary-CTA branching from the **SAT-facing** header API after all consumers migrate.
- Make `onCreateSession` the one primary action. If other products depend on common header props, preserve compatibility via an adapter until migration completes.
- Preserve import/preview secondary controls, save indicator, co-edit presence, issue count, focus restoration and keyboard access.

`SatExamLibraryRoute.tsx`:
- Replace the current name-only form with `CreateSatExamFlow`.
- Group default config in one-time create step; save via the extended SAT creation API transaction.
- Change status copy to **Editing**, **Rooms available**, **Archived**, etc. if a lifecycle label is necessary. Internal `published` state can continue for filtering but should not force a staff publish task.
- Exam row click should follow a consistent route; do not divert based only on `currentPublishedVersionId` in a way that hides editing. Explicit **Open exam** vs room-count access can coexist without dual publish semantics.

`SatNewSessionFlow.tsx` and `SatSessionsRoute.tsx`:
- Stop filtering out `!exam.currentPublishedVersionId`.
- Integrate the same composite endpoint and draft-commit guard; choose a completed or in-progress exam with visible readiness feedback.
- Preserve selected exam and room form fields during refetch; do not reset on new versions arriving via polling.

### 7.4 Create-room mutation hook (illustrative TypeScript)

The following is **implementation guidance**, not drop-in code against the existing API because the composite endpoint is new:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useCreateSatRoom(examId: string) {
  const queryClient = useQueryClient();
  const collaboration = useSatAuthoringCollaboration();

  return useMutation({
    mutationFn: async (input: {
      operationKey: string;
      expectedExamRevision: number;
      expectedDraftVersionId: string | null;
      expectedDraftRevision: number | null;
      room: CreateAssessmentAccessLinkRequest;
    }) => {
      // 1. No local or co-editor changes may be sealed before acknowledgment.
      await ensureCommittedSatAuthoringChanges(collaboration, examId);

      // 2. Fetch the actual committed exam revision; don't trust cached UI.
      const committed = await getCommittedSatExamHead(examId);
      if (!matchesExpectedHead(input, committed)) {
        throw new SatRoomConflictError('EXAM_REVISION_CHANGED');
      }

      // 3. One POST; the server validates, snapshots/reuses, and creates room.
      return satCreateRoomApi.create(examId, input);
    },
    retry: false, // Never blind-retry an uncertain non-idempotent-looking request.
    onSuccess: (receipt) => {
      // Update canonical local cache with the returned receipt first.
      queryClient.setQueryData(satRoomKeys.detail(receipt.room.id), receipt.room);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: satRoomKeys.list(examId) }),
        queryClient.invalidateQueries({ queryKey: ['assessment', examId] }),
        queryClient.invalidateQueries({ queryKey: ['sat', 'sessions'] }),
      ]);
    },
  });
}
```

`ensureCommittedSatAuthoringChanges`, `getCommittedSatExamHead`, `matchesExpectedHead`, and cache keys shown above are proposed adapters, **not existing functions**. Implement them against `useSatAuthoringCollaboration`, `useAuthoringShellLifecycle`, and existing query keys/effect helpers. Critically, create operation key once per intended submission and hold it in a ref across HTTP uncertainty; reuse the exact original payload/key for operation status and retry.

**Avoid optimistic success** for room creation. Only navigate when a server receipt resolves to one specific schedule/link. Prefer using the returned `scheduleId` to navigate `/sat/sessions/{scheduleId}` (consistent with current `SatSessionsRoute`).

### 7.5 Create-room form logic

- Use a pure Zod schema for room fields, with refinement of scheduled opening/closing time using existing SAT schedule rules; additionally validate cross-field constraints on server.
- `React Hook Form` `mode: 'onBlur'` or sensible change validation; no distracting immediate errors on untouched inputs.
- Keep `AccessLinkEditorSheet` form behavior, including audience/selected roster parser and conditional Classroom routing.
- Replace internal `onCreate` callback with composite room mutation; remove `publishScope`, `targetVersionNumber`, and `contentBeforeFields` publication selectors from create mode as soon as callers migrate. Keep these props for existing room detail/edit views if still needed.
- Preserve draft fields on errors and after Fix navigation. Do not call `reset` on background polling or a new `publishedVersionId`.
- Submit disabled only for actual blockers (invalid form, unauthorized, offline, saving/unknown outcome). Do not leave it permanently disabled because no published version exists.
- Update focus to first invalid field; alert summary is `role="alert"`; progress is `role="status"` / `aria-live="polite"`; error links have clear labels.
- While submit pending, `aria-busy` on relevant form, primary button disabled, modal close guarded if action outcome is unknown.

### 7.6 Typed server-state machine

Avoid several contradictory booleans (`didPublish`, `isPublishing`, `needsPublish`, `targetRef`, `source`). Use a discriminated union for the composite flow:

```ts
type CreateRoomState =
  | { status: 'editing' }
  | { status: 'syncing' }
  | { status: 'creating'; operationKey: string }
  | { status: 'created'; operationKey: string; scheduleId: string }
  | { status: 'invalid'; issues: SatRoomIssue[] }
  | { status: 'conflict'; latestRevision: number }
  | { status: 'unknown'; operationKey: string }
  | { status: 'failed'; message: string };
```

Transitions must be explicit, testable and monotonic with respect to a given operation receipt. Do not show **Created** based on a toast or cache refresh before the POST result/operation-status receipt is confirmed.

### 7.7 Routing and backward compatibility

- Make `/sat/exams/:id/settings` the single owner of exam configuration.
- Keep `/sat/exams/:id/access` as Rooms and preserve existing direct links.
- Redirect legacy SAT `/release` or manual-publish deep links to Settings or Rooms with a small explanation, but preserve old route compatibility where links from other modules still require it.
- Do not delete backend publish endpoints until consumers and tests are migrated.
- Feature flag SAT UI and composite endpoint: `satAutoVersionOnRoomCreate`; rollout by staff cohort or environment, not by browser-local-only flags.

---

## 8. Error and edge-case matrix

| Condition | Expected behavior |
|---|---|
| Empty exam or partial modules | Block room, deep-link to missing requirements. No version/room committed. |
| Selected Math-only room but RW incomplete | Validate scope `math`; do not block on irrelevant RW content, provided the backend explicitly supports this scope. |
| Full SAT room with missing RW content | Block on RW issues; don't silently downgrade to Math only. |
| Offline | Keep form and input; disable final create while offline; allow retry after reconnect. |
| Local Yjs content unsaved | Flush/wait; block if acknowledgment fails or times out. |
| Another author changes exam during prepare | Revision-fenced 409; preserve form; require fresh confirmation. |
| Two staff click Create room concurrently | Exactly one release per unique fingerprint/scope; each distinct operation key may create its own room. |
| Browser loses response after commit | Read operation by key and navigate to the original room. |
| Duplicate submit from Enter or double click | One in-flight operation; server key prevents duplicate schedules. |
| Release reused, different room settings | New room on same immutable release; no release bump. |
| Score conversion policy changes globally | Follow existing global re-score policy; do not silently alter it as part of release versioning. |
| Score report visibility toggle is changed | Preserve existing live behavior until migration explicitly snapshots that setting. Explain historical impact. |
| User changes Settings after room starts | Old room unaffected for versioned fields; handle explicitly live fields per documented policy. |
| User has only proctor role | Do not imply exam authoring permission; show only create/manage capabilities actually granted by backend. |
| Legacy published exam with no editable draft | Can create new room using immutable current version; first user edit opens a new draft explicitly. |
| Stale deep link from older Publish page | Redirect gracefully without requiring a manual publish task. |

---

## 9. Testing and quality gates

### 9.1 Unit tests (Vitest)

- Shared config Zod schema, default hydration, numeric field boundaries, partial section selection, scoring policy separation.
- Create-exam form: all configuration preserved between stages; only one submit; correct validation/focus.
- Create-room state machine: invalid/ready/saving/creating/unknown/success/conflict.
- `operationKey` stable across retries, changed only for new confirmed attempt.
- Error mapping: 422 issues to deep links; 409 refresh path; 403 authorization.
- No accidental reset of form after TanStack Query refetch.
- Header: only Create room as SAT primary CTA in all lifecycle states.

### 9.2 Go/MySQL integration tests

Extend existing `sat_publish_mysql_test.go`, `sat_classroom_mysql_test.go`, `sat_classroom_plan_fence_mysql_test.go`, and related suites:
- Initial create with full typed config saves atomically; invalid config rolls back exam.
- First room seals/pins current draft correctly; next room with no changes reuses release.
- Changed question/settings produces new version; old rooms remain pinned.
- Partial scope validation and section inclusion; no accidentally broadened permissions.
- Two distinct simultaneous create operations use same release and create two distinct rooms.
- Duplicate same-key concurrent calls yield exactly one room.
- Version publish validation failure leaves no link, schedule, or orphan release.
- Stale revision prevents publication even if media preflight passed.
- A lost-response replay returns identical persisted receipt.
- Permissions scoped by exam, user and organization.
- Realtime draft-replaced and idempotency events match existing invariants.
- Existing legacy SAT rooms, results and exports remain unchanged.

### 9.3 Browser E2E (Playwright)

1. Create exam; customize timings and thresholds; submit; reopen Settings; verify exact persisted values.
2. Author valid exam; Create room; only one submission; land on room details; share link works.
3. Create second room unchanged; version unchanged and second room distinct.
4. Edit question; create third room; new version; old room still displays original content.
5. Global Rooms entrypoint can create from an exam with no earlier publication.
6. Simulate slow saves/network disconnect and co-edit tabs: submission never captures unacknowledged work.
7. Simulate HTTP response loss after commit; operation receipt finds room without duplication.
8. Fix a readiness error and return to preserved room form.
9. Check keyboard-only navigation, screen-reader labels/live regions, small viewport, touch, reduced motion.
10. Verify IELTS/ACT exam authoring/publish flows are unchanged.

**CI acceptance:** run `bun run typecheck`, `bun run lint`, relevant `vitest` suites, relevant `playwright` SAT authoring/room/staff tests, Go unit/integration tests, plus existing SAT concurrency/failure-rehearsal tests. Adjust actual commands for the CI environment and DB fixtures.

---

## 10. Phased implementation (safe merge order)

### Phase A — Contracts and ownership (backend + frontend)

1. Finalize exam-level vs room-level vs global-setting ownership. Document score report historical semantics and scope rules.
2. Introduce typed `SatExamConfig`, SAT defaults endpoint and complete create exam request validation.
3. Build reusable config fields and wire Create exam + Settings to the same schema.
4. Add unit tests before removing old surfaces.

**Done when:** new SAT exams are created fully configured in a single transaction, settings remain editable, and old exams still work.

### Phase B — Atomic auto-release-and-create operation

1. Extract internal publish and access-link transaction helpers.
2. Add durable composite operation receipt, unique constraints, revision fences and fingerprint-based reuse.
3. Implement `POST /sat/exams/{id}/rooms` and authorized GET operation receipt/status.
4. Ensure preflight + in-transaction validation, rollback and concurrency tests.

**Done when:** one POST safely creates a validated room and release, with exactly-once replay semantics and no orphan partial success.

### Phase C — One-action frontend

1. Refactor `SatCreateRoomFlow.tsx` into a simple room form using the composite endpoint.
2. Remove version-source/scope/publish choices and show only server readiness errors when needed.
3. Convert `ExamWorkspaceHeader` to one **Create room** CTA.
4. Update both `/sat/exams/:id/access` and global `/sat/sessions` entrypoints.
5. Restore room draft after fixing errors; use operation receipt for unknown results.

**Done when:** staff can create a room from a never-published, complete SAT exam without touching Publish.

### Phase D — Cleanup, migration, rollout

1. Hide SAT Publish sheet/page, migrate deep links and lifecycle labels.
2. Add telemetry: `sat_room_create_started`, `sat_room_create_validation_failed`, `sat_release_reused`, `sat_release_created`, `sat_room_create_succeeded`, `sat_room_create_outcome_unknown`, 409 rates and operation recovery rates. Exclude student PII from events.
3. Enable feature flag for internal staff first, test on representative legacy exams.
4. Monitor orphan-room/release count, duplicate prevention, latency p95, publish validation rejection, and live room stability.
5. Remove dead SAT manual-publish frontend code only after all dependent paths are migrated; keep backend compatibility as needed.

**Done when:** production can run the new workflow without manual publishing, regressions, duplicate rooms, stale content or breaking existing attempts.

---

## 11. Acceptance criteria / definition of done

- [ ] Staff never need to click Publish, Publish changes, or choose an exam version when creating a SAT room.
- [ ] Only one **Create room** primary CTA in SAT exam header.
- [ ] Room creation always uses the exact latest **committed and acknowledged** exam revision selected at final submit.
- [ ] Exam validation and media validation remain server-authoritative.
- [ ] No room can exist with unvalidated or unintended content.
- [ ] Same content + same effective release scope = same immutable version reused (unless product policy explicitly requires unique releases per room).
- [ ] Changed content/config = new release; old rooms remain pinned and unchanged.
- [ ] Room + release are committed atomically, with durable same-key response replay.
- [ ] Create exam includes complete supported exam-level configuration with server defaults and one atomic submit.
- [ ] Settings reuses the same configuration model and allows later changes.
- [ ] Room-only settings stay in Create room; global SAT conversion stays in global settings.
- [ ] Unknown network outcomes are recoverable without creating duplicates.
- [ ] Concurrent editing is protected by Yjs save barrier and server revision fencing.
- [ ] SAT publish/deep-link legacy surfaces migrate gracefully, IELTS/ACT unaffected.
- [ ] Existing rooms, scores, exports, QR/access links and attempts remain valid.
- [ ] Accessibility, responsive behavior, Vitest, Playwright and Go integration gates pass.

---

## 12. Implementation instruction for the engineering team / coding agent

> Implement the SAT Internal workflow redesign described in this specification against the current `main` branch. First inventory all SAT publish/create-room entrypoints, settings owners, current DB schema/migrations, and existing `Publish`/`AccessLinks.Create` transaction boundaries. Preserve IELTS/ACT behavior. Replace the SAT manual Publish and Publish & Create Room flows with a single Create Room UI that posts to an atomic, idempotent SAT backend coordinator. Validate and pin the most recently committed exam version, reuse equivalent releases, retain immutable historical room versions, and provide precise actionable errors. Extend SAT exam creation so all supported exam-level settings are configured once using server-provided defaults and saved in one transaction; make the same fields editable later in Settings. Reuse existing React/Tailwind/Radix/TanStack/Yjs architecture, support accessibility, navigation, multi-author concurrency, exact operation recovery, and comprehensive tests. Do not add a second UI kit or migrate to a new frontend framework. Do not silently change global score conversion or current score-report historical semantics. Make changes in small verified phases; include migration notes, tests, and backward compatibility in the PR.

### Engineering non-goals

- Do not remove backend versioning: hide it from ordinary staff while retaining server guarantees.
- Do not publish on every question keystroke, every autosave, exam creation, or page load.
- Do not introduce a second scoring system or duplicate global conversion settings in each exam.
- Do not use a frontend-only publish-then-create sequence as the final solution.
- Do not make student attempts read live editing drafts.
- Do not delete legacy release records or mutate room version pins.
- Do not replace the existing React component system just to deliver a cleaner UX.

---

## Source files consulted

- [SAT create-room flow](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/publish/SatCreateRoomFlow.tsx)
- [Publish and collaboration save barrier](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/publish/useSatPublish.ts)
- [SAT exam library creation](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/products/sat/routes/SatExamLibraryRoute.tsx)
- [Global room creation](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/products/sat/routes/SatNewSessionFlow.tsx)
- [Exam workspace header](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/shell/ExamWorkspaceHeader.tsx)
- [Room setup form](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/access-links/AccessLinkEditorSheet.tsx)
- [Exam Settings](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/features/exam-authoring/ui/settings/ExamSettingsPage.tsx)
- [Initial SAT blueprint](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/internal/exams/sat_initialization.go)
- [Exam publishing and revision fencing](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/internal/exams/service.go)
- [Access-link creation](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/internal/accesslinks/service.go)
- [API routing](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/cmd/api/main.go)
