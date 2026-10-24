# Implementation plan: SAT registration, separate section forms and Eva SIM

Status: planning only; native/embed requirements confirmed on 2026-10-21, UX/UI specified on 2026-10-22, and separate Verbal/Math forms with individual timers confirmed on 2026-10-24. No application code, migrations, or deployment have been changed by this planning task.

Companion specification: [UX/UI layouts, student/staff states, copy and acceptance criteria](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/docs/plans/SAT-configurable-forms-and-eva-sim-ux.md). Implement it with this plan; both documents describe proposed work.

**2026-10-24 workspace baseline:** Initial version 1 code is present in [definition.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/assessmentforms/definition/definition.go), [forms.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/assessment-forms/contracts/forms.ts), [FormsSettingsPanel.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/settings/FormsSettingsPanel.tsx) and [0101_assessment_forms.sql](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/migrations/0101_assessment_forms.sql). These provide the original flat scoped-registration vocabulary; source presence does not prove deployment or passing tests. This amendment extends that work with **schema version 2**, reusing its services/renderer/table while preserving version 1 snapshots/responses. Earlier foundation requirements are the baseline to verify, not instructions to rebuild working modules. This task changes only the two plan documents.

## 0. Context and current behavior

**Goal:** Let staff manage common registration, separate Verbal and Math entry forms, and optional native/embedded Eva SIM inside each SAT exam's Settings; preserve each room's configuration and manage form responses separately from exam results.

**Current → desired:** The workspace's initial flat version 1 registration/Eva implementation gains version 2 forms at their proper boundaries: common details at check-in, Verbal questions before Verbal, Math questions after the scheduled break before Math, then Eva after confirmed Math completion. Each student's section timer starts only after that section's form is accepted and normal start authorization succeeds. Staff End Exam stops further section starts/native Eva writes and closes embedded access here; automatic completion does not close Eva. External-provider submissions remain outside our control.

### Confirmed product contract

New field placement and section timing below apply to version 2; version 1 keeps its captured semantics as stated in the compatibility row.

| Area | Confirmed behavior |
| --- | --- |
| Configuration owner | Exam, not individual room. Rooms and links retain their captured exam version. |
| Form authoring | Staff can add, edit, delete, reorder and set required within Common registration, Verbal (Reading & Writing), Math and Eva. Initial native types: text, number, single choice. Form ownership defines when questions appear; no duplicate per-field timing rule. |
| Separate section forms | Verbal appears before its first delivered module. Math appears after the break ends and before its first delivered module. Math-only starts with its Math form without a fictitious break; Verbal-only never sees Math/Eva. Each nonempty section form is submitted once, not again for Module 2. |
| Individual timers | Newly created rooms using section forms use the existing `sat_personal_v1` model. No section working clock starts while its form is incomplete. Existing shared-clock rooms keep their captured behavior; do not convert them in place. |
| Version 1 compatibility | Existing scoped registration, including Expected Class at check-in where configured, remains intact for version 1 rooms. Separate section entry belongs to version 2; upgrade only an editable draft explicitly, never a published snapshot or old responses. |
| System identity | Keep existing identity and access-mode rules. Custom fields cannot replace Code/Name/Email or alter authentication. An open link still need not collect a code. |
| Admission Year | Expected university admission year, four-digit Gregorian year, for example 2027. Collect once in common check-in. |
| Seat number | Collect once in common check-in; student enters the externally assigned seat. Preserve leading zeros and letters; duplicates do not prevent admission. |
| Expected Class | One selection: Unenroll, Rank 4, Rank 3, Rank 2, Rank 1. Collect in the Math entry form, after the break for a full SAT sitting. Do not ask it at initial full-SAT check-in. |
| Initial required fields | The three new fields default to required where applicable; staff may change this before the next release. |
| Empty section form | No invented Verbal questions. Staff may configure them; an empty section form is skipped without an empty mandatory page. The default Math form contains Expected Class. |
| Eva SIM | Enabled/disabled per exam version, with one active mode: native unscored questionnaire or embedded external URL. |
| Native completion/editing | First valid submission is required before returning to SAT Complete while collection is open. Students can reopen/edit/resubmit until staff End Exam. Show the latest accepted revision. |
| Embedded completion | Automatically show the external form inside our completion page, with Back to SAT Complete always available; no verified-submission requirement or external answer collection. |
| Embedded fallback | Always provide a user-initiated Open form in new tab action while access is open, including when the iframe appears blank or is blocked. |
| Closure | Staff End Exam closes native first submissions/edits and closes embedded access through our app. Automatic completion leaves either mode open. |
| Embedded closure limit | Hide/unmount the iframe and remove external-open actions when closure is observed. Previously disclosed URLs, external tabs and provider-side in-flight submissions cannot be revoked by our End Exam command. |
| Closed without response | Native: closed / not submitted, with return to Complete. Embed: access closed / submission not tracked, with return to Complete. SAT remains submitted in both modes. |
| Reporting | Dedicated native form-response workspace. Embedded Eva shows external / not tracked metadata, never a fabricated submitted/not submitted state or answer row. Scores and score exports remain separate. |
| Versions | Native definitions and the selected Eva mode/URL are captured with the exam version. Existing rooms retain them; externally hosted content itself is not version-controlled by this system. |

### Evidence map

`Verified` means source was inspected in this workspace; it does not establish deployed production behavior. Every API/table/module introduced below is **proposed**, unless explicitly marked existing.

| Behavior | Verified source and symbol | Consequence |
| --- | --- | --- |
| Direct and access-link entry use different UIs | [StudentEntryRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/routes/StudentEntryRoute.tsx), [StudentAccessLinkEntryRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/routes/StudentAccessLinkEntryRoute.tsx), `AccessForm`, `submitEntry` | Both must render and transmit the same configurable field contract. |
| SAT link fields currently are code/name/email | Same `AccessForm`; [schemas.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/app/validation/schemas.ts), `studentRegistration`, is still an IELTS-shaped schema | Do not treat that generic schema as the SAT source of truth. |
| Public metadata is projected separately | [handlers_v2.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_v2.go), `studentEntryScheduleHandler`; [accesslinks/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/accesslinks/service.go), `PublicAccessLink`, `PublicLink` | Expose only the candidate-safe registration form, not the entire config snapshot. |
| Direct-entry mapping drops unknown metadata | [studentEntryGateway.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/infrastructure/studentEntryGateway.ts), `getStudentEntrySchedule`; [backendBridge.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/services/backendBridge.ts), `mapBackendSchedule` | Carry registration metadata in a dedicated entry-context DTO instead of assuming the shared schedule mapper preserves it. |
| Entry has recovery and preprovisioned fast paths | `studentEntryHandler`; [student_entry_recovery.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/student_entry_recovery.go), `lookupOwnEntry`, `writeStudentEntry`; [entry_gate.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/entry_gate.go), `fastPathAttempt` | Checking questions only in the entry UI or attempt-mint branch is insufficient. |
| Credentials share one transactional boundary | [handlers_device_transfer.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_device_transfer.go), `admitStudentSession`, `attemptCredentialIssuer`; [attempts/ownership.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/ownership.go), `Admit`, `admitInTx`; [student_admission_gate.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/student_admission_gate.go), `authorizeStudentCredentialTx` | Persist/check the registration response before issuing a first credential, within the existing admission transaction. |
| Terminal attempts can receive owner credentials | `admitInTx` returns `AdmissionClosed` and can issue a credential; `authorizeStudentCredentialTx` permits already admitted ownership independently of the new-entry window | Eva can reuse attempt ownership without reopening exam answer writes. Test refresh after completion. |
| Published config is already versioned | [exams/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/exams/service.go), `SaveDraft`, publish transaction, `ReopenDraft`; [authoring/shell_open.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authoring/shell_open.go), published-to-draft clone | Store definitions inside `exam_versions.config_snapshot`; preserve them through existing clone/seal flows. |
| Import checkpoints also copy config | [authoring/workbook_import.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authoring/workbook_import.go), `cloneSATDraftVersionTx` | Verify checkpoint/undo preserves the forms subtree; do not rebuild only known legacy config keys. |
| Legacy authenticated context walks config snapshots | [student_context.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/student_context.go), `loadStudentScheduleVersion`, `redactStudentSnapshot` | Explicitly omit the raw `forms` subtree from generic student config projections; supply only purpose-specific form DTOs. |
| Room creation seals/reuses a version atomically | [satrooms/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/satrooms/service.go), `CreateRoom` release rules | The agreed Draft → Publish semantics map to the existing Create room flow; do not add a new mandatory Publish screen. |
| Existing schedule rebind freezes after attempts exist | [schedules/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/schedules/service.go), `Update`, `CreateRegistration`, `CreateScheduleAttempt` | Resolve answers from the attempt's published version, not the exam's latest draft. |
| Scope has a common server owner | [exams/section_scope.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/exams/section_scope.go), `AttemptSectionScope`, `IntersectSectionScopes` | Reuse the actual release/link intersection for Math-only fields and Eva eligibility. |
| Manual End Exam has terminal early returns | [proctor/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/proctor/service.go), `CompleteExam`; [runtime/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/runtime/service.go), `Complete` | End Exam must still close Eva when the runtime is already completed. |
| Automatic completion also uses shared helpers | [proctor/reconcile.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/proctor/reconcile.go), `completeRuntimeEffect`, personal admission-window reconciliation, `CompleteInTx` call | Do not put Eva closure in generic `CompleteInTx` or infer it from `status='completed'`. |
| Completed-room controls hide End Exam today | [SatSessionControls.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/ui/SatSessionControls.tsx); [SatSessionRoomRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatSessionRoomRoute.tsx) | Keep End Exam available on automatically completed rooms while Eva collection remains open. |
| Completed delivery stops its normal polling | [useSatExamController.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts), complete-phase checks; [SatStudentSessionRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/routes/SatStudentSessionRoute.tsx), `stage.kind === 'complete'` | Eva needs an independent small query while its screen is mounted. |
| Complete has two rendering branches | [SatCompleteScreen.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/ui/transitions/SatCompleteScreen.tsx), `SatCompletionOnly`; [SatScoreReport.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/ui/transitions/SatScoreReport.tsx), `SatScoreReport` | Add return/edit actions to both without altering score-release policy. |
| Hash-bound receipts already exist | [lifecycle/receipts.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/lifecycle/receipts.go), `Load`, `Store`; [0077_sat_lifecycle_receipts.sql](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/migrations/0077_sat_lifecycle_receipts.sql) | Reuse for Eva submissions; no new receipt subsystem. |
| Existing schema can own identity/version linkage | [0005_scheduling_and_access.sql](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/migrations/0005_scheduling_and_access.sql), `schedule_registrations`; [0006_delivery.sql](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/migrations/0006_delivery.sql), `student_attempts` | Responses reference the attempt. Do not copy identities/version definitions into every answer. |
| Resource permissions and route allowlists are explicit | [authoring_authorization.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/authoring_authorization.go); [authz/table_staff.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authz/table_staff.go); [authz/table_fullpath.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authz/table_fullpath.go) | New routes need both route policy and resource ownership checks. |
| UI/toolchain and DB test infrastructure exist | [package.json](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/package.json), [ci.yml](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/.github/workflows/ci.yml), [runtime_start_concurrency_mysql_test.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/runtime_start_concurrency_mysql_test.go) | Reuse React Query, Zod, existing UI primitives, Bun, Go, and real-MySQL tests. |
| Application security headers already deny framing our pages | [httpx.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/platform/httpx/httpx.go), `SecurityHeaders` sets `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer` | Keep those protections; allowing an external child iframe does not require allowing our app to be embedded elsewhere. |
| An existing iframe is a trusted exam tool | [DesmosCalculator.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/ui/tools/DesmosCalculator.tsx) | Its readiness/trust/prewarming assumptions must not be copied to an arbitrary Eva URL. Student Eva embeds mount only after exam completion; staff preview is a separate authorized action. |
| Personal and shared clocks are distinct | [runtime/timingmodel.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/runtime/timingmodel.go), `IsSatPersonal`; [schedules/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/schedules/service.go), `PersistSatTimingChoice` | New SAT schedules default to personal timing unless `SAT_PERSONAL_TIMING` is disabled; verify the effective persisted choice and reject section-form room creation if it is not personal. A global default is not proof of a room's model. |
| Break expiry starts Math on the server today | [delivery/reconcile.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/reconcile.go), personal break completion and direct activation UPDATE; [start_submit.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go), `openFollowUpModuleTx` | Complete the break normally but keep a gated first module `not_started`; suppress cross-section automatic activation, including zero-break transitions. A UI overlay alone is insufficient. |
| Explicit starts share an activation owner, but reconciliation also writes directly | [start_submit.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go), `activatePersonalModuleWithPolicyTx`; [sat_code_entry.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/sat_code_entry.go), code redemption | Enforce accepted section answers in the activation owner; every direct auto-start writer uses the same section-gate decision. Code start, old entry endpoints and proctor/recovery paths cannot bypass it. |
| Preparation has a separate expiry | [module_boundary.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/module_boundary.go), `ensureSatModuleBoundaryWithPolicyTx`, `beginSatModuleBoundaryTx` | Filling a section form must not consume working time or module-entry recovery allowance; pending gates must not arm/block on the old `available_at` deadline. |
| Student stage and break copy assume automatic start | [satStudentSurface.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/application/satStudentSurface.ts), stage union; [SatScheduledBreakScreen.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/ui/break/SatScheduledBreakScreen.tsx) | Add a section-entry-form surface and mode-aware break copy; do not hide the form beneath existing automatic entry effects. |

