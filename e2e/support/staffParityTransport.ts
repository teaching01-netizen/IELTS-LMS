import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page, Route } from "@playwright/test";

/**
 * Deterministic, database-free API transport for staff visual parity.
 * Every response is fixed data; unknown endpoints fall back to an empty
 * success envelope and are recorded so new calls show up in the network
 * baseline instead of silently changing the page.
 */

export const PARITY_NOW = "2026-10-11T02:05:00.000Z";
const NOW = PARITY_NOW;
const LATER = "2026-10-11T06:00:00.000Z";
const EARLIER = "2026-10-10T02:00:00.000Z";

export type StaffRole = "admin" | "builder" | "proctor" | "grader";

const examState = JSON.parse(
  readFileSync(resolve(process.cwd(), "e2e/fixtures/staff-parity/ielts-exam-state.json"), "utf8"),
) as Record<string, unknown> & { config: Record<string, unknown> };

function envelope(data: unknown) {
  return JSON.stringify({ success: true, data });
}

async function json(route: Route, body: string, status = 200) {
  await route.fulfill({ status, contentType: "application/json", headers: { "x-csrf-token": "csrf-parity" }, body });
}

// ---------------------------------------------------------------- IELTS

const IELTS_EXAM = {
  id: "ielts-exam-1",
  slug: "ielts-academic-mock-04",
  title: "IELTS Academic Mock 04",
  providerKey: "ielts",
  examType: "Academic",
  status: "published",
  visibility: "organization",
  ownerId: "admin-1",
  createdAt: EARLIER,
  updatedAt: NOW,
  publishedAt: EARLIER,
  currentDraftVersionId: "ielts-version-2",
  currentPublishedVersionId: "ielts-version-1",
  currentPublishedVersionNumber: 1,
  totalQuestions: 80,
  totalReadingQuestions: 40,
  totalListeningQuestions: 40,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 4,
  revision: 5,
};

const IELTS_DRAFT_EXAM = {
  ...IELTS_EXAM,
  id: "ielts-exam-2",
  slug: "ielts-general-training-draft",
  title: "General Training Draft",
  examType: "General Training",
  status: "draft",
  publishedAt: null,
  currentDraftVersionId: "ielts-version-3",
  currentPublishedVersionId: null,
  currentPublishedVersionNumber: null,
  revision: 2,
};

function ieltsVersion(id: string, examId: string, versionNumber: number, isDraft: boolean) {
  return {
    id,
    examId,
    versionNumber,
    parentVersionId: null,
    contentSnapshot: examState,
    configSnapshot: examState.config,
    validationSnapshot: null,
    createdBy: "admin-1",
    createdAt: EARLIER,
    publishNotes: isDraft ? null : "Initial release",
    isDraft,
    isPublished: !isDraft,
    revision: 3,
  };
}

const IELTS_VERSIONS: Record<string, ReturnType<typeof ieltsVersion>> = {
  "ielts-version-1": ieltsVersion("ielts-version-1", IELTS_EXAM.id, 1, false),
  "ielts-version-2": ieltsVersion("ielts-version-2", IELTS_EXAM.id, 2, true),
  "ielts-version-3": ieltsVersion("ielts-version-3", IELTS_DRAFT_EXAM.id, 1, true),
};

const IELTS_SCHEDULE = {
  id: "ielts-schedule-1",
  examId: IELTS_EXAM.id,
  providerKey: "ielts",
  examTitle: IELTS_EXAM.title,
  publishedVersionId: "ielts-version-1",
  cohortName: "Cohort A — Morning",
  institution: "Bangkok Centre",
  startTime: "2026-10-11T02:00:00.000Z",
  endTime: LATER,
  plannedDurationMinutes: 170,
  deliveryMode: "proctor_start",
  recurrenceType: "none",
  recurrenceInterval: 1,
  recurrenceEndDate: null,
  bufferBeforeMinutes: 10,
  bufferAfterMinutes: 10,
  autoStart: false,
  autoStop: false,
  status: "live",
  createdAt: EARLIER,
  createdBy: "admin-1",
  updatedAt: NOW,
  revision: 4,
};

const IELTS_SCHEDULED = {
  ...IELTS_SCHEDULE,
  id: "ielts-schedule-2",
  cohortName: "Cohort B — Afternoon",
  startTime: "2026-10-12T07:00:00.000Z",
  endTime: "2026-10-12T10:00:00.000Z",
  status: "scheduled",
  revision: 1,
};

