// Local preview only (not part of the product): opens a visible Chromium on the
// real Vite app and answers /api/v1 with fixture data so the SAT staff screens
// can be clicked through without the Go backend.
import { chromium } from "@playwright/test";

const EXAM_ID = "dev-exam-1";
const para = (id, text) => ({ version: 1, nodes: [{ type: "paragraph", id, text }] });
const empty = () => ({ version: 1, nodes: [] });
const incomplete = (n) => n === 3;

const summary = (n) => ({
  examQuestionId: `eq-${n}`, questionId: `q-${n}`, questionRevisionId: `rev-${n}`, displayOrder: n, isPretest: false,
  questionType: "single_choice", semanticRevision: 1, revision: 1,
  promptPreview: `Question ${n}: which choice best states the main idea of the passage?`,
  answerKeyPreview: incomplete(n) ? null : "B", domain: incomplete(n) ? null : "craft-and-structure", skill: incomplete(n) ? null : "Words in Context",
  difficulty: "medium", tags: [], hasStimulus: false, contentComplexity: "plain",
  readiness: { status: incomplete(n) ? "incomplete" : "ready", blockingIssueCount: incomplete(n) ? 3 : 0, warningCount: 0 },
});
const mod = (id, key, title, role, qs) => ({ id, moduleKey: key, title, displayOrder: 1, durationSeconds: 1920, targetQuestionCount: 27, adaptiveRole: role, toolPolicy: {}, revision: 1, questions: qs });
const SHELL = {
  examId: EXAM_ID, providerKey: "sat", versionId: "draft-1", versionRevision: 1,
  sections: [{
    id: "sec-1", sectionKey: "reading-writing", title: "Reading & Writing", displayOrder: 1, durationSeconds: 3840, breakAfterSeconds: 600, revision: 1,
    routingPolicy: { id: "r1", baseModuleId: "mod-1", lowerModuleId: "mod-2", higherModuleId: "mod-3", policyKey: "practice_threshold", minimumCorrectForHigher: 18, operationalQuestionCount: 25, revision: 1 },
    modules: [
      mod("mod-1", "rw-1", "Module 1", "base", [summary(1), summary(2), summary(3), summary(4)]),
      mod("mod-2", "rw-2l", "Module 2 — Lower", "lower_branch", []),
      mod("mod-3", "rw-2h", "Module 2 — Higher", "higher_branch", []),
    ],
  }],
};
const detail = (n) => ({
  examQuestionId: `eq-${n}`, moduleId: "mod-1", moduleKey: "rw-1", sectionKey: "reading-writing", displayOrder: n, isPretest: false,
  question: {
    id: `rev-${n}`, questionId: `q-${n}`, semanticRevision: 1, revision: 1, state: "draft", questionType: "single_choice",
    stimulus: para(`s${n}`, "The passage argues that coastal wetlands buffer storm surges and filter runoff."),
    prompt: para(`p${n}`, `Which choice best states the main idea of the text? (${n})`),
    answer: { kind: "single_choice", options: ["A", "B", "C", "D"].map((o) => ({ id: o, content: para(`${o}${n}`, `Choice ${o}`) })), correctOptionId: incomplete(n) ? null : "B" },
    rationale: empty(),
    metadata: { sectionKey: "reading-writing", domain: incomplete(n) ? null : "craft-and-structure", skill: incomplete(n) ? null : "Words in Context", difficulty: "medium", tags: [] },
    accessibility: { longDescription: null },
  },
});
const RELEASE = {
  examId: EXAM_ID, providerKey: "sat", state: "unpublished_changes",
  currentPublishedVersion: { id: "pv2", versionNumber: 2, revision: 1, publishNotes: null, publishScope: "full", publishedAt: "2026-09-01T00:00:00.000Z" },
  workingDraft: { id: "draft-1", parentVersionId: "pv2", versionNumber: 3, revision: 1 },
  summary: { candidateDurationSeconds: 8000, authoredQuestionCount: 4, deliveredQuestionCount: 4 },
  access: { totalLinks: 1, liveLinks: 1, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 1 },
};
const READINESS = {
  examId: EXAM_ID, versionId: "draft-1", versionRevision: 1, publishScope: "full", valid: false,
  errors: [{ code: "question.prompt.required", path: "examQuestion:eq-3:prompt", message: "Question 3 needs question text.", blocking: true }],
  warnings: [],
};
const json = (body) => ({ status: 200, contentType: "application/json", headers: { "x-csrf-token": "t" }, body: JSON.stringify(body) });