**Scope:** SAT configuration, both admission paths, separate section-entry forms and individual-clock enforcement, native and embedded Eva workflows, explicit new-tab fallback, manual room closure, dedicated response viewing, compatibility, and relevant tests. **Non-goals:** scored surveys, automatic external redirects, external answer import or submission verification, provider webhooks, closing the provider's form, arbitrary embed HTML/scripts, arbitrary conditional expressions, seat allocation, seat uniqueness, a standalone form product, file upload, cross-exam template marketplace, response editing by staff, score-export changes, or new offline exam guarantees.

**Unknown / to verify operationally:** actual deployed DB engine/version, live binary mix, existing unpublished work and whether version 1 has been deployed/used, production volume/SLOs, actual native Eva questions, external destination URL and its embedding/login behavior, and any deployment-level CSP. Native questions or an external URL are configured by staff before enabling that version; no provider compatibility is assumed without a real-browser check.

## 1. Requirements

### Functional (all P0)

| ID | Observable behavior | Acceptance criterion |
| --- | --- | --- |
| FR-1 | Authorized authors manage common registration, separate Verbal/Math forms and one Eva mode on an exam draft. | Edit fields/choices and required rules in the owning form, preview timing/scope, or provide an Eva embed URL; save with revision checks. Immutable releases cannot be edited. |
| FR-2 | Students complete common registration before admission and their section form before its first working clock starts. | Admission Year/seat are collected once at check-in. Verbal form precedes Verbal; Math form follows the full break and precedes Math. Math-only has no break; Verbal-only has no Math form. Expected Class belongs to Math. Nonempty forms require explicit submission even if all questions are optional; empty forms skip. Each student's personal clock starts only after accepted answers and normal start authorization; refresh, workers, code start and old clients cannot bypass or reset it. |
| FR-3 | Eligible completed students automatically enter the selected Eva mode. | Native unsubmitted attempts open the questionnaire; embed attempts open the iframe view with Back to SAT Complete and new-tab fallback. R&W-only, disabled and legacy exams retain their flow. No embed mounts before confirmed completion. |
| FR-4 | Native Eva is required once and editable; embedded Eva has no completion tracking. | Native submit/edit uses validation and revision control. Embedded return is always allowed, no native answer PUT is accepted for embed mode, and no iframe load/return/click is recorded as a submission. |
| FR-5 | Staff End Exam closes app-controlled Eva access atomically with the staff command. | After commit no new native write succeeds and fresh embedded-state reads withhold launch URLs. Mounted embeds/actions are removed when closure is observed. Automatic expiry does not close access; no claim is made about stopping an external tab/provider submission. |
| FR-6 | Staff view native responses and accurate external-mode metadata separately from results. | Scoped list/detail filters include mode and status; native rows show pinned labels/answers and nonrespondents; embed rows show not tracked, never submitted/not submitted or fake answers. No score-view/export changes. |
| FR-7 | Existing rooms and identities retain captured configuration as forms evolve. | New rooms capture edited fields or mode/URL; old rooms keep their configuration. Missing config is legacy. External content changes are explicitly outside version guarantees. Old clients cannot bypass enabled registration fields or misread an unsupported Eva mode. |

### Non-functional

| ID | Constraint | Target | Design / verification consequence |
| --- | --- | --- | --- |
| NFR-1 | Durable native writes, correct section clocks and truthful closure | No working/preparation time charged during a section form; no implicit gated section start. One accepted Eva revision per expected revision; zero new native writes after closure commits; duplicate logical operations replay once. Embedded app state changes on revalidation, not by controlling the provider. | DB section/start/worker/clock/receipt tests; Eva transaction/fence/CAS tests; no-store state and closure/revalidation tests for embed. |
| NFR-2 | Authorization, privacy and external-frame isolation | No cross-owner/tenant disclosure/write; no credentials or student details added to external URLs; no answer text or full external URL in logs. | Trusted ownership, CSRF/live binding, scoped queries; server URL validation, sandboxed post-completion-only iframe, no-referrer and no-store; negative tests. |
| NFR-3 | Compatibility | Legacy rooms stay unchanged; opt-in activation only on a fleet that enforces the new contract. | Additive schema, absence-as-legacy semantics, preserved snapshot keys, explicit mixed-version deployment checks. |
| NFR-4 | Bounded work under bursts | No form validation/polling on exam-answer autosave; section state fetched at transition/waiting recovery, not per keystroke; response pages default 50/max 100; no per-student exclusive room lock. No invented production latency SLO. | Bounded schema/payloads, page identities before loading JSON, shared room lock for Eva writes, separate visibility-aware polling and burst measurement. |
| NFR-5 | Accessible and truthful UI | Common/section/native Eva controls labeled and keyboard usable; untimed section form has explicit status; iframe titled; Back/new-tab controls stay outside it; no “saved/submitted” claim for external content or before native acknowledgement. | Existing primitives, focus restoration, keyboard reordering, dirty/error/blocked-frame states, mobile and accessibility E2E. |

## 2. Core entities and invariants

### 2.1 Versioned definitions

Recommended storage: one `forms` property inside the existing `exam_versions.config_snapshot`. No separate form-version table is needed: `exam_versions.id` already identifies the immutable delivered definition.

Proposed **version 2** shape, with unrelated keys omitted. Preserve the existing version 1 contracts/parser and dispatch by schemaVersion; do not reinterpret version 1 scope fields as delayed section forms:

```ts
type Field =
  | { id: string; type: 'text'; label: string; help?: string; required: boolean;
      maxLength: number }
  | { id: string; type: 'number'; label: string; help?: string; required: boolean;
      integer: boolean; min?: number; max?: number }
  | { id: string; type: 'single_choice'; label: string; help?: string; required: boolean;
      options: { id: string; label: string }[] };

type NativeForm = { fields: Field[] };
// Missing enabled preserves earlier v2 snapshots; false keeps questions but skips collection.
type SectionEntryForm = NativeForm & { enabled?: boolean };
type SectionKey = 'reading-writing' | 'math';

type EvaConfig = { enabled: boolean } & (
  | { mode: 'native'; fields: Field[] }
  | { mode: 'embed'; url: string }
);

type ExamFormsV2 = {
  schemaVersion: 2;
  registration: NativeForm;
  sectionEntry: Record<SectionKey, SectionEntryForm>;
  evaSim: EvaConfig;
};
```

- IDs are stable within a form across label edits and reordering; option IDs are stored values, labels are display content. Deleting/replacing a field or option in a new draft must not recycle its ID for another meaning.
- Text/number/single-choice are the complete initial vocabulary. No HTML, scriptable rules, or arbitrary regex. Text can render an existing textarea when longer input is appropriate without inventing another answer type.
- Registration is common check-in. Section form ownership uses canonical `reading-writing` (UI: Verbal) and `math` keys, narrowed by the actual sitting's sections. Either Eva mode still applies only after Math. There is no per-field scope/timing language to keep consistent with the owning form.
- Confirmed customization follow-up: Verbal and Math each have an independent on/off switch. `enabled: false` skips collection and activation gating without deleting configured questions; absent `enabled` retains earlier v2 behavior (enabled when nonempty). Saving or re-enabling applies only to new captured rooms.
- Initial common fields: `sat_admission_year` as required integer 1000–9999 labeled Gregorian/ค.ศ.; `sat_seat_number` as required text up to 255 characters. Initial Math entry field: `sat_expected_class` as required single choice with stable values `unenroll`, `rank_4`, `rank_3`, `rank_2`, `rank_1`. Verbal starts empty until staff supplies questions. No preselected answer.
- A four-digit input is a format rule, not a fabricated admission-year range. Staff may set tighter numeric bounds in the editor. Do not silently convert Buddhist years or two-digit inputs.
- New SAT drafts initialize version 2 common registration and the Math default; Eva starts disabled/native with no questions. Unconfigured drafts offer Add standard SAT forms. Version 1 drafts offer Use separate section forms: preview conversion of `scope=all` to common, `reading-writing` to Verbal and `math` to Math, preserving field/option IDs, labels, help, requirements and bounds. Explicitly save the edited draft under revision checks, retaining Eva mode/URL behavior. Never convert published versions/admitted response rows or silently upgrade on GET.
- Native mode with no applicable questions, or enabled embed mode without a valid URL, cannot be sealed. Blank incomplete draft content may be saved with readiness errors; a nonblank unsafe URL is rejected on save. Reject unknown modes or mixed active native/embed payloads; never infer mode from a label or silently fall back between modes. Switching mode changes only a new draft/release, not an existing attempt.
- Proposed operational limits, tunable constants rather than production claims: 50 fields/form, 50 options/choice, 200 characters/label, existing 300-character help limit, 4,000 characters/text answer, 64 KiB total forms definition, 32 KiB answer envelope. Publish and submission enforce the same bounds. Check these against actual questionnaire content before activation.
- Missing `forms` means legacy/unconfigured. Present but malformed/unsupported config is an error, never equivalent to disabled.

The version pins native definitions and the chosen external URL, not the provider's content, authentication policy, uptime, or future response schema. A remote owner can change questions behind the same URL; the application must not promise otherwise.

### 2.1.1 Embedded URL boundary

- Accept a URL, not iframe HTML. Parse/validate on the server and expose the canonical value; the client validator is for feedback. Require absolute HTTPS, a public external hostname, no URL username/password, no control characters, and at most 2,048 characters. Reject our app origin, local/internal hostnames and literal private/loopback/link-local addresses. Do not resolve or fetch the URL server-side, proxy it, scrape it, or strip its required provider parameters.
- Store only the selected branch of `EvaConfig`. Do not append student name/email, candidate or attempt IDs, cookies, bearer tokens, or internal return capabilities to external URLs. Do not log the full URL/query. A local UI navigation preference is not submission evidence.
- One isolated iframe owns external rendering; the native response service never reads its DOM or accepts its messages as submission proof. No provider-specific adapters, webhooks or answer imports are included.