const IELTS_RUNTIME = {
  id: "ielts-runtime-1",
  scheduleId: IELTS_SCHEDULE.id,
  examId: IELTS_EXAM.id,
  providerKey: "ielts",
  status: "live",
  timingModel: "legacy_section_v1",
  revision: 9,
  actualStartAt: "2026-10-11T02:00:00.000Z",
  actualEndAt: null,
  activeSectionKey: "reading",
  currentSectionKey: "reading",
  currentSectionRemainingSeconds: 2400,
  currentSectionDeadlineAt: "2026-10-11T02:45:00.000Z",
  nextSectionStartAt: null,
  serverNow: NOW,
  waitingForNextSection: false,
  isOverrun: false,
  totalPausedSeconds: 0,
  createdAt: EARLIER,
  updatedAt: NOW,
  sections: [
    { sectionKey: "listening", label: "Listening", sectionOrder: 0, plannedDurationMinutes: 30, gapAfterMinutes: 0, status: "completed", availableAt: EARLIER, actualStartAt: "2026-10-11T01:30:00.000Z", actualEndAt: "2026-10-11T02:00:00.000Z", pausedAt: null, accumulatedPausedSeconds: 0, extensionMinutes: 0, completionReason: "auto_timeout", projectedStartAt: null, projectedEndAt: null },
    { sectionKey: "reading", label: "Reading", sectionOrder: 1, plannedDurationMinutes: 60, gapAfterMinutes: 0, status: "live", availableAt: NOW, actualStartAt: "2026-10-11T02:00:00.000Z", actualEndAt: null, pausedAt: null, accumulatedPausedSeconds: 0, extensionMinutes: 0, projectedStartAt: null, projectedEndAt: "2026-10-11T03:00:00.000Z" },
    { sectionKey: "writing", label: "Writing", sectionOrder: 2, plannedDurationMinutes: 60, gapAfterMinutes: 0, status: "locked", availableAt: null, actualStartAt: null, actualEndAt: null, pausedAt: null, accumulatedPausedSeconds: 0, extensionMinutes: 0, projectedStartAt: "2026-10-11T03:00:00.000Z", projectedEndAt: "2026-10-11T04:00:00.000Z" },
  ],
};

function ieltsStudent(index: number, name: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    attemptId: `ielts-attempt-${index}`,
    studentId: `ielts-student-${index}`,
    studentName: name,
    studentEmail: `student${index}@example.test`,
    scheduleId: IELTS_SCHEDULE.id,
    status,
    currentSection: "reading",
    timeRemaining: 2400,
    runtimeStatus: "live",
    runtimeCurrentSection: "reading",
    runtimeTimeRemainingSeconds: 2400,
    runtimeDeadlineAt: "2026-10-11T02:45:00.000Z",
    runtimeServerNow: NOW,
    runtimeSectionStatus: "live",
    attemptRevision: 2,
    runtimeWaiting: false,
    violations: [],
    warnings: 0,
    lastActivity: NOW,
    examId: IELTS_EXAM.id,
    examName: IELTS_EXAM.title,
    ...extra,
  };
}

const IELTS_PROCTOR_STUDENTS = [
  ieltsStudent(1, "Ananda Srisuk", "active"),
  ieltsStudent(2, "Becky Tran", "warned", { warnings: 1, violations: [{ id: "v-1", type: "TAB_SWITCH", severity: "medium", timestamp: NOW, description: "Left the exam tab" }] }),
  ieltsStudent(3, "Chai Wong", "paused"),
];

const IELTS_ALERTS = [
  { id: "alert-1", severity: "medium", type: "TAB_SWITCH", studentName: "Becky Tran", studentId: "ielts-student-2", timestamp: NOW, message: "Left the exam tab", isAcknowledged: false },
];

const GRADING_SESSION = {
  id: "grading-session-1",
  scheduleId: IELTS_SCHEDULE.id,
  examId: IELTS_EXAM.id,
  examTitle: IELTS_EXAM.title,
  publishedVersionId: "ielts-version-1",
  cohortName: IELTS_SCHEDULE.cohortName,
  institution: "Bangkok Centre",
  startTime: IELTS_SCHEDULE.startTime,
  endTime: IELTS_SCHEDULE.endTime,
  status: "in_progress",
  totalStudents: 3,
  submittedCount: 3,
  pendingManualReviews: 2,
  inProgressReviews: 1,
  finalizedReviews: 0,
  overdueReviews: 0,
  assignedTeachers: ["admin-1"],
  createdAt: EARLIER,
  createdBy: "admin-1",
  updatedAt: NOW,
};

