/**
 * Wire contracts for SAT configurable registration forms and Eva SIM
 * (docs/plans/SAT-configurable-forms-and-eva-sim.md §2.1/§3). The Go package
 * `internal/assessmentforms/definition` is the server source of truth; these
 * types mirror its JSON exactly.
 */

export type FieldScope = "all" | "math" | "reading-writing";

export interface FormOption {
  id: string;
  label: string;
}

interface FieldBase {
  id: string;
  label: string;
  help?: string | undefined;
  required: boolean;
  scope?: FieldScope | undefined;
}

export type FormField =
  | (FieldBase & { type: "text"; maxLength: number })
  | (FieldBase & {
      type: "number";
      integer?: boolean | undefined;
      min?: number | undefined;
      max?: number | undefined;
    })
  | (FieldBase & { type: "single_choice"; options: FormOption[] });

export type FormFieldType = FormField["type"];

export type EvaMode = "native" | "embed";

export interface EvaSimConfig {
  enabled: boolean;
  mode: EvaMode;
  fields?: FormField[] | undefined;
  url?: string | undefined;
}

interface CommonForms {
  registration: { fields: FormField[] };
  evaSim: EvaSimConfig;
}
export type ExamForms = CommonForms &
  (
    | { schemaVersion: 1 }
    | {
        schemaVersion: 2;
        sectionEntry: Record<
          "reading-writing" | "math",
          { enabled?: boolean; fields: FormField[] }
        >;
      }
  );

export interface SectionEntryState {
  versionId: string;
  sectionKey: "reading-writing" | "math";
  formKey: "verbal_entry" | "math_entry";
  state: "not_applicable" | "waiting" | "required" | "submitted" | "closed";
  moduleId?: string;
  fields?: FormField[];
  answers?: FormAnswers;
  submittedAt?: string;
  canSubmit: boolean;
  canStart: boolean;
}
export interface SubmitSectionEntryRequest {
  operationId: string;
  versionId: string;
  answers: FormAnswers;
}

export interface FormIssue {
  path: string;
  message: string;
}

export interface FormLimits {
  maxFields: number;
  maxOptions: number;
  maxLabelChars: number;
  maxHelpChars: number;
  maxTextAnswerChars: number;
  maxUrlChars: number;
}

/** GET/PUT /v1/assessment-authoring/exams/{examId}/forms */
export interface ExamFormsDocument {
  versionId: string;
  versionRevision: number;
  editable: boolean;
  /** null: legacy/unconfigured version. */
  forms: ExamForms | null;
  standard: ExamForms;
  issues: FormIssue[];
  limits: FormLimits;
}

export interface SaveExamFormsRequest {
  expectedVersionId: string;
  expectedRevision: number;
  forms: ExamForms;
}

/** Candidate-safe registration projection on public entry metadata. */
export interface PublicRegistrationForm {
  versionId: string;
  schemaVersion: number;
  fields: FormField[];
}

export type AnswerValue = string | number;
export type FormAnswers = Record<string, AnswerValue>;

/** Entry-time registration answers and the form version the student saw. */
export interface RegistrationSubmission {
  versionId: string;
  answers: FormAnswers;
}

interface EligibleEvaBase {
  eligibility: "eligible";
  collection: "open" | "closed";
  versionId: string;
  closedAt: string | null;
  canReturnToComplete: boolean;
}

export type EvaState =
  | {
      eligibility: "not_applicable";
      reason?: string;
      mode: null;
      canReturnToComplete: true;
      closedAt?: null;
    }
  | (EligibleEvaBase & {
      mode: "native";
      response: "not_submitted" | "submitted";
      canSubmit: boolean;
      fields: FormField[];
      answers?: FormAnswers | null;
      revision: number;
      firstSubmittedAt?: string | null;
      updatedAt?: string | null;
    })
  | (EligibleEvaBase & {
      mode: "embed";
      response: "not_tracked";
      canSubmit: false;
      canOpen: boolean;
      canReturnToComplete: true;
      embedUrl?: string | null;
      externalOpenUrl?: string | null;
      embedHost: string;
    });

export type NativeEvaState = Extract<EvaState, { mode: "native" }>;
export type EmbedEvaState = Extract<EvaState, { mode: "embed" }>;

export interface SubmitEvaRequest {
  operationId: string;
  expectedRevision: number;
  versionId: string;
  answers: FormAnswers;
}

export interface EvaAck {
  revision: number;
  firstSubmittedAt: string;
  updatedAt: string;
  answers: FormAnswers;
}

export type FormKey = "registration" | "verbal_entry" | "math_entry" | "eva_sim";
export type ResponseStatus =
  | "submitted"
  | "not_submitted"
  | "pending_completion"
  | "pending_section"
  | "not_tracked"
  | "not_applicable";

export interface FormResponseRow {
  attemptId: string;
  studentName: string;
  studentEmail: string;
  studentCode: string;
  examId: string;
  examTitle: string;
  scheduleId: string;
  scheduleName: string;
  versionId: string;
  versionNumber: number;
  formKey: FormKey;
  mode: EvaMode | null;
  status: ResponseStatus;
  collection: "open" | "closed";
  closedAt: string | null;
  revision: number;
  updatedAt: string | null;
}

export interface FormResponsePage {
  items: FormResponseRow[];
  nextCursor: string | null;
}

export interface FormResponseDetail extends FormResponseRow {
  fields: FormField[];
  answers?: FormAnswers | null;
  embedHost?: string;
  firstSubmittedAt: string | null;
}

export interface FormResponseFilters {
  examId?: string | undefined;
  scheduleId?: string | undefined;
  formKey: FormKey;
  mode?: EvaMode | undefined;
  status?: ResponseStatus | undefined;
}

/** GET /v1/proctor/sessions/{scheduleId}/forms/state */
export interface ScheduleFormState {
  evaSimEnabled: boolean;
  mode: EvaMode | null;
  collection: "open" | "closed" | "not_applicable";
  closedAt: string | null;
}

/** Stable conflict reasons (error details.reason). */
export const FORM_REASONS = {
  draftChanged: "FORM_DRAFT_CHANGED",
  versionChanged: "FORM_VERSION_CHANGED",
  responseChanged: "FORM_RESPONSE_CHANGED",
  evaClosed: "EVA_SIM_CLOSED",
  modeMismatch: "EVA_MODE_MISMATCH",
  registrationRequired: "REGISTRATION_REQUIRED",
} as const;