**Verified browser constraints:** Cross-origin content cannot be inspected as native form state without cooperation from the other origin. [MDN same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy). The destination can refuse framing using its own headers; our application cannot override them. [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [MDN X-Frame-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options). Iframe load events are not reliable proof of successful rendering or submission, so fallback must always be available while access is open. [MDN iframe event behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#error_and_load_event_behavior).

### 2.2 Current form response

Reuse `assessment_form_responses`, declared by local migration 0101; deployed presence is unknown. Extend its allowed keys in a **new next-numbered additive migration**. Do not modify an already applied 0101 migration:

| Column / key | Purpose |
| --- | --- |
| `attempt_id VARCHAR(36)` | FK to `student_attempts.id`, cascade with the attempt. |
| `form_key VARCHAR(32)` | Checked vocabulary: `registration`, `verbal_entry`, `math_entry`, `eva_sim`. Map canonical section keys explicitly to entry-form keys. |
| Primary key `(attempt_id, form_key)` | One current answer set per form per sitting. |
| `answers JSON` | Object keyed by field ID; string, finite number, or null/omitted optional value. |
| `revision BIGINT UNSIGNED` | Starts at 1; every accepted Eva edit increments exactly once. |
| `first_submitted_at`, `updated_at TIMESTAMP(6)` | First acceptance and latest accepted edit; authoritative DB UTC time. |

The definition/version, student, exam, and room are derived from the attempt and its existing immutable published-version reference. Do not maintain duplicate identity/version columns that can drift. Do not mirror the configurable seat answer into the existing `schedule_registrations.seat_label` column; the form response is its single source of truth.

Registration is sealed on successful admission. A section response is sealed on its first accepted submission, keyed by attempt plus section form; identical replay succeeds and a different payload cannot replace it. Revision 1 suffices for registration and section forms; only native Eva supports later revisions. A section response can be accepted while its module is still waiting to start; it is not a claim of exam work or completion. Native Eva presents the latest accepted revision. Embedded Eva creates no response row or submission receipt. Full answer history is outside scope; existing receipts prove committed writes without creating a staff history feature.

### 2.2.1 Section gate and clock ownership

Derive `not_applicable / waiting / required / submitted / closed` from the pinned definition, authorized sitting, predecessor/break state, room/proctor state and stored section response. No duplicate workflow table or per-student clock service is needed. A nonempty form gates the section's **first delivered module**, including an allowed selected-module sitting whose first delivered module is Module 2; it never recurs for adaptive Module 2. Unconfigured/version 1/empty section form preserves ordinary progression.

For new rooms with `sectionEntry`, require persisted `sat_personal_v1` at room creation and validate again at start; `SAT_PERSONAL_TIMING` being off causes a clear readiness/creation conflict, never a silent shared-clock fallback or conversion of an old room. The existing schedule creation transaction owns this check, including access-link backing schedules.

Keep a configured gated first module `not_started`, with `started_at`, `available_at` and `auto_start_at` null until explicit activation. This reuses the existing initial-M1 no-auto-start row pattern: derive Math eligibility from its predecessor/break records, not by arming a module deadline. Break duration/pause rules remain unchanged; break completion enables the form but activates no module. Even after form acceptance, keep that row waiting for ordinary StartModule/code start, so workers cannot start it during a delayed acknowledgement or repeatedly select it as a due auto-start. Activation sets its availability/start at DB time. Same-section adaptive handoff stays unchanged.

Entry recovery is distinct from working time: while the form is pending, do not arm its module-entry `entry_deadline_at`/`next_action_at` from break expiry or mark its boundary blocked for that reason. When the section becomes eligible and the form is accepted, anchor any preparation recovery allowance once at the later of those authoritative instants; do not slide it on polling/retry. First-entry code/admission windows, staff pause/termination and End Exam remain enforced; form completion never extends the room's absolute access window. Expose their actual closed/recovery states rather than inventing an unlimited start right.

### 2.3 Collection closure

Reuse nullable `eva_sim_closed_at TIMESTAMP(6)` and `eva_sim_closed_by VARCHAR(255)` declared by migration 0101; verify migration/schema guards instead of duplicating columns. Null means native collection / embedded app access has not been explicitly closed. It does **not** mean every student is eligible: provider, config, scope, cancellation/termination and successful completion are also checked.

The state is monotonic: open → explicitly closed. No reopen action is included. Definition ownership remains per exam version; closing a room's collection is a runtime action, not a per-room form override.

For embed mode closure governs our state endpoint, mounted frame and open actions. It is not a revocation of an already disclosed URL, an atomic shutdown of a remote document, or a command to stop the external provider collecting answers.

### Invariants

| ID | Must always hold |
| --- | --- |
| INV-1 | Definition/mode/URL lookup follows `attempt.published_version_id`; new draft edits cannot change a delivered native question or accepted answer's meaning, or replace a room's configured external URL. Remote content itself is not pinned. |
| INV-2 | A first usable admission credential for an enabled registration form and its valid registration response commit together. A preprovisioned registration/attempt alone is not admission. |
| INV-3 | Server-derived effective sections and stage select the owning form/fields. Unknown fields/options, cross-form or premature answers, nonfinite numbers and missing required values cannot be committed. |
| INV-4 | Eva writes never modify SAT question answers, scoring, exam completion, clocks, or exam response/lease revisions. |
| INV-5 | Native Eva first submissions/edits serialize against explicit closure: writes ordered after closure fail. Fresh embedded-state responses after closure do not expose a launch URL; already disclosed URLs remain outside revocation control. |
| INV-6 | One native Eva operation ID with the same payload replays its original receipt; reusing it with another payload fails. A stale expected response revision cannot overwrite a newer response. |
| INV-7 | Authorization precedes receipt replay and mutation; user-supplied IDs, email, code or tenant IDs cannot establish ownership. |
| INV-8 | Automatic room completion does not close collection; explicit staff End Exam closes it even if the runtime is already completed. |
| INV-9 | A missing native response is not a submission. Native nonrespondents remain visible after closure, with future section forms distinguished as waiting; external mode is always not tracked, with no invented answers or completion counts. Legacy/disabled/inapplicable forms are distinguished. |
| INV-10 | Absent form config preserves legacy behavior. No new version with enabled forms is activated while an old admission/end-exam binary can serve it. |
| INV-11 | An embed visit, iframe load, Back action, new-tab click or arbitrary postMessage never marks Eva submitted. Native answer PUTs cannot mutate an embed-mode attempt. |
| INV-12 | Student-delivery external content mounts only after authorized successful Math completion, in its isolated view; staff explicitly authorized preview is separate. Unsafe URL/code and app credentials never enter its configuration or navigation. |
| INV-13 | No first delivered section module can activate without its pinned nonempty section form's accepted response; Math form submission is refused before predecessor completion/break expiry. Initial-section forms may be completed before the proctor/code release, without starting work. |
| INV-14 | New section-form rooms use individual clocks. Form time consumes neither working time nor entry-recovery allowance; only an authorized explicit start activates a gated first module. Auto workers, zero-break progression and code/recovery paths cannot bypass this. |
| INV-15 | A section form is collected at most once per sitting/section; Module 2, refresh, another tab or reconnect cannot change the sealed response or reset an existing deadline. Empty/inapplicable forms create no phantom response. |
| INV-16 | Section-response commit and module start are separate recoverable checkpoints: accepted form does not imply started exam. End Exam/termination orders against both; later new submissions/starts fail without erasing accepted form data or claiming Math completion. |

## 3. API / interface changes

Paths below use the frontend's existing `/v1` convention; backend registration continues under its existing API mount. New paths are proposals, not existing endpoints.

### 3.1 Authoring

Extend existing [authoring/forms.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authoring/forms.go) and [forms handler](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_assessment_forms.go), retaining revision/authorization behavior. Existing GET/PUT below are the base; version 2 is the proposed extension. Backend validators and TS consumers support a discriminated version 1/version 2 union; unknown versions fail explicitly.

Proposed `GET /v1/assessment-authoring/exams/{examID}/forms` returns `{versionId, versionRevision, editable, forms, limits}` for the current draft, otherwise the pinned published version as read-only. This includes the chosen Eva mode and its native fields or external URL. No draft is created by GET.

Proposed `PUT` on the same path accepts `{expectedVersionId, expectedRevision, forms}`. Use existing exam-write authorization and CSRF; permit admin/builder only within existing exam/tenant scope. Lock the exam entity and then its current draft in the same order as room capture; assert the current draft pointer, version ID and revision, merge only the owned `forms` property, increment draft revision, and invalidate readiness. Never replace unrelated config keys. A stale draft is HTTP 409 with a stable reason, proposed `FORM_DRAFT_CHANGED`; the client reloads without overwriting local edits. If a save times out, GET and compare canonical forms/version before confirming it; a stale-revision retry alone does not prove failure or success.

The explicit v1-to-v2 conversion is one atomic whole-forms save under the existing revision check; do not partially move questions with independent editor saves. After its acknowledgement, independent Registration/Verbal/Math/Eva editor saves share one client mutation/revision owner. Build the full `forms` payload from the submitted editor snapshot plus all other editors' last confirmed values; never silently include their unsaved input. Serialize form saves, advance the acknowledged revision and update confirmed state without replacing dirty input elsewhere. An acknowledgement clears only the submitted snapshot, preserving subsequent edits. No extra authoring endpoints or server revision system are needed.

Reuse explicit draft-opening behavior when the author starts editing. Form saving must participate in the same draft revision/freeze rules used by Create room. Include form validation in authoring readiness and the authoritative seal/publish transaction; a UI-only readiness check is insufficient.

The server rejects unsafe/nonblank external URLs and invalid mode combinations with existing 422 validation errors keyed to `evaSim.mode` / `evaSim.url`. Do not fetch arbitrary URLs to declare them embeddable. The editor's real-browser preview and explicit fallback test validate usability without treating a frame load event as a compatibility certificate.

The existing whole-config `exams.SaveDraft` route must preserve the existing owned `forms` property when an older payload omits it. An intentional replacement/clear must use a validated explicit forms value. Test that timing updates, coedit saves, imports, draft reopen and room capture preserve the forms property. No additional collaborative form CRDT is required; optimistic revision conflicts are sufficient.

### 3.2 Public registration definition and entry

For version 2, extend the existing public metadata projection `registrationForm: {versionId, schemaVersion, fields}` with common fields only. Version 1 retains its existing scoped check-in projection and answers. Section questions are not folded into this public form; their authenticated state is returned at their own entry boundary. Exclude Eva/section content, scoring policies, student responses, identities and raw config snapshots. Expose a version ID even though it is not an authorization capability.

For direct entry, introduce a dedicated proposed `StudentEntryContext` containing `{schedule, registrationForm}` in the student feature; retain the established `mapBackendSchedule` for the schedule portion. Change the gateway and its consumers explicitly rather than attaching a form blob to every shared `ExamSchedule`. The access-link contract carries the same form projection. Generic authenticated student version/config responses explicitly omit the raw `forms` subtree; their answer-key redactor is not a form projection.

Extend existing `POST /v1/auth/student/entry` with:

```json
{
  "registrationForm": {
    "versionId": "the-version-the-student-saw",
    "answers": { "sat_admission_year": 2027, "sat_seat_number": "A-007" }
  }
}
```

For version 2 this common payload does **not** carry `sat_expected_class`; it belongs to Math entry. Version 1 retains its existing applicable registration fields. Omit the extension on unconfigured legacy forms. Resolve the pinned attempt/version server-side and reject mismatched advertised version with HTTP 409, proposed reason `FORM_VERSION_CHANGED`. Clients refetch and preserve only answers whose field IDs/types still match; require review before resubmitting.

**Enforcement owner:** extend the existing credential-issuer closure used by `admitStudentSession` to call a common registration-form function inside `attempts.Admit`'s transaction, after ownership/admission eligibility is established and before `auth.IssueAttemptTokenTx`. Pass the optional initial answers through `studentEntryIdentity`/`writeStudentEntry` into this closure. Other callers supply no new answers and must find a valid stored response, or a legacy form with no applicable questions.

The new registration check reads the attempt's already pinned immutable definition and writes only its own form row. Do not introduce a new schedule lock after the admission owner's attempt lock; reuse the existing admission eligibility checks and lock order. Do not invoke a separate nested transaction from the credential-issuer callback.

This leaves registration/attempt provisioning as existing recoverable preparatory steps. A crash after their creation but before admission leaves no usable credential; retry completes admission on the same attempt. It avoids a broad refactor of the existing registration/mint transactions while making the required credential-plus-response boundary atomic.

An identical existing registration response is a replay, not a new revision. An existing admitted attempt resumes against its stored response without trusting/replacing answers supplied by a stale entry screen. Preprovisioned attempts with no response still require the new answers at first admission. Legacy bootstrap/register routes may create preparatory rows but cannot obtain a first credential for an enabled form without satisfying the shared gate.

### 3.3 Section-entry state, submission and start

Proposed authenticated APIs, separate from Eva:

- `GET /v1/assessment-forms/schedules/{scheduleID}/attempts/{attemptID}/section-entry/{sectionKey}`
- `PUT` on the same path, accepting `{versionId, operationId, answers}`. Canonical keys are `reading-writing` and `math`; arbitrary keys fail validation.

GET returns `{versionId, sectionKey, formKey, state, moduleId, fields, answers, submittedAt, canSubmit, canStart, serverNow}` with state `not_applicable | waiting | required | submitted | closed`. Only return the currently authorized eligible form; do not expose future Math questions before the break ends. A first-section form may be filled in the waiting room before staff/code start; answering it starts no clock. Resolve the first delivered module from selected scope/server progression, never from an arbitrary client module ID. No exam questions or Eva URL appear in this DTO.

Extend the existing bootstrap and compact entry projections with a small candidate-safe `sectionEntryGate` verdict for the pending first module; obtain question/answer content from the GET above. This lets surface derivation and controller auto-entry agree on the same authoritative gate without copying timing rules. Version 1/unconfigured snapshots retain legacy entry; unknown/loading state for a configured gate holds entry and offers retry. An already active module resumes rather than being covered by a stale required-form response. Cancel/ignore stale reads after attempt/version/section changes.

The **delivery service owns timing/eligibility**, reusing its existing trusted attempt/writer/control binding and lock order. It calls the forms package's bounded answer validation and transaction-level sealed-response helper; the forms package does not import delivery/runtime. Reject cross-owner/version, premature Math, terminal room/attempt and changed existing payloads with existing error conventions and proposed reasons `SECTION_FORM_NOT_AVAILABLE`, `SECTION_FORM_CLOSED`, `SECTION_FORM_ALREADY_SUBMITTED`, `FORM_VERSION_CHANGED`. GET waiting is not an empty/disabled form. For all-optional nonempty forms, accept an explicit valid empty answer object as the response; no implicit submission.

PUT locks/authorizes using the established schedule/attempt/runtime order, checks a committed hash-bound operation receipt, then checks current eligibility for a **new** mutation and persists response plus receipt in one transaction. Do not put a new-operation-only live/closed gate ahead of an authorized committed replay. Section answers do not mutate SAT answer/lease/control revisions. Identical committed replays return their original receipt with current closed/start availability; new operations after closure fail. Different payloads cannot overwrite revision 1. `Submitted` does not promise the module is active.

After acknowledged PUT (or GET reconciliation proves acceptance), the client invokes the existing StartModule command, or proceeds through the existing start-code/proctor release if still needed. If starting fails, keep “Form submitted — section not started” with the actual waiting/retry/closed reason; do not ask the questions again. The explicit activation transaction refuses a missing required response with proposed HTTP 409 reason SECTION_FORM_REQUIRED before any working/boundary clock write, then checks the accepted response and eligibility again, then uses the existing DB-time activation owner and returned control epoch. A lost start acknowledgement is recovered through the existing entry-state/bootstrap path; an already active module resumes its original deadline.

**All writers must honor one delivery-owned section-gate decision.** Update `activatePersonalModuleWithPolicyTx`, `openFollowUpModuleTx`, the direct auto-start UPDATE/worker scan in `ReconcileAttemptTimeout`, code redemption, deprecated EnterModule/offer paths and proctor/recovery activation/rearm callers. A gated first module is never auto-started, even after its form commits; ungated modules retain existing behavior. Guard before activation and before creating an already-active follow-up row. Gated first-module `available_at`/`auto_start_at` stay null until explicit activation, so due-auto-start scans skip it; break eligibility remains independently checked. Within-section Module 2 routing stays unchanged.

Update `module_boundary.go`'s preparation anchoring and timeout reconciliation so the form-pending state does not become an entry failure after the former break-based allowance. A form submit, start and End Exam use the established common lock order; no new schedule lock is taken after an attempt lock. Do not extend room/code admission cutoffs or use client timestamps as clock authority. The planned tests must inventory every activation writer against the current tree at implementation time.

### 3.4 Student Eva state and native submission

Proposed APIs:

- `GET /v1/assessment-forms/schedules/{scheduleID}/attempts/{attemptID}/eva-sim`
- `PUT /v1/assessment-forms/schedules/{scheduleID}/attempts/{attemptID}/eva-sim`

Reuse the existing attempt bearer and credential refresh gateway for either mode's state. Verify signature/expiry and live server binding on reads; on native writes recheck binding/ownership in the transaction. A finalized exam is allowed to answer native Eva or view embedded Eva; do not reuse the live-module write gate or acquire/reopen an exam writer lease. Owner refresh for terminal attempts already exists. A revoked or mismatched credential remains rejected.

For a native write, after the shared schedule fence and owning attempt lock, hold a shared lock on the matching `attempt_sessions` row and verify expiry, revocation, user/schedule/attempt binding and applicable credential epoch before replay or mutation. This serializes a session revocation with acceptance; merely calling a pre-transaction read verifier or performing an unlocked repeated read is insufficient. Follow the existing attempt → session ordering of credential rotation and test it alongside End Exam.

GET returns a candidate-safe definition and independently modeled state:

```ts
type EligibleEva = {
  eligibility: 'eligible';
  collection: 'open' | 'closed';
  versionId: string;
  closedAt: string | null;
  canReturnToComplete: boolean;
};

type EvaState =
  | { eligibility: 'not_applicable'; mode: null; canReturnToComplete: true }
  | (EligibleEva & {
      mode: 'native';
      response: 'not_submitted' | 'submitted';
      canSubmit: boolean;
      fields: Field[];
      answers: Record<string, string | number | null> | null;
      revision: number; // 0 for missing native response
      firstSubmittedAt: string | null;
      updatedAt: string | null;
    })
  | (EligibleEva & {
      mode: 'embed';
      response: 'not_tracked';
      canSubmit: false;
      canOpen: boolean;
      canReturnToComplete: true;
      embedUrl: string | null; // withheld when closed
      externalOpenUrl: string | null; // same validated configured URL
    });
```

For either mode the owner must have a SAT attempt, a Math-inclusive effective scope, enabled Eva, and the existing authoritative successful-completion condition. A merely elapsed client timer, provisional submit without durable completion confirmation, cancelled sitting, or individually terminated attempt is not successful eligibility. Ineligible reads return explicit `not_applicable` without an external URL; writes are rejected with a stable reason.

Native `canReturnToComplete` is false only while access is open and no first response is submitted. Embed always permits return and never supplies native answer/revision fields. A state read from the authoritative store ordered after closure withholds both URL fields and returns `canOpen: false`. Do not store the whole Eva state in an immutable-version cache. A response issued before closure can already have disclosed a URL; its later browser use is not revocable.

PUT is native-only and accepts `{operationId, expectedRevision, versionId, answers}`. Check the pinned mode before accepting a native response; an embed-mode PUT fails with proposed 409 `EVA_MODE_MISMATCH`, with no response row or receipt inserted. The authenticated attempt owns its identity; the request cannot override student/room/organization. Use existing `lifecycle.Load/Store` with attempt scope and proposed operation kind `eva_sim_submit`. A new logical native edit has a new operation ID; network retries reuse the original ID and exact payload. Normalize and hash the request consistently.

| Condition | Contract |
| --- | --- |
| Valid new write | 200 acknowledgement with accepted revision and timestamps; response and receipt committed together. |
| Matching committed operation, even after closure | 200 original receipt; no new write or reopening. Refresh state to show current collection status. |
| Same operation ID, different content | Existing 409 operation-ID conflict. |
| Stale `expectedRevision` | 409, proposed reason `FORM_RESPONSE_CHANGED`; return current revision, preserve the student's unsent input for review. |
| Explicitly closed collection | 409, proposed reason `EVA_SIM_CLOSED`; no change to stored response. |
| Native PUT against embed mode | 409, proposed reason `EVA_MODE_MISMATCH`; no fake response/receipt. |
| Invalid/unknown/inapplicable fields or choices | Existing 422 validation envelope with field-ID keyed errors. |
| Missing or mismatched authentication | Existing 401/403 or resource-scoped 404 policy; never reveal another student's state. |
| Oversize body | Existing 413. |
| Throttled or DB unavailable | Existing 429/503 and retry guidance. A timeout is an unknown outcome, never a confirmed save. |

All personalized responses use `Cache-Control: no-store`. Do not cache mutable submission/closure state using an immutable exam-version ETag. Embed load/Back/new-tab actions do not call the native PUT; no external-submission callback endpoint, receipt or answer import is added.

### 3.5 Staff viewing and End Exam

Proposed `GET /v1/assessment-forms/responses` accepts `examId`, `scheduleId`, `versionId`, `formKey`, `mode`, `status`, `cursor`, `limit`. Its form choices are Common registration, Verbal entry, Math entry and Eva SIM. Proposed `GET /v1/assessment-forms/attempts/{attemptID}/responses/{formKey}` loads an authorized current native response with pinned labels/options, or external-mode metadata without answers. Start lists from attempts so nonrespondents are representable. Distinguish not applicable/empty, waiting for section/break, required/not submitted, submitted, pending Math completion for Eva, and external `not_tracked`; closure is additional state. Do not call a Math form unsubmitted before it is available. Exclude external Eva from native submission counts; common and section responses remain readable for embed-mode exams. A submitted section form is not evidence its exam started or completed.

Use a stable attempt-ID keyset cursor, bound to the selected filters and authorized scope. Apply scope and status predicates before `LIMIT`; never fetch a page then remove unauthorized/nonmatching rows in application code. The response lookup uses the new primary key `(attempt_id, form_key)`. Verify the covering indexes already declared in local migration 0101 on `student_attempts(schedule_id, id)` and `(exam_id, id)`, named `idx_student_attempts_schedule_form_page` and `idx_student_attempts_exam_form_page`. Validate actual migrated presence and index use before deployment; do not create duplicate indexes. Global admin paging can use the attempt primary key. Read answer JSON and definition JSON only for selected page identities, grouped by distinct version. Do not call the one-attempt scope resolver once per list row. Centralize the bulk eligibility/status SQL and test its scope semantics against the same domain fixtures, including malformed stored scopes and absent forms.

Recommended initial viewer policy: admin across its existing permitted scope, proctor only for assigned rooms; builder may author questions but does not gain student-answer access; grader gains no new form access automatically. These are explicit conservative implementation defaults, not a newly confirmed expansion of staff roles. Apply role and resource predicates before pagination/counts/details, including direct URLs.

Proposed `GET /v1/proctor/sessions/{scheduleID}/forms/state` returns `{evaSimEnabled, mode: 'native'|'embed'|null, collection: 'open'|'closed'|'not_applicable', closedAt}` to authorized room viewers. Use this small query for room control availability and mode-specific confirmation text; no per-student response scan is needed for the End Exam button.

Keep existing `POST /v1/proctor/sessions/{scheduleID}/control/complete-exam` and generic authorized runtime-complete route. Extend the **explicit staff command paths only** to close collection in their existing transaction. Reuse one proposed `CloseEvaInTx` helper. Do this after authorizing/replaying a committed operation but before terminal-runtime no-op returns. Return or refetch authoritative collection state. No separate user-facing close button is required: End Exam performs the agreed action.

For embed mode the committed effect is application closure, not remote-provider closure. On the next state observation unmount the iframe and remove new-tab/reopen controls. Refetch state before an intentional reopen/new-tab action; a stale page must not deliberately launch from an old cached URL after it has observed closure. Explicitly retain the residual race: a URL already returned or navigation already started cannot be withdrawn atomically from another origin.

Closure is monotonic for the mounted attempt/version: once the client has observed closed state, ignore a late older open response. Cancellation, identity changes and unmount cancel stale state requests. No cached URL or local subview preference may remount an iframe after closure has been observed.

## 4. Critical data flow

### Author → version → room

1. Load exam forms as draft/read-only published definition; opening the page has no write side effect.
2. Explicit edit opens/reuses the existing draft. PUT validates and merges `forms` under the draft lock and revision check.
3. Create room validates the saved draft including its form rules and captures/seals that version using the existing transaction.
4. Existing rooms/links continue to reference their old version. A later draft edit cannot change those forms.

### Registration → first credential

1. Public metadata loads only the pinned, applicable registration fields.
2. The student submits identity plus `{versionId, answers}` through either entry UI. Queue/retry payloads retain the same custom answers and version.
3. Existing entry logic establishes the trusted principal and registration/attempt. These preparatory records may already exist.
4. `attempts.Admit` locks its existing attempt ownership row. The credential-issuer closure checks existing eligibility, then validates/stores the initial form response through that transaction handle.
5. The same transaction issues the attempt token/session binding. Commit is the authority; only then can the client receive successful admission. Any failure rolls back both new response and credential issuance.
6. If response delivery is lost, existing principal/capability recovery selects the same attempt; it finds the sealed registration response and obtains the normal owner credential. Public email/code alone remains insufficient.

### Section form → individual section start

1. After common admission, load the eligible first-section form. Staff/code release remains required where configured; the initial form may be answered while waiting, without redeeming a code or starting a module.
2. For full SAT, Verbal module finalization creates/starts the normal personal break and seeds Math without starting its clock. Break expiry marks only the break complete. A valid zero-length break proceeds directly to the Math form; Math-only has no synthetic Verbal/break step.
3. Bootstrap/section-state returns `required` only when this section is available. The client shows the separate named form with “Your [section] timer has not started.” It must not invoke automatic module entry while the gate is pending, or show a fake paused timer.
4. PUT commits accepted answers plus receipt; no clock starts. After acknowledgement or authoritative reconciliation, continue through the existing explicit start command/release. If the app crashes between these checkpoints, refresh resumes the accepted form and offers start rather than collecting it again.
5. The activation transaction checks the stored form, no pending break, current proctor/runtime/code policy and actual section/module, then starts the individual clock at DB time using existing activation/epoch handling. Refresh/two tabs recover the same module/deadline.
6. If End Exam, termination, pause or the existing absolute admission window prevents starting, expose that exact state. No successful Math-completion/Eva claim is generated merely by submitting its entry form.

### Math completion → selected Eva mode → Complete

1. Existing SAT durability/finalization completes unchanged. The completion UI states that SAT submission succeeded even if Eva later fails to load.
2. A small Eva GET starts only at the authoritative complete surface. While initial state is unknown, show loading/retry instead of silently skipping a potentially mandatory questionnaire.
3. Native eligible/open/unsubmitted → show native Eva automatically. Native submitted → Complete with Edit Eva SIM. Native closed/unsubmitted → closed/not submitted and allow Complete. Ineligible/disabled → existing Complete.
4. On native submit, authenticate, read the room fence with a shared lock, lock the owning attempt/response in the established order, check the operation receipt, then verify mode, eligibility, revision and answers.
5. Commit the native response and receipt together. Only acknowledged commit unlocks first return. If acknowledgement is lost, retry the same operation or reconcile via GET; never invent success locally. Later edits use the accepted revision; unsent changes may be discarded with confirmation once first submission is satisfied.
6. Embed eligible/open → automatically enter the isolated iframe view once per completion-view session. Back to SAT Complete is always available; Open form in new tab is user-initiated and always offered while open. Both use the same validated configured URL. Neither action writes a response or changes `not_tracked`.
7. Keep the student's chosen completion subview locally, scoped to attempt/version, so polling does not force the iframe open again after Back. A sessionStorage UI preference may preserve it through refresh; blocked storage falls back to memory and may auto-show the embed again. This preference is never server completion evidence. Complete offers Open Eva again while access is open.
8. When embed closure is observed, unmount the iframe, remove open actions, and retain Back plus a closed/not tracked message. If authoritative access cannot be revalidated, stop mounting/launching external content until retry; do not claim the provider was closed. Never call root `onExit` merely to switch Eva ↔ Complete.

### Staff End Exam versus native submission / embedded access

1. Native student writes take `exam_schedules ... FOR SHARE` before their own attempt/response lock. Different students share the room read fence and do not exclusively serialize on the room row. Embedded visits introduce no answer write or per-visit transaction.
2. Staff End Exam takes the existing exclusive schedule lock before its attempt/runtime locks. It sets closure metadata and performs existing exam termination/audit/outbox work in one transaction.
3. If a student already owns the shared fence, that transaction can finish before End Exam acquires its exclusive lock. End Exam then closes collection. If End Exam wins first, the subsequent student write observes closure and fails.
4. Automatic timeout/reconciliation does not set the closure metadata, including the personal-timing call into generic `CompleteInTx`.
5. An already auto-completed runtime still permits the explicit End Exam command to set closure. Do not rerun scoring, duplicate auto-submit work, or rewrite final exam answers in this branch.
6. Embed state is then closed on the server. Existing browser views remove frames/actions on revalidation; already loaded remote documents, disclosed URLs and requests to the provider are not part of the DB transaction and may continue outside our app.

## 5. Recommended design

### Responsibility ownership

| Owner | Responsibility |
| --- | --- |
| Existing `backend/go/internal/assessmentforms/definition` | Pure mode/field/URL structs, canonicalization, bounded native definition/answer validation and owning-form resolution. No imports of schedules, delivery, runtime or storage services; no network fetch of configured URLs. |
| Existing `exams` / `authoring` | Draft-only persistence, configuration merge, revision/freeze checks and authoritative readiness/sealing. Import the pure definition package only. |
| Existing `backend/go/internal/assessmentforms` | Native response reads/writes, mode-aware Eva eligibility/state, receipt/CAS, closure helper and staff-scoped queries; withhold closed/ineligible embed URLs and reject embed-mode PUTs. Reuse existing `exams` scope resolver; do not depend on runtime/delivery services. |
| Existing admission issuer | Call registration-response enforcement inside the owning admission transaction; no duplicate UI/handler-only guards. |
| Existing delivery service | Own section-entry eligibility, sealed-submit orchestration, one activation gate decision, all explicit/automatic section starts and preparation-deadline anchoring. Call forms helpers within the existing transaction; do not put timing decisions into generic rendering or registration. |
| Existing manual runtime/proctor commands | Call one closure helper within the existing End Exam transaction. Automatic runtime helpers remain separate. |
| Existing `src/features/assessment-forms` | Shared typed contracts/native renderer/editor, mode selector/URL input, isolated embedded view, API/query hooks and explicit save/error states. Presentation follows the discriminated contract, not hardcoded SAT labels or URL guesses. |
| SAT adapters | Configure common/Verbal/Math defaults, host all editors under Settings, render section-entry at its timed boundary, host Eva inside completion and expose separate staff form-response navigation. |

Proposed locations above are new; keep Go imports acyclic by separating pure definitions from the response service. Use existing dependency injection and the app graph, not a service locator.

### UI placement

The [UX/UI specification](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/docs/plans/SAT-configurable-forms-and-eva-sim-ux.md) defines Settings, common check-in, separate section entry, Eva, Complete and staff viewing/closure, with UX-01–UX-11 acceptance criteria. It preserves SAT skins and supplies layout/copy contracts rather than claiming rendered mockups were tested. Phases 5–6 own them; phase 7 verifies them.

- Add Common registration, Verbal form, Math form and Eva SIM editors inside exam Settings. Each displays when it appears and saves independently through the shared revision owner. Eva retains enabled/native/embed controls, URL/preview/fallback. Form ownership supplies applicability; preserve IDs/required/choice/reorder and preview controls. Warn before discarding dirty Eva mode content. Reuse SAT/Radix primitives; no new builder dependency.
- Both entry routes use the same candidate renderer and typed answers. Keep Code/Name/Email in their current access-mode-aware component; custom questions cannot change identity authorization.
- Add a `section-entry-form` stage in the existing student surface derivation, keyed by attempt/version/section. Prioritize terminal/recovery and an active break; show the eligible form before pre-start/code/start auto effects. Use the same native renderer, with “Submit and continue,” an untimed explanation and distinct submitted-but-waiting/start-retry states. Break copy says the Math form opens next for a configured Math gate; otherwise retain automatic-start copy.
- Add a completion-flow wrapper at the existing completed stage, outside the exam timer/state machine. Pass an Eva action slot through both completion-only and released-score branches. The root exam phase remains complete.
- Eva GET polling is independent of the stopped exam controller. Proposed cadence: 10–15 seconds with jitter while the completion/Eva flow is mounted, enabled access is still open and the document is visible; refetch on focus, before reopen/new-tab and after native writes; bounded backoff for 429/503. Native submit fencing is immediate. Embedded iframe/action removal has network/polling propagation delay, not a guarantee of instantaneous provider shutdown.
- Submitted answers are server truth. Do not add backend keystroke autosave or promise offline durability for unsent questionnaire edits. Dirty-navigation protection must not claim an unsent answer is saved. Existing entry queue storage must retain the extra payload without introducing indefinite localStorage storage of questionnaire answers.
- Add standalone proposed `/sat/forms` for authorized response viewers, with form/mode/status filters and detail. Embed Eva displays External form — submission not tracked with no answer controls; native registration remains readable. Add permitted room/Settings links; leave exam Responses and score tables unchanged.
- End Exam stays visible while runtime is live/paused **or** a completed room has open native collection/embedded access. Hide time-extension/pause actions on completed runtime. Confirmation describes the selected mode: native submissions/edits stop, or embedded access closes here while external tabs may remain usable. Show authoritative closed status/time afterwards.
- Extend Settings dirty-state aggregation and leave copy across all four editors; delivery-only save/reset cannot clear their edits. Update check-in instructions for access mode/common fields and section/break instructions for the new gate. Keep recovery exceptions accurate above either Eva view.

### Embedded view and security boundary

- Use a dedicated post-completion iframe with a descriptive title, responsive sizing and controls outside it. Proposed sandbox profile is `allow-forms allow-scripts allow-same-origin` for an external-origin document; no top navigation, automatic popups/downloads, or privileged device permissions. Reject our application origin and never copy Desmos trust/prewarming attributes. If that profile cannot support a provider, keep the boundary and offer the new-tab fallback. This is a proposed policy to validate with the chosen provider. [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox).
- Explicitly set iframe `referrerPolicy="no-referrer"`. The outside fallback link uses `target="_blank"` and `rel="noopener noreferrer"`; display the destination hostname so the change of site is clear. Opening the external site remains outside our app's access/closure control.
- Always show fallback and Back while open, regardless of `onLoad`. A bounded loading hint may offer help, but neither load nor timeout proves success, failure or submission. Preview must use the same renderer and sandbox as student delivery. No hidden iframe or external prefetch during active SAT.
- Keep existing `X-Frame-Options: DENY` / app framing protection. If the deployment applies restrictive `frame-src`, adjust its existing policy only for the intended external destinations after inspection; do not disable CSP or weaken `frame-ancestors`. Those directives govern different sides of embedding. [MDN frame-ancestors versus frame-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

### Why this is sufficient

Existing versions supply all native definitions and mode/URL history; the existing current-response table supplies common, Verbal, Math and native Eva answers. The schedule columns declared by 0101 supply Eva closure; existing room/proctor state closes section entry. Existing personal clocks, response receipts and explicit activation supply the transition/retry mechanism. Embed adds no answer/event table or provider integration. No separate clock service, workflow engine, queue, distributed lock, cache, EAV table or scoring type is needed.

## 6. Production and failure-mode deep dives

| Risk | Consequence | Safeguard / enforcement location | Verification | Residual risk |
| --- | --- | --- | --- | --- |
| Stale form while room version changes before admission | Answers attached to the wrong questions | Advertised version checked against pinned attempt in admission transaction; immutable version lookup | Change room release before mint and retry old payload | Student must review refreshed fields; do not silently translate incompatible answers. |
| Admission/provision/recovery bypass | Student receives authority without required registration data | Shared credential-issuer transaction check across all issuance paths | Preprovision, raw register, legacy bootstrap, recovery and normal entry tests | Old binaries bypass this; activation waits for fleet completion. |
| Crash between preparatory attempt creation and admission | Incomplete sitting | No credential until response and credential commit together; retry same attempt | Inject failure before/after response/token insertion | Preparatory rows may exist; distinguish them from admitted students in support diagnostics. |
| Response lost after commit | Duplicate Eva revision or false failure | Hash-bound receipt in same transaction, stable operation ID | Drop acknowledgement; retry before and after closure | UI may be uncertain until reconciliation; it must say so. |
| Two tabs edit the same Eva revision | Later network arrival silently overwrites newer answer | Per-attempt serialization plus expectedRevision CAS | Submit two different edits at the same revision | One tab needs explicit review/reload; no automatic last-arrival overwrite. |
| Submit races End Exam | Write accepted after visible closure | Shared room read fence vs exclusive End Exam lock; no preflight-only check | Real DB barriers for both interleavings, including first insert | UI may be stale until next fetch; server authority remains immediate. |
| Auto-complete mistaken for staff closure | No time to fill Eva | Explicit closure metadata; keep auto helpers free of that side effect | Shared and personal auto-completion tests | Staff can intentionally close before students submit; show not submitted. |
| End command on an already terminal runtime returns early | Eva stays writable forever after staff believes it closed | Close before terminal no-op return in both explicit command paths | End after automatic completion, then submit/edit | If staff never presses End Exam, collection remains open by the confirmed rule; show this state. |
| Stale whole-config save removes forms | Active configuration disappears from future release | Preserve owned forms key on omission; validate explicit forms changes | Older SaveDraft payload plus concurrent settings save | Unknown external writers must be included in activation smoke checks. |
| Authorization checked only before transaction | Revoked credential or forged IDs mutate answers | Trusted claims, in-transaction binding/ownership recheck, scope predicates | Cross-user/room, revoked and rotated token races | GET results can precede a later revocation; writes cannot rely on an old cached authorization. |
| Response list only reads submitted rows | Staff cannot identify nonrespondents | Start from eligible/scoped attempts and left-join current response | Open/closed room with mixed eligibility/submission states | Invited people who never had an attempt are not counted as eligible completers. |
| JSON size/scan grows with usage | Admission or reports exhaust capacity | Bounded definition/answer sizes, point writes, keyset pages, fetch answer JSON after page identity selection | Oversize input, query plans, burst test | No numeric production SLO is assumed; measure on the actual deployment. |
| Rollback to unaware binary | Enabled-form admission/closure rules silently bypassed | Additive schema plus release activation barrier; retain an enforcing backend until enabled rooms are drained | Old-client/new-server matrix and rollback rehearsal | Plain rollback to pre-feature API is unsafe once enabled rooms exist. |
| Embedded rendering denied or later changed | Blank/login-blocked frame prevents access | Same sandbox in preview/delivery; Back and new-tab fallback always available, not dependent on iframe events | Deny-frame, slow/error/login fixtures and the actual URL in supported browsers | Provider headers, login and third-party storage policy can change outside our release. |
| Visit falsely marked submitted | Staff see fabricated completion or students are blocked incorrectly | Discriminated `not_tracked` state; no embed PUT/answer row/receipt and no message/load-based submission inference | Load/click/Back/arbitrary postMessage and forged native PUT tests | External answers must be viewed at the provider, outside this feature. |
| End Exam mistaken for provider shutdown | Staff believe external tabs or in-flight posts are stopped | Close app state, withhold fresh URLs, unmount on observation and keep closure monotonic; state the boundary in copy | Late open-state response after closure; external tab remains independent | Previously disclosed URLs and remote requests are not revocable by our transaction. |
| Untrusted URL crosses app security boundary | Script/credential disclosure or unwanted navigation | Server HTTPS/public-host validation, no raw HTML/proxy/prefill, isolated post-completion iframe and safe fallback | Unsafe schemes/hosts/credentials, sandbox navigation, referrer and no-prefetch tests | The provider still owns its content and its own data collection policy. |
| UI waits for a form but a worker/route starts Math | Student loses exam time or sees questions before the form | One delivery-owned first-section-module gate; guard explicit activation, direct UPDATE and active-row insertion; suppress gated auto-starts | Positive/zero-break, code, legacy entry, both handoff modes and two-instance worker tests | Every future activation writer must use that decision; audit writers in implementation review. |
| Entry-recovery deadline runs during the form | A valid student becomes blocked without starting work | Gate-aware boundary creation/reconciliation; anchor preparation only after form acceptance and section eligibility | Keep form open beyond existing entry allowance; then submit/start; repeat under recovery policy | Existing absolute room/code windows still apply and must be explained; they are not working time. |
| Form commits but start/acknowledgement fails | Duplicate questions, false start or clock reset | Sealed response and receipt; explicit recoverable StartModule checkpoint; monotonic entry ACK/epoch/deadline adoption | Drop PUT/start acknowledgements independently, reload/two tabs | Form submitted can truthfully coexist with section not started; UI must show both. |
| Section forms captured with a shared-clock room or unaware worker | Form gate cannot preserve full individual time | Existing persisted personal model plus creation/start validation and API/worker activation barrier | Disable personal timing rollout, create via every schedule/link path, mix binaries before activation | Never migrate a live shared room or bypass the rollout off switch. |

Capacity estimate only for the new polling decision: **proposed test assumption**, 2,000 visible Eva clients at a 10-second floor generate at most roughly `2,000 / 10 = 200` state reads/second before jitter/backoff, plus writes. This justifies a tiny state response, no exam-payload polling, and no exclusive per-room lock on each student write. It is not a claim about production traffic. Test cadence/concurrency against the actual DB engine; the local compose file names TiDB while CI uses MySQL 8.4.

## 7. Ordered implementation phases

The version 1 base now exists locally (inventory above). Reuse it and verify its original acceptance criteria; only version 2 contracts, section entry, clock gates and the widening migration are new work. Paths that exist are integration points, not files modified by this planning task. Any added source/migration filename is proposed until allocated.

Phase **3B** is a required dependency for the section-form amendment, between the API foundation and End Exam/frontend integration. Numbered phases otherwise retain their original traceability.

| Phase | Files / components | Specific change / dependency | Coverage | Done when |
| --- | --- | --- | --- | --- |
| 1. Versioned contracts and storage compatibility | Existing definition/response packages, TS contracts, migration 0101 and schema guard; a new next-numbered migration | Preserve v1; add strict v2 parsing, normalized rendering and four form keys. Widen the existing named CHECK to permit verbal_entry/math_entry using a rehearsed migration for the actual DB engine. Reuse 0101 columns/indexes; do not recreate tables or edit an applied migration. Current local numbered migrations reach 0101; recheck allocation at implementation. | FR-1/2/7; INV-1/3/10/13/15 | Both schemas validate; old snapshots/answers round-trip unchanged; fresh/upgrade/repeated migration and schema guard tests prove v2 is refused until key expansion exists. |
| 2. Draft lifecycle | Existing [authoring/forms.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authoring/forms.go); existing [exams/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/exams/service.go), [sat_initialization.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/exams/sat_initialization.go), [authoring/shell.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authoring/shell.go), [readiness.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authoring/readiness.go), [shell_open.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authoring/shell_open.go), [satrooms/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/satrooms/service.go) | Depends on 1. Extend v1 authoring with v2 and explicit draft upgrade/preview under merge/CAS; seed common fields, empty Verbal and Expected Class in Math; validate the selected branch, preserve forms in clone/save paths and enforce readiness/sealing. Capture all form definitions and mode/URL with the existing Create room version. | FR-1/7; INV-1/3/10/12 | A field/mode/URL edit affects only a new room version; stale authors cannot clobber. Empty native or unsafe/missing enabled embed configuration blocks capture. |
| 3. Admission and server response APIs | Existing [handlers_v2.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_v2.go), [student_entry_recovery.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/student_entry_recovery.go), [handlers_device_transfer.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_device_transfer.go), [student_admission_gate.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/student_admission_gate.go), [student_context.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/student_context.go), [accesslinks/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/accesslinks/service.go); existing [handlers_assessment_forms.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_assessment_forms.go); existing [main.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/main.go), [table_staff.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authz/table_staff.go), [table_fullpath.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/authz/table_fullpath.go) | Depends on 1–2. Preserve existing v1 admission/Eva APIs; extend v2 common projection and response keys/statuses. Candidate-safe metadata, omit raw forms in generic student snapshots, common in-admission registration write/check, discriminated native/embed GET, native-only PUT with ownership/receipt/CAS, staff list/detail/state with not_tracked metadata, and route allowlists. Keep prep/provisioning paths recoverable. | FR-2/3/4/6/7; INV-1/2/3/4/6/7/9/10/11/12 | Every issuance caller is tested; registration and credential commit/rollback together; native submit/edit works, embed PUT fails without writes, and closed/ineligible state withholds URLs. |
| 3B. Section gate and personal clock | Existing [start_submit.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go), [reconcile.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/reconcile.go), [module_boundary.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/module_boundary.go), [sat_code_entry.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/sat_code_entry.go), [staff_route.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/staff_route.go), [sat_entry_state.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/sat_entry_state.go), [service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/service.go), [schedules/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/schedules/service.go), [satrooms/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/satrooms/service.go), existing forms handler and section-helper extensions | Depends on 1–3. Add authenticated section GET/PUT, sealed response/receipt checkpoint, one section-gate decision at every activation writer, gate-aware preparation allowance, persisted personal-model creation/start checks and bulk staff statuses. Keep code acceptance/proctor release and absolute windows; do not start or auto-rearm a gated M1 before its explicit entry. | FR-1/2/6/7; INV-3/7/10/13/14/15/16 | All scope/timing/worker/code/recovery/End races below pass on the actual DB; first modules stay untimed through forms; ordinary M2 progression and v1/unconfigured rooms are unchanged. |
| 4. Explicit End Exam closure | Existing [proctor/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/proctor/service.go), [runtime/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/runtime/service.go), [schedules/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/schedules/service.go), [handlers_domain.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_domain.go); new common helper in assessmentforms | Depends on 3 and 3B. Close only explicit authorized End Exam paths under existing schedule lock; handle already completed runtime; emit scoped audit without duplicate scoring/outbox effects. Prove section submit/start ordering against End Exam without duplicate locks. Add the native shared collection fence and mode-aware closed state; do not fetch or command the external provider. Automatic completion remains open for both modes. | FR-5; INV-4/5/6/7/8 | Real-DB tests prove native write/close ordering and End after automatic completion; embed state closes here without claiming provider closure. Auto-completion leaves either mode open. |
| 5. Shared frontend and entry | Existing assessment-forms contracts/API/domain/UI and [FormsSettingsPanel.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/settings/FormsSettingsPanel.tsx); existing [ExamSettingsPage.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/settings/ExamSettingsPage.tsx), [StudentEntryRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/routes/StudentEntryRoute.tsx), [StudentAccessLinkEntryRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/routes/StudentAccessLinkEntryRoute.tsx), [studentEntryGateway.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/infrastructure/studentEntryGateway.ts), [PublicStudentAccessLink.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/contracts/access-link/PublicStudentAccessLink.ts), [authService.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/services/authService.ts), [authSession.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/auth/authSession.tsx) | Depends on 2–3 and 3B. Extend shared editor/renderer and existing mutation serialization for v1/v2, explicit draft upgrade, mode selector, URL validation/preview and isolated embed renderer; metadata survives frontend mapping; one exported entry payload type replaces duplicated inline payload definitions; queue/retry transport preserves fields/version; four independent editor saves, stage-aware preview, legacy/open-link instruction updates and errors. Common entry omits Expected Class; the shared native renderer also serves section forms. | FR-1/2/7; INV-1/2/3/10/12; NFR-5 | Both entry routes submit identical typed custom answers; editor saves correctly and invalid/stale saves retain input; legacy provider tests remain unchanged. |
| 6. Section delivery, completion and staff workspace | Existing [satStudentSurface.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/application/satStudentSurface.ts), [SatStudentStageHost.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/ui/stage/SatStudentStageHost.tsx), [assessmentDelivery.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/contracts/assessmentDelivery.ts), [useSatExamController.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts), [SatScheduledBreakScreen.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/ui/break/SatScheduledBreakScreen.tsx), [SatStudentSessionRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/routes/SatStudentSessionRoute.tsx), [SatCompleteScreen.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/ui/transitions/SatCompleteScreen.tsx), [SatScoreReport.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/ui/transitions/SatScoreReport.tsx), [assessmentDeliveryApi.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/api/assessmentDeliveryApi.ts), [SatSessionControls.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/ui/SatSessionControls.tsx), [SatSessionRoomConfirmDialog.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/ui/SatSessionRoomConfirmDialog.tsx), [SatSessionRoomRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatSessionRoomRoute.tsx), [SatRoot.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/SatRoot.tsx), [createRouter.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/app/router/createRouter.tsx), [route-manifest.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/app/router/route-manifest.ts); existing [SatFormResponsesRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatFormResponsesRoute.tsx) | Depends on 3–5 including 3B. Add section-entry-form stage/DTO, gate-aware auto-entry, per-section submit/start/recovery, break copy, and viewer form/status choices. Mode-aware completion subview with independent queries, native save/edit, isolated iframe, always-available Back/new-tab fallback while open, and closed/error states. Add mode/status response filters and End Exam availability; retain score-report policies. | FR-2/3/4/5/6; INV-4/5/8/9/11/12/13/14/15/16; NFR-5 | Real browser proves section forms never run under a working timer and do not recur at M2; then covers native mandatory submit/edit, embed Back/reopen/fallback/blocked frame, both report variants, no fake external responses, closure propagation and scoped viewing. |
| 7. Verification and release | New focused tests alongside the above; existing [ci.yml](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/.github/workflows/ci.yml); proposed `/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/e2e/sat-forms-eva-sim.spec.ts` and `/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/k6/sat-forms-eva-sim.js` | Depends on 1–6 including 3B. Run matrix below, migration/replay/failure injection, burst/query-plan checks and fleet compatibility rehearsal; activate only one newly created pilot room first. | All FR/NFR/INV | Required checks pass with evidence, all 44 planned cases including worker/start/preparation gates covered, old rooms unchanged, manual End Exam proven on the running fleet, rollback floor documented. |

## 8. Test matrix

All tests below are **planned**, not reported as run. Use shared TS/Go fixtures for schema and answer semantics so client/server validation cannot drift. Use real DB barriers/transactions for ordering guarantees; sqlmock alone cannot prove them.

| Case | Setup / stimulus | Expected persisted and external outcome | Level | Coverage |
| --- | --- | --- | --- | --- |
| TC-01 | Author creates/reorders/renames fields and option labels; reopen draft and capture next room | Saved structure/IDs survive; new room uses edited version, old room and labels unchanged | Unit + DB + E2E | FR-1/7; INV-1 |
| TC-02 | Two editors save one draft revision; old whole-config payload omits forms | One conflicting edit is refused; omission preserves forms; unrelated timing keys survive | DB + component | FR-1/7; INV-1/10 |
| TC-03 | Enabled empty native Eva; malformed schema; duplicate IDs/options; oversize definition | Draft readiness explains invalid state; room seal rejects, no partial release/room | Unit + DB | FR-1/7; INV-3 |
| TC-04 | Direct and link entry: full, Math-only, R&W-only; scoped full release | Common Year/seat only at entry; configured Verbal before Verbal, Expected Class in Math form after break (initial for Math-only); none for R&W-only | Contract + E2E | FR-2/7; INV-3 |
| TC-05 | Year 2027, 70, fractional/nonfinite values; seat A-007; valid/invalid choice IDs; unknown/hidden fields | Exact numeric/choice/bounds validation; A-007 preserved; malformed answers rejected without admission | Unit + HTTP | FR-2; INV-2/3 |
| TC-06 | Two students enter the same seat | Both can be admitted with separate responses; no seat uniqueness error | DB + E2E | FR-2 |
| TC-07 | Preprovisioned attempt / raw register / legacy bootstrap without required response | Preparatory rows may exist; first usable credential is not issued; valid subsequent entry completes same attempt | DB + HTTP | FR-2/7; INV-2/7 |
| TC-08 | Crash/injected error before response, after response insertion, and after token insertion before transaction commit | Rollback has neither new response nor usable new credential; retry succeeds once | Real DB | FR-2; INV-2 |
| TC-09 | Lost admission response; owner resumes after admission/link window closes; stale client supplies different registration answers | Same owned attempt resumes with unchanged stored registration; public identity alone cannot recover it | DB + HTTP | FR-2/7; INV-2/7 |
| TC-10 | Math/full complete with native/embed Eva enabled/disabled; R&W-only; absent forms; both score-report settings | Only applicable enabled completion auto-opens the selected mode; all other completion and score behavior remains unchanged | E2E | FR-3/7; INV-4/10 |
| TC-11 | Client timer hits zero or submit is provisional/unacknowledged, then final confirmation arrives | No premature native write, iframe mount or external prefetch; finalization completes first; Eva failure cannot reopen SAT | Contract + E2E | FR-3; INV-4 |
| TC-12 | Open native Eva, omit required answers, then submit valid answers; reopen/edit/resubmit | First invalid submit does not unlock Complete; valid first send unlocks; edit increments revision and detail shows current answers | DB + E2E | FR-4; INV-3/9 |
| TC-13 | Lose successful Eva acknowledgement; retry same operation before/after End Exam | Same receipt/revision returned; one effect; collection remains closed after replay | DB + HTTP | FR-4/5; INV-5/6 |
| TC-14 | Same operation ID changed payload; two tabs submit different edits at one revision | Operation-ID conflict or revision conflict; accepted response is never silently overwritten | Real DB | FR-4; INV-6 |
| TC-15 | End Exam wins exclusive schedule fence before first submit/edit | Submit/edit refused; existing response, scores and original exam receipt unchanged | Real DB barriers | FR-5; INV-4/5 |
| TC-16 | Eva write wins shared schedule fence, End Exam waits | Student transaction commits, then End Exam closes; no later new write succeeds | Real DB barriers | FR-5; INV-5 |
| TC-17 | Automatic shared timeout and personal-room admission-window completion; then staff End Exam | Automatic completion leaves Eva open; End closes it despite already-completed runtime | DB + E2E | FR-5; INV-8 |
| TC-18 | Repeat End Exam and lose its acknowledgement; exercise generic authorized complete route | Closure timestamp/actor remain stable; no duplicate scoring/auto-submit/audit effects for replay | DB + HTTP | FR-5; INV-6/8 |
| TC-19 | Close while student has unsent first answers; refresh closed screen | No write accepted; closed/not submitted visible; Complete reachable; no redirect loop | E2E | FR-3/5; INV-4/9 |
| TC-20 | Expired terminal-owner token refresh, rotated/revoked token, forged URL attempt/schedule, another user's code/email | Legitimate terminal owner can read/edit while open; unauthorized requests fail without disclosure or write | DB + HTTP | FR-4/6; INV-7 |
| TC-21 | Admin, assigned/unassigned proctor, builder, grader and foreign-tenant reader request list/detail/state | Only allowed scopes return rows; filtering/counts cannot leak another scope | HTTP + DB | FR-6; INV-7 |
| TC-22 | Native completers with/without responses, incomplete/terminated attempts, disabled/legacy forms, two published versions | Standalone viewer distinguishes native eligibility/submission with corresponding pinned labels; score views/exports unchanged | DB + E2E | FR-6/7; INV-1/9/10 |
| TC-23 | Keyboard/mobile flow: mode selector, URL preview, titled iframe, fallback/Back, native errors/reorder/submit/edit and close | Accessible labels, outside-frame controls/focus, loading not blocking Back, and truthful native/external status | Component + Playwright a11y | FR-1/2/4; NFR-5 |
| TC-24 | Migration 0101 plus new CHECK widening fresh/repeated/partially interrupted; v1/v2 schemas; legacy client to upgraded server; unaware binary with activation disabled | Old keys remain valid, new keys allowed only after expansion, strict schema discrimination, clear refusal, legacy rooms work; enabled forms cannot be activated on unaware fleet | DB + rollout rehearsal | FR-7; INV-10 |
| TC-25 | Proposed 2,000-client completion burst, state polling, submissions and concurrent closure on two API instances | No duplicate rows/lost revisions/post-close writes; bounded queries/pages; measure latency, pool waits, deadlocks and retry load | k6 + DB | NFR-1/4; INV-5/6 |
| TC-26 | Existing SAT answer recovery/close, start/code-start, result release, IELTS and ACT entry suites | No altered answers, scores, provider validation, legacy/ungated timing, within-section M2 or admission behavior; configured first-section timing changes only as specified | Existing regressions | FR-7; INV-4/10 |
| TC-27 | Save each mode; mixed fields/URL, unknown mode, blank enabled URL, HTML, unsafe schemes, URL credentials, local/private/app hosts, overlong URL | Native/embed branch validation and sealing are correct; unsafe values rejected server-side; no arbitrary URL fetched or proxied | Unit + HTTP + DB | FR-1/7; INV-3/10/12 |
| TC-28 | Render allowed, denied-frame, slow/error and login-dependent fixture URLs in preview/student view | Same sandbox policy; fallback and Back remain available; load event never proves readiness/submission; safe title/referrer/new-tab isolation; no external load before completion | Playwright + controlled origins | FR-1/3/4; NFR-2/5; INV-11/12 |
| TC-29 | Embed view: Back, poll, reopen, new tab, refresh, blocked browser storage and arbitrary completion messages | Back always works; local choice avoids polling loops; refresh preference is UI-only; no native PUT/response row/receipt or submitted status | E2E + HTTP assertions | FR-3/4; INV-4/9/11 |
| TC-30 | Auto-complete embed room, then staff End; delayed old open response arrives after closed observation; direct state/reopen attempts | Auto-completion leaves access open; End closes app access, fresh state withholds URLs, iframe/actions disappear and cannot be resurrected by stale response. Already opened external tab remains outside closure control | DB + E2E with controlled response ordering | FR-5; INV-5/8/11 |
| TC-31 | Publish/capture native → embed URL A → embed URL B → native across rooms; mutate remote content at URL A | Each old room retains captured mode/fields/URL; no responses reused between versions; the system does not claim to freeze remote content | DB + E2E | FR-1/7; INV-1/10 |
| TC-32 | Standalone viewer mixes native submitted/unsubmitted Eva and embed Eva, with common and section answers; filter mode/status | External rows show not tracked, no fake answers/timestamps and no inclusion in native completion rates; common/section answers remain readable under the same authorization | DB + E2E | FR-6; INV-7/9/11 |
| TC-33 | Exercise all six specified surfaces including section entry at 320/768/1440 CSS px, 200% zoom, long Thai/English labels, virtual keyboard, forced colors and reduced motion | App content/actions remain reachable without clipping or horizontal page overflow; existing skins/input sizing retained; measured rendered contrast meets applicable thresholds; provider limitations retain an accessible outside fallback | Real-browser manual + Playwright | NFR-5; UX-01/02/03/06/07/08 |
| TC-34 | Dirty common/Verbal/Math/Eva editors plus delivery saves; save one form while the other/newer input is dirty; switch mode, delete/reorder by keyboard, navigate away, fail/stale-save, preview, and use open-code access modes | Payload contains only the submitted section change; serialized saves use confirmed revision; acknowledgement preserves other/newer edits and dirty guards; no false Saved status; explicit discard, focus/position announcements; safe preview, correct instruction copy, compatible version-refresh review and shared renderer | Component + E2E | FR-1/2/7; NFR-5; UX-04/05/09/10 |
| TC-35 | Walk initial loading/error, uncertain native acknowledgement, conflict, closure while focused in native/iframe, return/reopen in both completion branches, filtered/empty/error staff list and End request failure | Mode-specific gating/actions/copy match the UX specification; SAT/recovery messages stay accurate; focus returns to a surviving target; filters/list position preserved; no false external status or premature closure | Component + E2E + manual screen reader | FR-3/4/5/6; NFR-5; INV-4/9/11; UX-04/05/09/10 |
| TC-36 | Full SAT common entry → configured Verbal → both modules → break → Math form; Math-only, Verbal-only and selected-module variants | Common fields once; distinct section forms at correct boundaries; Expected Class only in Math form; no Math form while break active, no repeated form at M2 and no fictitious break for Math-only | Contract + E2E | FR-1/2; INV-3/13/15; UX-11 |
| TC-37 | Personal server_start/client_start and recovery policy: worker/reconcile at break expiry, zero-break handoff, direct start without form; two API/worker instances | Break completes at its real deadline; gated M1 remains not_started with null started_at/available_at/auto_start_at; all activation/active-insert paths refuse/skip until form plus explicit authorized entry; same-section M2 keeps its configured behavior | Real DB + E2E | FR-2/7; INV-13/14 |
| TC-38 | Lose form PUT acknowledgement, crash between accepted form and start, lose StartModule acknowledgement, refresh/two tabs | Exactly one sealed response/receipt; resume accepted form without recollection; one module activation with original deadline/control epoch, never locally fabricated start | Real DB + E2E | FR-2; INV-6/15/16 |
| TC-39 | Section submit/start races End Exam, individual termination and pause | Existing lock order determines winner; accepted prior response retained, later new submit/start refused; paused/closed state accurate, no module resurrection or false Math completion/Eva | Real DB barriers + E2E | FR-2/5; INV-7/13/16 |
| TC-40 | Raw StartModule, start-code redemption, legacy EnterModule/offers, proctor route/rearm and recovery paths before section acceptance; forged future section/attempt/version | No bypass of section gate or code/writer/scope policy; premature Math is refused and no exam working clock opens | HTTP + DB | FR-2/7; INV-3/7/13/14 |
| TC-41 | Empty Verbal/Math forms; all-optional nonempty form with empty answers; staff explicitly upgrades a v1 draft by scope and edits a later version | Empty forms skip without response rows; nonempty forms still need explicit valid submission; v1 room/check-in/response rows unchanged; one atomic v2 draft conversion preserves IDs/options/help/bounds, moves only draft questions and never overwrites sealed answers | Unit + DB + E2E | FR-1/2/7; INV-1/3/15 |
| TC-42 | Create through room, access-link and generic schedule paths with personal rollout enabled/disabled or explicit shared choice; attempt start after incompatible setup | Section-form rooms persist personal timing; incompatible creation rolls back with clear reason; no silent timing fallback or live-room conversion; legacy/shared rooms remain usable unchanged | DB + rollout rehearsal | FR-2/7; INV-10/14 |
| TC-43 | Staff list/detail across registration/Verbal/Math/Eva: before break, waiting in form, accepted-but-not-started and external Eva | Separate pinned answers; future section marked waiting, not falsely missing; form submission not confused with exam completion or external submission; scoped filters paginate correctly | DB + E2E | FR-6; INV-7/9/15/16 |
| TC-44 | With recovery policy, leave form open beyond old available_at-based entry allowance; submit, retry, pause/resume and pass absolute code/room cutoff | No working/preparation allowance charged during form; recovery anchor starts once after acceptance/eligibility and never slides on retry; existing absolute access windows and existing post-start recovery remain enforced | DB fake clock + E2E | FR-2/7; INV-13/14/16 |

Suggested commands after implementation, from the repository root unless noted:

```bash
bun run typecheck
bun run lint
bun run build
bun run test:run
bun run test:student-bundle
bunx playwright test e2e/sat-forms-eva-sim.spec.ts
bun run e2e:sat-a11y
```

The proposed E2E spec must be included in an appropriate existing/new Playwright project rather than assuming a config's `testMatch` includes it. Run focused affected tests while implementing, then the repository-required gates once complete. In `/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go`, run `go test ./...`, `go test -race ./internal/...`, `go vet ./...`, and `go build ./cmd/api ./cmd/worker ./cmd/migrate`; explicitly run the new real-DB suites with an **isolated** migrated `TEST_MYSQL_DSN` so skipped tests are not reported as proof. If production uses TiDB, repeat the locking tests there before activation. No production database is used for migrations or failure injection.

## 9. Rollout and recovery

1. **Baseline and preserve work.** This workspace had 202 changed/untracked entries at inspection. Record the implementation baseline and coordinate touched files without resetting or reverting unrelated work. This planning task changes only plan documents. Verify actual target database/version and deployed API/worker binaries; local container/CI definitions are not production inventory.
2. **Expand schema first.** Verify/apply the existing 0101 foundation, then add a new migration widening its form-key CHECK while preserving existing response rows. Rehearse actual-engine CHECK DDL, interruption and schema refusal; do not edit an applied 0101. Verify the existing columns and page-query indexes following [MIGRATION_POLICY.md](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/migrate/MIGRATION_POLICY.md). Avoid historical response backfills, row rewrites or uniqueness on seat answers. Add schema guard entries. Rehearse column DDL, index build time/disk use and metadata-lock impact for the actual schedule/attempt-table sizes and engine before production. Use identity-only `EXPLAIN` checks to confirm page selection does not sort full snapshot/answer JSON.
3. **Deploy dormant support across the fleet.** Preserve absence-as-legacy semantics and suppress new form-configured releases until all admission, state, native-submit and explicit-complete handlers support both modes. An unknown mode must fail clearly, never be treated as disabled/native. Section-form activation also waits for every module start, worker/reconciliation, code-entry and recovery path to honor the gate; verify persisted personal timing and the existing SAT_PERSONAL_TIMING rollout setting. Reject incompatible new rooms rather than silently choosing a shared clock. Use a small proposed server capability gate if necessary for overlap; do not rely on a frontend-only toggle. Inspect deployment CSP for child-frame restrictions while retaining existing app framing protections. Keep the gate's name/implementation explicit instead of claiming an existing flag.
4. **Deploy frontend and pilot the modes in successive rooms.** Capture a pilot native room with real questions, then a separately versioned embed room with the actual destination URL. Verify common/Verbal/Math placement, personal timer and preparation allowance after forms, no worker bypass, form/start acknowledgement recovery, then native submit/edit and real-browser iframe/login/sandbox behavior, explicit fallback, return/reopen, owner resume, End after auto-completion and mode-specific reporting. Existing links retain their mode/URL/fields. A preview is a usability check at that time, not a guarantee of future provider behavior.
5. **Observe only relevant signals.** Add low-cardinality outcomes for native form submits (`accepted`, `replayed`, `stale`, `closed`, `invalid`, `unauthorized`, `failed`), mode/URL validation refusals, missing registration and explicit closure failures; measure handler/DB latency and pool waits. Log IDs/field IDs/reasons only, never answers, names, email, bearer tokens or full destination URLs/query strings. Do not label iframe loads or external-open clicks as successful submissions. Support can inspect mode/version, closure time and native response revision in authorized views.
6. **Expand after pilot evidence.** Record environment, test run, request/error rates, lock waits and closure outcomes. Choose any performance threshold from the measured baseline or documented operational SLO; this plan supplies no invented production latency guarantee.

**Rollback floor:** Before any enabled room exists, additive tables/columns can remain while the previous application runs. After version 2 activation, a version-1-only or otherwise unaware API/worker is unsafe: it may issue credentials without collecting answers or leave Eva open on End Exam. Keep the last section-gate/Eva-enforcing API and worker binaries as the rollback floor; disable creation of additional enabled releases, retain data, and roll back only compatible frontend/backend versions. If emergency closure is necessary, authorized staff End Exam intentionally ends the affected exam as well; communicate that effect before using it. Do not run a destructive down migration or silently modify a published form.

**Recovery owner/action:** An authorized operator checks pinned mode/version and closure metadata; native mode additionally has a response revision/receipt. Embed mode has no response receipt to reconcile; use the external provider separately for its answers, without claiming in-app verification. A client with an ambiguous submit retries the same operation or fetches current state. A pending registration/attempt with no credential can repeat entry using its verified principal/capability. A closure transaction failure leaves neither a committed explicit closure nor a falsely successful End Exam response; retry the existing command. Changes that would reopen collection or amend an already-admitted registration require a separately specified feature, not ad hoc JSON edits.

## 10. Open decisions and final gap review

No additional product decision blocks this amended plan. Confirmed on 2026-10-24: separate Verbal/Math forms, Math after the break, and individual timers starting only after accepted section answers plus normal start authorization. Common details remain collected once at check-in; empty Verbal forms skip until staff supplies questions. Also confirmed: per-exam native/embed choice, native mandatory submit/edit until End Exam, embedded Back always allowed without submission tracking, new-tab fallback, and End Exam closing only app-controlled embedded access. Standalone viewing, Gregorian years, common-registration admission safety and all Eva rules remain the baseline; Expected Class moves from check-in to Math entry.

Implementation defaults/proposals to validate during development:

- Response-view roles are admin plus assigned proctor; builders author only. Broader staff answer access is not implied by “staff.”
- A cancelled or individually terminated sitting is not eligible to submit Eva, even if its room's explicit closure timestamp is still null. Normal successful auto-completion remains eligible. This is a conservative operational default; do not treat cancellation as successful Math completion.
- The proposed payload/field bounds and polling cadence are limits to test, not approved production SLOs. Eva's real question content must fit or cause an explicit bounds revision before activation.
- The proposed URL/sandbox policy must be exercised with the actual provider/browser combination; its URL is not supplied yet. Provider-specific completion integrations or sandbox exceptions require a separate scoped design. Generic embed plus the confirmed fallback can be planned without choosing a provider now.
- Actual database engine/version, fleet deployment posture and operational timing targets must be verified in the deployment environment. Activation remains blocked until the required transactional ordering has passed there.
- No starter Eva questions or external provider are invented. Native mode needs real questions; embed mode needs a valid URL and a provider/browser usability check before activation. Embedded answers, verified completion and remote-provider closure are explicitly outside scope.

Traceability:

| Requirement / invariant | Implemented in phases | Verification |
| --- | --- | --- |
| FR-1 | 1, 2, 5 | TC-01/02/03/23/27/28/31/34/36/41 |
| FR-2 | 1, 3, 3B, 5, 6 | TC-04/05/06/07/08/09/34/36/37/38/39/40/41/42/44 |
| FR-3 | 3, 6 | TC-10/11/19/28/29/35 |
| FR-4 | 1, 3, 6 | TC-12/13/14/20/23/28/29/35 |
| FR-5 | 1, 4, 6 | TC-13/15/16/17/18/19/30/35/39 |
| FR-6 | 3, 3B, 6 | TC-21/22/32/35/43 |
| FR-7 | 1, 2, 3, 3B, 5, 6, 7 | TC-01/02/04/07/09/10/22/24/26/27/31/34/37/40/41/42/44 |
| UX-01/02/03/06/07/08 | 5, 6, 7 | TC-23/28/33 |
| UX-04/05/09/10; NFR-5 | 5, 6, 7 | TC-23/28/29/30/34/35 |
| INV-1 | 1, 2, 3 | TC-01/02/22/31 |
| INV-2 | 3 | TC-05/07/08/09 |
| INV-3 | 1, 2, 3, 3B, 5 | TC-03/04/05/12/27/36/40/41 |
| INV-4 | 3, 4, 6 | TC-10/11/15/19/26/29 |
| INV-5 | 1, 3, 4 | TC-13/15/16/25/30 |
| INV-6 | 1, 3, 3B, 4 | TC-13/14/18/25/38 |
| INV-7 | 3, 3B, 4 | TC-07/09/20/21/32/39/40/43 |
| INV-8 | 4, 6 | TC-17/18/30 |
| INV-9 | 1, 3, 3B, 6 | TC-12/19/22/29/32/43 |
| INV-10 | 1, 2, 3, 3B, 7 | TC-02/10/22/24/26/27/31/42 |
| INV-11 | 1, 3, 6 | TC-28/29/30/32 |
| INV-12 | 1, 2, 3, 5, 6 | TC-11/27/28 |
| UX-11 | 3B, 5, 6, 7 | TC-36/37/38/39/40/41/42/43/44 |
| INV-13 | 1, 3B, 5, 6 | TC-36/37/39/40/44 |
| INV-14 | 2, 3B, 5, 6 | TC-37/40/42/44 |
| INV-15 | 1, 3B, 6 | TC-36/38/41/43 |
| INV-16 | 3B, 4, 6 | TC-38/39/43/44 |

Final review: all P0 behaviors have owners, contracts, phases and tests; common admission, sealed section responses, explicit individual module start and native Eva have distinct recoverable boundaries; all activation writers and preparation deadlines are included; embed mode is explicitly not tracked and cannot create native answers; automatic versus explicit completion and app versus provider closure are distinct; native definitions and mode/URL are pinned without claiming to freeze external content; mutable access is not cached by version; response viewing stays separate from results; no core requirement is deferred. Verification in this planning task is source inspection and plan validation only, not implementation/test execution.