function gradingSubmission(index: number, name: string, gradingStatus: string) {
  return {
    id: `submission-${index}`,
    submissionId: `submission-${index}`,
    scheduleId: IELTS_SCHEDULE.id,
    examId: IELTS_EXAM.id,
    publishedVersionId: "ielts-version-1",
    studentId: `ielts-student-${index}`,
    studentName: name,
    studentEmail: `student${index}@example.test`,
    cohortName: IELTS_SCHEDULE.cohortName,
    submittedAt: "2026-10-11T04:50:00.000Z",
    timeSpentSeconds: 9600,
    gradingStatus,
    assignedTeacherId: "admin-1",
    assignedTeacherName: "Dana Admin",
    isFlagged: false,
    isOverdue: false,
    sectionStatuses: { listening: "auto_graded", reading: "auto_graded", writing: gradingStatus === "submitted" ? "needs_review" : "in_review" },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const GRADING_SUBMISSIONS = [
  gradingSubmission(1, "Ananda Srisuk", "in_progress"),
  gradingSubmission(2, "Becky Tran", "submitted"),
  gradingSubmission(3, "Chai Wong", "submitted"),
];

const SECTION_SUBMISSIONS = [
  {
    id: "section-sub-reading",
    submissionId: "submission-1",
    section: "reading",
    answers: { type: "reading", answers: [] },
    autoGradingResults: { totalScore: 31, maxScore: 40, percentage: 77.5, questionResults: [], gradedAt: NOW },
    gradingStatus: "auto_graded",
    submittedAt: "2026-10-11T04:50:00.000Z",
  },
  {
    id: "section-sub-writing",
    submissionId: "submission-1",
    section: "writing",
    answers: { type: "writing", tasks: [] },
    gradingStatus: "in_review",
    submittedAt: "2026-10-11T04:50:00.000Z",
  },
];

const WRITING_TASKS = [
  {
    id: "writing-task-1",
    submissionId: "submission-1",
    sectionSubmissionId: "section-sub-writing",
    taskId: "task1",
    taskLabel: "Task 1",
    prompt: "The chart below shows energy use by source between 1990 and 2020.",
    studentText: "The bar chart compares the proportion of energy produced from five sources over three decades. Overall, renewables grew steadily while coal declined.",
    wordCount: 160,
    gradingStatus: "in_review",
    submittedAt: "2026-10-11T04:50:00.000Z",
  },
];

const REVIEW_DRAFT = {
  id: "review-draft-1",
  submissionId: "submission-1",
  studentId: "ielts-student-1",
  teacherId: "admin-1",
  releaseStatus: "draft",
  sectionDrafts: {},
  annotations: [],
  drawings: [],
  overallFeedback: "Clear overview; develop paragraph two.",
  studentVisibleNotes: "",
  internalNotes: "",
  checklist: {},
  hasUnsavedChanges: false,
  revision: 3,
  createdAt: NOW,
  updatedAt: NOW,
};

const STUDENT_RESULT = {
  id: "result-1",
  submissionId: "submission-1",
  studentId: "ielts-student-1",
  studentName: "Ananda Srisuk",
  examId: IELTS_EXAM.id,
  examTitle: IELTS_EXAM.title,
  scheduleId: IELTS_SCHEDULE.id,
  cohortName: IELTS_SCHEDULE.cohortName,
  publishedVersionId: "ielts-version-1",
  releaseStatus: "released",
  overallBand: 7,
  sectionBands: { listening: 7.5, reading: 7, writing: 6.5, speaking: 7 },
  releasedAt: NOW,
  releasedBy: "admin-1",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const ADMIN_RESULT_ROWS = [
  { id: "result-1", submissionId: "submission-1", attemptId: "ielts-attempt-1", providerKey: "ielts", outcomeStatus: "scored", releaseStatus: "released", overallBand: 7, sectionBands: { listening: 7.5, reading: 7, writing: 6.5, speaking: 7 }, studentId: "ielts-student-1", studentName: "Ananda Srisuk", studentEmail: "student1@example.test", scheduleId: IELTS_SCHEDULE.id, examId: IELTS_EXAM.id, examTitle: IELTS_EXAM.title, cohortName: IELTS_SCHEDULE.cohortName, institution: "Bangkok Centre", versionNumber: 1, submittedAt: "2026-10-11T04:50:00.000Z" },
  { id: "result-2", submissionId: "submission-2", attemptId: "ielts-attempt-2", providerKey: "ielts", outcomeStatus: "scored", releaseStatus: "ready_to_release", overallBand: 6.5, sectionBands: { listening: 6.5, reading: 7, writing: 6, speaking: 6.5 }, studentId: "ielts-student-2", studentName: "Becky Tran", studentEmail: "student2@example.test", scheduleId: IELTS_SCHEDULE.id, examId: IELTS_EXAM.id, examTitle: IELTS_EXAM.title, cohortName: IELTS_SCHEDULE.cohortName, institution: "Bangkok Centre", versionNumber: 1, submittedAt: "2026-10-11T04:52:00.000Z" },
];

/** Preview runtimes start live on Listening, the builder's first module. */
function previewRuntime(scheduleId: string) {
  return {
    ...IELTS_RUNTIME,
    id: `${scheduleId}-runtime`,
    scheduleId,
    activeSectionKey: "listening",
    currentSectionKey: "listening",
    sections: IELTS_RUNTIME.sections.map((section) => ({
      ...section,
      status: section.sectionKey === "listening" ? "live" : "locked",
      actualStartAt: section.sectionKey === "listening" ? NOW : null,
      actualEndAt: null,
      completionReason: undefined,
    })),
  };
}

const PREVIEW_SCHEDULE = { ...IELTS_SCHEDULE, id: "preview-schedule-1", cohortName: "Preview", status: "scheduled", publishedVersionId: "ielts-version-2", revision: 1 };

// ---------------------------------------------------------------- SAT

const SAT_EXAM = {
  id: "sat-exam-1",
  slug: "sat-practice-06",
  title: "Practice Test 06",
  providerKey: "sat",
  examType: "Academic",
  status: "published",
  visibility: "organization",
  ownerId: "admin-1",
  createdAt: EARLIER,
  updatedAt: NOW,
  publishedAt: EARLIER,
  currentDraftVersionId: null,
  currentPublishedVersionId: "sat-version-3",
  currentPublishedScope: "full",
  currentPublishedVersionNumber: 3,
  satSectionScope: "full",
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 4,
  revision: 11,
};

const SAT_SCHEDULE = {
  id: "sat-schedule-1",
  examId: SAT_EXAM.id,
  providerKey: "sat",
  examTitle: SAT_EXAM.title,
  publishedVersionId: "sat-version-3",
  publishScope: "full",
  satStartMode: "proctor",
  satSessionMode: "practice",
  cohortName: "Morning room",
  startTime: "2026-10-11T02:00:00.000Z",
  endTime: LATER,
  plannedDurationMinutes: 180,
  deliveryMode: "proctor_start",
  recurrenceType: "none",
  recurrenceInterval: 1,
  recurrenceEndDate: null,
  bufferBeforeMinutes: null,
  bufferAfterMinutes: null,
  autoStart: false,
  autoStop: false,
  status: "live",
  createdAt: NOW,
  createdBy: "admin-1",
  updatedAt: NOW,
  revision: 7,
};

const SAT_RUNTIME = {
  id: "sat-runtime-1",
  scheduleId: SAT_SCHEDULE.id,
  examId: SAT_EXAM.id,
  providerKey: "sat",
  status: "live",
  timingModel: "cohort_section_v3",
  revision: 7,
  actualStartAt: NOW,
  actualEndAt: null,
  activeSectionKey: "reading-writing",
  currentSectionKey: "reading-writing",
  currentSectionRemainingSeconds: 1500,
  currentSectionDeadlineAt: "2026-10-11T02:30:00.000Z",
  nextSectionStartAt: null,
  serverNow: NOW,
  waitingForNextSection: false,
  isOverrun: false,
  totalPausedSeconds: 0,
  createdAt: NOW,
  updatedAt: NOW,
  sections: [{
    sectionKey: "reading-writing",
    label: "Reading & Writing",
    sectionOrder: 0,
    plannedDurationMinutes: 64,
    gapAfterMinutes: 10,
    status: "live",
    availableAt: NOW,
    actualStartAt: NOW,
    actualEndAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionMinutes: 0,
    projectedStartAt: NOW,
    projectedEndAt: "2026-10-11T03:04:00.000Z",
  }],
  examPlan: [{
    sectionKey: "reading-writing",
    label: "Reading & Writing",
    order: 0,
    durationMinutes: 64,
    gapAfterMinutes: 10,
    modules: [{ moduleKey: "rw-m1", title: "Module 1", adaptiveRole: "base", durationMinutes: 32 }],
  }],
};

const SAT_STUDENT = {
  attemptId: "sat-attempt-1",
  studentId: "sat-student-1",
  studentName: "Ananda S.",
  studentEmail: "ananda@example.test",
  scheduleId: SAT_SCHEDULE.id,
  status: "active",
  currentSection: "reading-writing",
  timeRemaining: 1500,
  runtimeStatus: "live",
  runtimeCurrentSection: "reading-writing",
  runtimeTimeRemainingSeconds: 1500,
  runtimeDeadlineAt: "2026-10-11T02:30:00.000Z",
  runtimeServerNow: NOW,
  runtimeModuleRole: "base",
  runtimeModuleDeadlineAt: "2026-10-11T02:18:00.000Z",
  runtimeModuleRemainingSeconds: 780,
  runtimeSectionStatus: "live",
  attemptRevision: 1,
  runtimeCurrentModuleId: "rw-m1",
  runtimeModuleAttemptId: "sat-module-attempt-1",
  runtimeModuleAttemptRevision: 1,
  runtimeWaiting: false,
  violations: [],
  warnings: 0,
  lastActivity: NOW,
  examId: SAT_EXAM.id,
  examName: SAT_EXAM.title,
};

const SAT_ACCESS_GROUP = {
  scheduleId: SAT_SCHEDULE.id,
  accessLinkId: "sat-link-1",
  accessLinkName: "Morning room",
  accessLinkState: "active",
  examId: SAT_EXAM.id,
  examTitle: SAT_EXAM.title,
  versionNumber: 3,
  cohortName: "Monday group",
  attemptCount: 1,
  submittedCount: 0,
  scoredCount: 0,
  pendingCount: 0,
  invalidatedCount: 0,
  latestSubmittedAt: null,
  latestTestStartedAt: NOW,
  earliestTestStartedAt: NOW,
  completedCount: 0,
  runningCount: 1,
  endedCount: 0,
  otherCount: 0,
};

const SAT_ATTEMPT_PAGE = {
  items: [{
    resultId: null,
    attemptId: SAT_STUDENT.attemptId,
    attemptStatus: "running",
    outcomeStatus: "unscored",
    releaseStatus: "",
    totalScore: null,
    scheduleId: SAT_SCHEDULE.id,
    examId: SAT_EXAM.id,
    examTitle: SAT_EXAM.title,
    versionNumber: 3,
    studentId: SAT_STUDENT.studentId,
    studentName: SAT_STUDENT.studentName,
    studentEmail: null,
    cohortName: "Monday group",
    submittedAt: null,
    testStartedAt: NOW,
  }],
  total: 1,
  offset: 0,
  limit: 50,
  hasMore: false,
};

const SAT_SHELL = {
  examId: SAT_EXAM.id,
  providerKey: "sat",
  versionId: "sat-draft-4",
  versionRevision: 4,
  sections: [{
    id: "sat-sec-1",
    sectionKey: "rw",
    title: "Reading & Writing",
    displayOrder: 1,
    durationSeconds: 1920,
    breakAfterSeconds: 600,
    revision: 1,
    routingPolicy: null,
    modules: [{
      id: "sat-mod-1",
      moduleKey: "rw-1",
      title: "Module 1",
      displayOrder: 1,
      durationSeconds: 1920,
      targetQuestionCount: 27,
      adaptiveRole: "none",
      toolPolicy: {},
      revision: 1,
      questions: [{
        examQuestionId: "sat-eq-1",
        questionId: "sat-q-1",
        questionRevisionId: "sat-rev-1",
        displayOrder: 1,
        questionType: "single_choice",
        semanticRevision: 1,
        revision: 1,
        promptPreview: "Which choice best states the main idea of the text?",
        answerKeyPreview: null,
        domain: null,
        skill: null,
        difficulty: "medium",
        tags: [],
        hasStimulus: false,
        contentComplexity: "plain",
        readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
      }],
    }],
  }],
};

const SAT_QUESTION_DETAIL = {
  examQuestionId: "sat-eq-1",
  moduleId: "sat-mod-1",
  moduleKey: "rw-1",
  sectionKey: "rw",
  displayOrder: 1,
  question: {
    id: "sat-rev-1",
    questionId: "sat-q-1",
    semanticRevision: 1,
    revision: 1,
    state: "draft",
    questionType: "single_choice",
    stimulus: { version: 1, nodes: [] },
    prompt: { version: 1, nodes: [{ type: "paragraph", id: "prompt-1", text: "Which choice best states the main idea of the text?" }] },
    answer: {
      kind: "single_choice",
      options: ["A", "B", "C", "D"].map((option) => ({
        id: option,
        content: { version: 1, nodes: [{ type: "paragraph", id: `option-${option}`, text: `Choice ${option}` }] },
      })),
      correctOptionId: "A",
    },
    rationale: { version: 1, nodes: [] },
    metadata: { sectionKey: "reading-writing", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: { longDescription: null },
  },
};

const SAT_STANDARD_FORMS = {
  schemaVersion: 1,
  registration: {
    fields: [
      { id: "sat_admission_year", type: "number", label: "Admission year", help: "Expected university admission year, e.g. 2027.", required: true, scope: "all", integer: true, min: 1000, max: 9999 },
      { id: "sat_seat_number", type: "text", label: "Seat number", help: "Enter the seat assigned by your proctor.", required: true, scope: "all", maxLength: 255 },
    ],
  },
  evaSim: { enabled: false, mode: "native" },
};

const SAT_FORMS_DOCUMENT = {
  versionId: "sat-draft-4",
  versionRevision: 4,
  editable: true,
  forms: SAT_STANDARD_FORMS,
  standard: SAT_STANDARD_FORMS,
  issues: [],
  limits: { maxFields: 50, maxOptions: 50, maxLabelChars: 200, maxHelpChars: 300, maxTextAnswerChars: 4000, maxUrlChars: 2048 },
};

// ---------------------------------------------------------------- routing

export interface ParityTransport {
  /** Requests not covered by an explicit fixture (the empty fallback served them). */
  unhandled: string[];
  /** Every API request in arrival order, as `METHOD /path?query`. */
  requests: string[];
}

type Handler = (route: Route, url: URL, method: string) => Promise<boolean>;

function exact(path: string, body: () => string, method = "GET"): Handler {
  return async (route, url, requestMethod) => {
    if (url.pathname !== path || requestMethod !== method) return false;
    await json(route, body());
    return true;
  };
}

function matching(pattern: RegExp, body: (match: RegExpExecArray, url: URL) => string | null, method = "GET"): Handler {
  return async (route, url, requestMethod) => {
    if (requestMethod !== method) return false;
    const match = pattern.exec(url.pathname);
    if (!match) return false;
    const payload = body(match, url);
    if (payload === null) {
      await json(route, JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }), 404);
      return true;
    }
    await json(route, payload);
    return true;
  };
}

const allExams = [IELTS_EXAM, IELTS_DRAFT_EXAM, SAT_EXAM];

const HANDLERS: Handler[] = [
  // Saved defaults are absent: the app derives them locally from its factory.
  matching(/^\/api\/v1\/settings\/exam-defaults$/, () => null),
  async (route, url, method) => {
    if (url.pathname !== "/api/v1/exams" || method !== "GET") return false;
    const provider = url.searchParams.get("providerKey");
    const exams = provider ? allExams.filter((exam) => exam.providerKey === provider) : allExams.filter((exam) => exam.providerKey === "ielts");
    await json(route, envelope(exams));
    return true;
  },
  matching(/^\/api\/v1\/exams\/([^/]+)$/, ([, id]) => {
    const exam = allExams.find((candidate) => candidate.id === id);
    return exam ? envelope(exam) : null;
  }),
  matching(/^\/api\/v1\/versions\/([^/]+)$/, ([, id]) => {
    const version = id ? IELTS_VERSIONS[id] : undefined;
    return version ? envelope(version) : null;
  }),
  matching(/^\/api\/v1\/exams\/([^/]+)\/versions\/summary$/, ([, id]) =>
    envelope(Object.values(IELTS_VERSIONS).filter((version) => version.examId === id).map(({ contentSnapshot: _c, configSnapshot: _s, ...summary }) => summary))),
  matching(/^\/api\/v1\/exams\/([^/]+)\/versions$/, ([, id]) =>
    envelope(Object.values(IELTS_VERSIONS).filter((version) => version.examId === id))),
  matching(/^\/api\/v1\/exams\/([^/]+)\/events$/, ([, id]) => envelope([
    { id: "event-1", examId: id, versionId: "ielts-version-1", actorId: "admin-1", action: "published", fromState: "draft", toState: "published", payload: null, createdAt: EARLIER },
  ])),
  matching(/^\/api\/v1\/exams\/([^/]+)\/validation$/, () => envelope({ canPublish: true, errors: [], warnings: [] })),
  matching(/^\/api\/v1\/exams\/([^/]+)\/draft\/reopen$/, ([, id]) => {
    const version = Object.values(IELTS_VERSIONS).find((candidate) => candidate.examId === id && candidate.isDraft);
    return version ? envelope(version) : null;
  }, "POST"),
  exact("/api/v1/library/passages", () => envelope([])),
  exact("/api/v1/library/questions", () => envelope([])),
  exact("/api/v1/schedules", () => envelope([IELTS_SCHEDULE, IELTS_SCHEDULED])),
  exact("/api/v1/schedules", () => envelope(PREVIEW_SCHEDULE), "POST"),
  matching(/^\/api\/v1\/schedules\/([^/]+)\/runtime\/commands$/, ([, id]) => envelope(previewRuntime(id ?? "")), "POST"),
  matching(/^\/api\/v1\/schedules\/([^/]+)\/runtime$/, ([, id]) => envelope(previewRuntime(id ?? ""))),
  matching(/^\/api\/v1\/schedules\/([^/]+)$/, ([, id]) => {
    const schedule = [IELTS_SCHEDULE, IELTS_SCHEDULED, PREVIEW_SCHEDULE].find((candidate) => candidate.id === id);
    return schedule ? envelope(schedule) : null;
  }),
  async (route, url, method) => {
    if (url.pathname !== "/api/v1/grading/sessions" || method !== "GET") return false;
    if (url.searchParams.has("page")) {
      await json(route, envelope({ sessions: [GRADING_SESSION], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }));
    } else {
      await json(route, envelope([GRADING_SESSION]));
    }
    return true;
  },
  matching(/^\/api\/v1\/grading\/sessions\/([^/]+)$/, (_match, url) =>
    url.searchParams.has("page")
      ? envelope({ session: GRADING_SESSION, submissions: GRADING_SUBMISSIONS, pagination: { page: 1, pageSize: 25, total: 3, totalPages: 1 } })
      : envelope({ session: GRADING_SESSION })),
  matching(/^\/api\/v1\/grading\/submissions\/([^/]+)$/, ([, id]) => {
    const submission = GRADING_SUBMISSIONS.find((candidate) => candidate.id === id);
    return submission ? envelope({ submission }) : null;
  }),
  matching(/^\/api\/v1\/grading\/submissions\/([^/]+)\/sections$/, () => envelope(SECTION_SUBMISSIONS)),
  matching(/^\/api\/v1\/grading\/submissions\/([^/]+)\/writing-tasks$/, () => envelope(WRITING_TASKS)),
  matching(/^\/api\/v1\/grading\/submissions\/([^/]+)\/review-draft$/, () => envelope(REVIEW_DRAFT)),
  exact("/api/v1/results", () => envelope([STUDENT_RESULT])),
  exact("/api/v1/results/dashboard", () => envelope(ADMIN_RESULT_ROWS)),
  exact("/api/v1/results/analytics", () => envelope({ totalResults: 2, releasedResults: 1, readyToRelease: 1, averageOverallBand: 6.75 })),
  matching(/^\/api\/v1\/results\/([^/]+)\/events$/, () => envelope([])),
  // Proctor: IELTS summary list and SAT provider list are distinct cache families.
  async (route, url, method) => {
    if (url.pathname !== "/api/v1/proctor/sessions" || method !== "GET") return false;
    const provider = url.searchParams.get("providerKey");
    const summaries = provider === "sat"
      ? [{ schedule: SAT_SCHEDULE, runtime: SAT_RUNTIME, studentCount: 1, activeCount: 1, joinReadyCount: 1, joinTotalCount: 1, degradedLiveMode: false }]
      : [{ schedule: IELTS_SCHEDULE, runtime: IELTS_RUNTIME, studentCount: 3, activeCount: 2, degradedLiveMode: false }];
    await json(route, envelope(summaries));
    return true;
  },
  matching(/^\/api\/v1\/proctor\/sessions\/([^/]+)$/, ([, id]) => {
    if (id === SAT_SCHEDULE.id) {
      return envelope({ schedule: SAT_SCHEDULE, runtime: SAT_RUNTIME, sessions: [SAT_STUDENT], alerts: [], auditLogs: [], notes: [], presence: [], violationRules: [], degradedLiveMode: false });
    }
    if (id === IELTS_SCHEDULE.id) {
      return envelope({ schedule: IELTS_SCHEDULE, runtime: IELTS_RUNTIME, sessions: IELTS_PROCTOR_STUDENTS, alerts: IELTS_ALERTS, auditLogs: [], notes: [], presence: [], violationRules: [], degradedLiveMode: false });
    }
    return null;
  }),
  matching(/^\/api\/v1\/proctor\/sessions\/([^/]+)\/presence$/, () => envelope({ ok: true }), "POST"),
  matching(/^\/api\/v1\/proctor\/sessions\/([^/]+)\/device-transfers$/, () => envelope({ items: [] })),
  matching(/^\/api\/v1\/proctor\/sessions\/([^/]+)\/route-queue$/, () => envelope({ enabled: false, items: [] })),
  matching(/^\/api\/v1\/proctor\/sessions\/([^/]+)\/entry-info$/, () => envelope({
    link: { id: "sat-link-1", name: "Morning room", versionNumber: 3, publishScope: "full", enabledSections: null, audienceType: "cohort", audienceLabel: "Morning room", accessMode: "student_code", availabilityType: "anytime", status: "live", selectedStudentCount: 0 },
    roster: [],
  })),
  matching(/^\/api\/v1\/assessment-authoring\/exams\/([^/]+)\/shell$/, () => JSON.stringify({ state: "READY", shell: SAT_SHELL })),
  matching(/^\/api\/v1\/assessment-authoring\/exams\/([^/]+)\/forms$/, () => JSON.stringify(SAT_FORMS_DOCUMENT)),
  matching(/^\/api\/v1\/assessment-authoring\/exams\/([^/]+)\/sat-score-converter$/, () => envelope({ converter: null })),
  matching(/^\/api\/v1\/assessment-authoring\/exams\/([^/]+)\/sat-classroom-plan$/, () => null),
  matching(/^\/api\/v1\/assessment-authoring\/exams\/([^/]+)\/sat-workbook-undo$/, () => null),
  matching(/^\/api\/v1\/assessment-authoring\/exam-questions\/([^/]+)$/, () => JSON.stringify(SAT_QUESTION_DETAIL)),
  // The parity suite runs without the realtime service: exercise the typed
  // unavailable path, as the authoring lifecycle suite does.
  async (route, url) => {
    if (!/^\/api\/v1\/assessment-authoring\/exam-questions\/[^/]+\/coedit-token$/.test(url.pathname)) return false;
    await json(route, JSON.stringify({ code: "COEDIT_UNAVAILABLE", message: "Co-editing is unavailable." }), 503);
    return true;
  },
  matching(/^\/api\/v1\/proctor\/sessions\/([^/]+)\/forms\/state$/, () => envelope({ forms: [] })),
  exact("/api/v1/sat-score-conversion/settings", () => envelope({ active: null, drafts: [], blueprint: { "reading-writing": { m1Operational: 25, m2Operational: 25 }, math: { m1Operational: 20, m2Operational: 20 } } })),
  exact("/api/v1/results/sat/access-groups", () => envelope([SAT_ACCESS_GROUP])),
  matching(/^\/api\/v1\/results\/sat\/attempts$/, () => envelope(SAT_ATTEMPT_PAGE)),
  exact("/api/v1/assessment-forms/responses", () => envelope({ items: [], total: 0, offset: 0, limit: 50, hasMore: false })),
  matching(/^\/api\/v1\/assessment-release\/exams\/([^/]+)$/, ([, id]) => envelope({
    examId: id,
    providerKey: "sat",
    state: "published_current",
    currentPublishedVersion: { id: "sat-version-3", versionNumber: 3, revision: 11, publishNotes: null, publishScope: "full", createdAt: NOW, publishedAt: NOW },
    workingDraft: null,
    summary: { candidateDurationSeconds: 8040, authoredQuestionCount: 98, deliveredQuestionCount: 98 },
    access: { totalLinks: 1, liveLinks: 1, upcomingLinks: 0, linksOnCurrentRelease: 1, liveLinksOnPreviousReleases: 0 },
  })),
  matching(/^\/api\/v1\/assessment-access\/exams\/([^/]+)\/overview$/, () => JSON.stringify({
    currentPublishedVersion: { id: "sat-version-3", versionNumber: 3, revision: 11, publishNotes: null, publishScope: "full", createdAt: NOW },
    links: [],
  })),
];

/** Install the parity transport for one authenticated staff role. */
export async function installStaffParityTransport(page: Page, role: StaffRole = "admin"): Promise<ParityTransport> {
  const transport: ParityTransport = { unhandled: [], requests: [] };

  // The live feed is exercised by its own suites; close it cleanly so these
  // references never depend on a socket server.
  await page.routeWebSocket(/\/api\/v1\/ws\//, (socket) => {
    void socket.close({ code: 1000, reason: "staff parity uses REST fixtures" });
  });

  await page.route(
    (url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/v2/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const label = `${method} ${url.pathname}${url.search}`;
      transport.requests.push(label);
      if (url.pathname === "/api/v1/auth/session") {
        await json(route, envelope({
          user: { id: `${role}-1`, email: `${role}@example.test`, displayName: "Dana Admin", role, state: "active" },
          csrfToken: "csrf-parity",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }));
        return;
      }
      for (const handler of HANDLERS) {
        if (await handler(route, url, method)) return;
      }
      transport.unhandled.push(label);
      await json(route, envelope({}));
    },
  );

  return transport;
}

/** Proctor room detail payloads scaled to `size` students, for the staff perf suite. */
export function scaledProctorRoom(provider: "ielts" | "sat", size: number): string {
  const sessions = Array.from({ length: size }, (_, index) => {
    const number = index + 1;
    if (provider === "sat") {
      return { ...SAT_STUDENT, attemptId: `sat-attempt-${number}`, studentId: `sat-student-${number}`, studentName: `Student ${number}`, studentEmail: `sat${number}@example.test` };
    }
    return ieltsStudent(number, `Student ${number}`, index % 7 === 0 ? "warned" : "active");
  });
  return provider === "sat"
    ? envelope({ schedule: SAT_SCHEDULE, runtime: SAT_RUNTIME, sessions, alerts: [], auditLogs: [], notes: [], presence: [], violationRules: [], degradedLiveMode: false })
    : envelope({ schedule: IELTS_SCHEDULE, runtime: IELTS_RUNTIME, sessions, alerts: IELTS_ALERTS, auditLogs: [], notes: [], presence: [], violationRules: [], degradedLiveMode: false });
}