const browser = await chromium.launch({ headless: false, args: ["--window-size=1360,960"] });
const GROUPS = [
  { scheduleId: "schedule-1", accessLinkId: "link-1", accessLinkName: "Saturday 9 AM cohort", accessLinkState: "active", examId: EXAM_ID, examTitle: "Practice Test 06", versionNumber: 2, cohortName: "Morning", attemptCount: 3, submittedCount: 2, scoredCount: 1, pendingCount: 1, invalidatedCount: 0, latestSubmittedAt: "2026-09-01T08:00:00Z", latestTestStartedAt: "2026-09-01T02:03:00Z", earliestTestStartedAt: "2026-09-01T02:03:00Z", completedCount: 2, runningCount: 1, endedCount: 0, otherCount: 0 },
  { scheduleId: "schedule-2", accessLinkId: "link-2", accessLinkName: "Makeup session", accessLinkState: "paused", examId: EXAM_ID, examTitle: "Practice Test 06", versionNumber: 1, cohortName: "Makeup", attemptCount: 1, submittedCount: 1, scoredCount: 0, pendingCount: 0, invalidatedCount: 1, latestSubmittedAt: "2026-08-29T08:00:00Z", latestTestStartedAt: "2026-08-29T02:00:00Z", earliestTestStartedAt: "2026-08-29T02:00:00Z", completedCount: 0, runningCount: 0, endedCount: 1, otherCount: 0 },
];
const attempt = (n, over) => ({ resultId: null, attemptId: `attempt-${n}`, outcomeStatus: "unscored", releaseStatus: "", totalScore: null, scheduleId: "schedule-1", examId: EXAM_ID, examTitle: "Practice Test 06", versionNumber: 2, studentId: `S${n}`, studentName: ["", "John Smith", "Maya Patel", "Liam Chen"][n], studentEmail: null, cohortName: "Morning", submittedAt: "2026-09-01T08:00:00Z", testStartedAt: "2026-09-01T02:03:00Z", ...over });
const ATTEMPTS = { items: [attempt(1, { resultId: "result-1", outcomeStatus: "scored", totalScore: 1380 }), attempt(2, { outcomeStatus: "pending" }), attempt(3, { attemptStatus: "running", submittedAt: null })], total: 3, offset: 0, limit: 50, hasMore: false };
const RESULT = { summary: { id: "result-1", attemptId: "attempt-1", outcomeStatus: "scored", releaseStatus: "ready_to_release", totalScore: 1380, scheduleId: "schedule-1", examId: EXAM_ID, examTitle: "Practice Test 06", versionNumber: 2, studentId: "S1", studentName: "John Smith", studentEmail: null, cohortName: "Morning", submittedAt: "2026-09-01T08:00:00Z" }, testStartedAt: "2026-09-01T02:03:00Z", scorePayload: {}, sections: [{ sectionKey: "reading-writing", rawCorrect: 21, operationalQuestionCount: 27, route: "higher", modules: [] }], questions: [] };
const ANSWERS = { attemptId: "attempt-3", examTitle: "Practice Test 06", versionNumber: 2, studentId: "S3", studentName: "Liam Chen", cohortName: "Morning", status: "running", protocolVersion: 2, responseRevision: 4, savedAnswerCount: 2, lastSavedAt: "2026-09-01T08:05:00Z", testStartedAt: "2026-09-01T02:03:00Z", submittedAt: null, questions: [{ questionId: "q1", sectionKey: "reading-writing", moduleKey: "module-1", displayOrder: 1, response: "B", markedForReview: false }, { questionId: "q2", sectionKey: "reading-writing", moduleKey: "module-1", displayOrder: 2, response: null, markedForReview: true }] };
const context = await browser.newContext({ viewport: { width: 1320, height: 860 } });
const page = await context.newPage();
await page.route("**/api/v1/**", (route) => route.fulfill(json({})));
await page.route("**/api/v1/auth/session", (route) => route.fulfill(json({ success: true, data: { user: { id: "u1", email: "admin@example.com", displayName: "Alex Admin", role: "admin", state: "active" }, csrfToken: "t", expiresAt: "2099-01-01T00:00:00.000Z" } })));
await page.route(`**/api/v1/assessment-authoring/exams/${EXAM_ID}/shell`, (route) => route.fulfill(json({ state: "READY", shell: SHELL })));
await page.route("**/api/v1/assessment-authoring/exam-questions/eq-*", (route) => {
  const n = Number(route.request().url().match(/eq-(\d+)/)?.[1] ?? 1);
  return route.fulfill(json(detail(n)));
});
await page.route(`**/api/v1/exams/${EXAM_ID}`, (route) => route.fulfill(json({ id: EXAM_ID, slug: "s", title: "Practice Test 06", providerKey: "sat", providerExamType: "sat", examType: "Academic", status: "draft", visibility: "organization", ownerId: "u1", createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z", currentDraftVersionId: "draft-1", currentPublishedVersionId: "pv2", canEdit: true, canPublish: true, canDelete: true, revision: 7 })));
await page.route(`**/api/v1/assessment-release/exams/${EXAM_ID}`, (route) => route.fulfill(json(RELEASE)));
await page.route("**/api/v1/results/sat/access-groups", (route) => route.fulfill(json(GROUPS)));
await page.route(/\/api\/v1\/results\/sat\/attempts\?/, (route) => route.fulfill(json(ATTEMPTS)));
await page.route("**/api/v1/results/sat/result-1", (route) => route.fulfill(json(RESULT)));
await page.route("**/api/v1/results/sat/attempts/*/answers", (route) => route.fulfill(json({ ...ANSWERS })));
await page.route(`**/api/v1/assessment-release/exams/${EXAM_ID}/readiness**`, (route) => route.fulfill(json(READINESS)));
await page.route(`**/api/v1/assessment-access/exams/${EXAM_ID}/overview`, (route) => route.fulfill(json({ currentPublishedVersion: { id: "pv2", versionNumber: 2, revision: 1, publishScope: "full", publishedAt: "2026-09-01T00:00:00.000Z", publishNotes: null, createdAt: "2026-09-01T00:00:00.000Z" }, links: [] })));

await page.goto("http://localhost:3000/__dev/sat-authoring");
console.log("Preview open. Pages: /__dev/sat-authoring (Questions), /sat/exams/dev-exam-1/settings, /release, /access");
await new Promise(() => {});
