import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoSeriousAxeViolations } from "./support/axeAudit";
import type { CreateAssessmentAccessLinkRequest } from "../src/features/exam-authoring/contracts/accessLinks";

/**
 * The authoring shell lifecycle, proven in a browser.
 *
 * WHAT THIS LOCKS (plan Phase 4 / 14 / 15)
 * ----------------------------------------
 * The bug that started this work: a pre-draft exam answered 404, React Query
 * cached it as an error, the console printed an ApiClientError stack, and the UI
 * guessed that every 404 meant "No editable draft". The fix is only real if a
 * browser shows all three of these at once:
 *
 *   1. `GET .../shell` answers 200 `{state: "NO_DRAFT", shell: null}`
 *   2. zero POSTs happen on load, on remount, and on refresh
 *   3. the console is CLEAN — no error, no QueryCache warning, no React stack
 *
 * …and then that clicking "Open draft" is the ONE thing that issues a POST, and
 * that afterwards a refresh still issues GET only.
 *
 * The transport is answered by this spec rather than by a stub module, so the
 * app under test is the shipped one: the real route, the real lifecycle mapping,
 * the real cache effects, the real surface copy.
 */

const EXAM_ID = "dev-exam-1";
const SHELL_PATH = `**/api/v1/assessment-authoring/exams/${EXAM_ID}/shell`;

const STAFF_SESSION = {
  success: true,
  data: {
    user: {
      id: "user-builder-1",
      email: "builder@example.com",
      displayName: "Dana Builder",
      role: "builder",
      state: "active",
    },
    csrfToken: "csrf-e2e-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

const NO_DRAFT = { state: "NO_DRAFT", shell: null };
const EXAM_METADATA = {
  id: EXAM_ID,
  slug: EXAM_ID,
  title: "Digital SAT",
  providerKey: "sat",
  examType: "Academic",
  status: "draft",
  visibility: "organization",
  ownerId: "user-builder-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  currentDraftVersionId: null,
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 4,
  revision: 1,
};
const RELEASE_METADATA = {
  examId: EXAM_ID,
  providerKey: "sat",
  state: "never_published",
  currentPublishedVersion: null,
  workingDraft: null,
  summary: { candidateDurationSeconds: 0, authoredQuestionCount: 0, deliveredQuestionCount: 0 },
  access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
};

const READY_SHELL = {
  examId: EXAM_ID,
  providerKey: "sat",
  versionId: "draft-1",
  versionRevision: 1,
  sections: [
    {
      id: "sec-1",
      sectionKey: "rw",
      title: "Reading & Writing",
      displayOrder: 1,
      durationSeconds: 1920,
      breakAfterSeconds: 600,
      revision: 1,
      routingPolicy: null,
      modules: [
        {
          id: "mod-1",
          moduleKey: "rw-1",
          title: "Module 1",
          displayOrder: 1,
          durationSeconds: 1920,
          targetQuestionCount: 27,
          adaptiveRole: "none",
          toolPolicy: {},
          revision: 1,
          questions: [
            {
              examQuestionId: "eq-1",
              questionId: "q-1",
              questionRevisionId: "rev-1",
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
            },
          ],
        },
      ],
    },
  ],
};

const QUESTION_DETAIL = {
  examQuestionId: "eq-1",
  moduleId: "mod-1",
  moduleKey: "rw-1",
  sectionKey: "rw",
  displayOrder: 1,
  question: {
    id: "rev-1",
    questionId: "q-1",
    semanticRevision: 1,
    revision: 1,
    state: "draft",
    questionType: "single_choice",
    stimulus: { version: 1, nodes: [] },
    prompt: {
      version: 1,
      nodes: [{ type: "paragraph", id: "prompt-1", text: "Which choice best states the main idea of the text?" }],
    },
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

interface Recording {
  getShell: number;
  postShell: number;
  getQuestion: number;
  readinessScopes: string[];
  publishRequests: Array<{
    publishScope?: string;
    operationKey?: string;
    expectedDraftVersionId?: string;
    expectedDraftRevision?: number;
    revision?: number;
  }>;
  createRequests: CreateAssessmentAccessLinkRequest[];
  overviewReads: number;
  /** Requests the app made that this suite does not model, for diagnosis. */
  other: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

/**
 * Answer the transport and record what the app actually did.
 *
 * Only the shell read/open is behaviourally modelled: everything else under the
 * authoring API answers a benign empty object, so an unexpected call shows up as
 * a console error (which this suite fails on) rather than as a silent hole.
 */
async function installTransport(
  page: Page,
  options: {
    missingExam?: boolean;
    readyDraft?: boolean;
    releaseWorkflow?: boolean;
    readyFullDraft?: boolean;
    canEdit?: boolean;
    canPublish?: boolean;
    initiallyPublished?: boolean;
    concurrentPublish?: boolean;
    concurrentPublishScope?: string;
    failPublishOnce?: boolean;
    createOutcome?: "success" | "commit-then-timeout" | "not-committed-once";
  } = {}
): Promise<Recording> {
  const recording: Recording = {
    getShell: 0,
    postShell: 0,
    getQuestion: 0,
    readinessScopes: [],
    publishRequests: [],
    createRequests: [],
    overviewReads: 0,
    other: [],
    consoleErrors: [],
    pageErrors: [],
  };
  let draftOpened = options.readyDraft ?? false;
  let publishedVersion: {
    id: string;
    versionNumber: number;
    publishScope: string;
    publishedAt: string;
  } | null = options.initiallyPublished ? {
    id: "published-v1",
    versionNumber: 1,
    publishScope: "full",
    publishedAt: "2026-10-10T04:00:00.000Z",
  } : null;
  let createdLink: Record<string, unknown> | null = null;
  let publishFailureSpent = false;
  let concurrentPublishSpent = false;
  let createFailureSpent = false;

  page.on("console", (message) => {
    if (message.type() === "error") {
      // Chromium reports the intentionally mocked co-edit 503 as a generic
      // resource error with no request URL; application errors stay fatal.
      if (message.text() === "Failed to load resource: the server responded with a status of 503 (Service Unavailable)") {
        return;
      }
      recording.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    recording.pageErrors.push(error.message);
  });

  // Registered FIRST on purpose: Playwright matches routes in reverse
  // registration order, so the narrower handlers declared below win over this
  // catch-all. Declaring it first is what keeps "everything else" from
  // shadowing the shell read it is supposed to sit behind.
  await page.route("**/api/v1/assessment-authoring/**", async (route) => {
    recording.other.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({}),
    });
  });

  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify(STAFF_SESSION),
    })
  );

  // The real route also reads header metadata outside the authoring transport.
  // Keep the browser harness self-contained after those shared-header queries
  // were added to SatAuthoringRoute.
  await page.route(`**/api/v1/exams/${EXAM_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify(publishedVersion
        ? {
            ...EXAM_METADATA,
            ...(options.canEdit === undefined ? {} : { canEdit: options.canEdit }),
            ...(options.canPublish === undefined ? {} : { canPublish: options.canPublish }),
            status: "published",
            currentDraftVersionId: draftOpened ? READY_SHELL.versionId : null,
            currentPublishedVersionId: publishedVersion.id,
          }
        : {
            ...EXAM_METADATA,
            ...(options.canEdit === undefined ? {} : { canEdit: options.canEdit }),
            ...(options.canPublish === undefined ? {} : { canPublish: options.canPublish }),
            currentDraftVersionId: draftOpened ? READY_SHELL.versionId : null,
          }),
    })
  );
  await page.route(`**/api/v1/assessment-release/exams/${EXAM_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify(publishedVersion
        ? {
            ...RELEASE_METADATA,
            state: draftOpened ? "unpublished_changes" : "published_current",
            currentPublishedVersion: {
              id: publishedVersion.id,
              versionNumber: publishedVersion.versionNumber,
              revision: publishedVersion.versionNumber,
              publishNotes: null,
              publishScope: publishedVersion.publishScope,
              publishedAt: publishedVersion.publishedAt,
            },
            workingDraft: draftOpened ? {
              id: READY_SHELL.versionId,
              parentVersionId: publishedVersion.id,
              versionNumber: publishedVersion.versionNumber + 1,
              revision: READY_SHELL.versionRevision,
            } : null,
          }
        : {
            ...RELEASE_METADATA,
            workingDraft: draftOpened ? {
              id: READY_SHELL.versionId,
              parentVersionId: null,
              versionNumber: 1,
              revision: READY_SHELL.versionRevision,
            } : null,
          }),
    })
  );

  await page.route(SHELL_PATH, async (route) => {
    if (route.request().method() === "POST") {
      recording.postShell += 1;
      draftOpened = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-e2e-token" },
        body: JSON.stringify(READY_SHELL),
      });
      return;
    }
    recording.getShell += 1;
    if (options.missingExam) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ code: "EXAM_NOT_FOUND", message: "Exam not found." }),
      });
      return;
    }
    // Once a draft exists, the READ is what must see it — refresh never creates
    // one, so the read answers from the (stubbed) durable state.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify(draftOpened ? { state: "READY", shell: READY_SHELL } : NO_DRAFT),
    });
  });

  // The standalone authoring E2E runs without the realtime service. Exercise
  // the product's typed unavailable path so the HTTP-backed prompt editor can
  // still render and stay usable while co-editing is offline.
  await page.route("**/api/v1/assessment-authoring/exam-questions/eq-1/coedit-token", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "COEDIT_UNAVAILABLE", message: "Co-editing is unavailable." }),
    });
  });

  await page.route("**/api/v1/assessment-authoring/exam-questions/eq-1", async (route) => {
    recording.getQuestion += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify(QUESTION_DETAIL),
    });
  });

  if (options.releaseWorkflow) {
    await page.route(`**/api/v1/assessment-authoring/exams/${EXAM_ID}/validate`, async (route) => {
      const request = route.request().postDataJSON() as { publishScope?: string };
      const publishScope = request.publishScope ?? "full";
      recording.readinessScopes.push(publishScope);
      const blocked = publishScope === "full" && !options.readyFullDraft;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-e2e-token" },
        body: JSON.stringify({
          examId: EXAM_ID,
          versionId: "draft-1",
          versionRevision: 1,
          publishScope,
          valid: !blocked,
          errors: blocked
            ? [{
                code: "sat.module.incomplete",
                path: "section:math",
                message: "Add the required Math module before publishing the full SAT.",
                blocking: true,
                field: "structure",
              }]
            : [],
          warnings: [],
        }),
      });
    });

    await page.route(`**/api/v1/exams/${EXAM_ID}/publish`, async (route) => {
      const request = route.request().postDataJSON() as { publishScope?: string; operationKey?: string };
      recording.publishRequests.push(request);
      if (options.concurrentPublish && !concurrentPublishSpent) {
        concurrentPublishSpent = true;
        publishedVersion = {
          id: READY_SHELL.versionId,
          versionNumber: (publishedVersion?.versionNumber ?? 0) + 1,
          publishScope: options.concurrentPublishScope ?? request.publishScope ?? "full",
          publishedAt: "2026-10-11T04:00:00.000Z",
        };
        draftOpened = false;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          headers: { "x-csrf-token": "csrf-e2e-token" },
          body: JSON.stringify({ code: "VERSION_ALREADY_PUBLISHED", message: "Another staff member published this version." }),
        });
        return;
      }
      if (options.failPublishOnce && !publishFailureSpent) {
        publishFailureSpent = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          headers: { "x-csrf-token": "csrf-e2e-token" },
          body: JSON.stringify({ code: "PUBLISH_UNAVAILABLE", message: "Publishing failed." }),
        });
        return;
      }
      publishedVersion = {
        id: READY_SHELL.versionId,
        versionNumber: (publishedVersion?.versionNumber ?? 0) + 1,
        publishScope: request.publishScope ?? "full",
        publishedAt: "2026-10-11T04:00:00.000Z",
      };
      draftOpened = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-e2e-token" },
        body: JSON.stringify({
          id: publishedVersion.id,
          examId: EXAM_ID,
          versionNumber: publishedVersion.versionNumber,
          revision: 1,
          isDraft: false,
          isPublished: true,
          publishScope: publishedVersion.publishScope,
          createdAt: publishedVersion.publishedAt,
          publishedAt: publishedVersion.publishedAt,
        }),
      });
    });

    await page.route(`**/api/v1/assessment-access/exams/${EXAM_ID}/overview`, (route) => {
      recording.overviewReads += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-e2e-token" },
        body: JSON.stringify({
          examId: EXAM_ID,
          currentPublishedVersion: publishedVersion ? {
            id: publishedVersion.id,
            versionNumber: publishedVersion.versionNumber,
            revision: publishedVersion.versionNumber,
            publishNotes: null,
            publishScope: publishedVersion.publishScope,
            createdAt: publishedVersion.publishedAt,
          } : null,
          links: createdLink ? [createdLink] : [],
          total: createdLink ? 1 : 0,
        }),
      });
    });

    await page.route(`**/api/v1/assessment-access/exams/${EXAM_ID}/links`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "x-csrf-token": "csrf-e2e-token" },
          body: JSON.stringify([]),
        });
        return;
      }
      const request = route.request().postDataJSON() as CreateAssessmentAccessLinkRequest;
      recording.createRequests.push(request);
      const effectivePublishedVersion = publishedVersion;
      if (!effectivePublishedVersion) throw new Error("The room request arrived before a published version existed.");
      const now = new Date().toISOString();
      const responseLink = {
        id: "access-link-1",
        examId: EXAM_ID,
        examTitle: "Digital SAT",
        providerKey: "sat",
        publishedVersionId: effectivePublishedVersion.id,
        versionNumber: effectivePublishedVersion.versionNumber,
        publishScope: effectivePublishedVersion.publishScope,
        scheduleId: "schedule-1",
        name: request.name,
        enabledSections: request.enabledSections?.length ? request.enabledSections : null,
        audienceType: request.audienceType,
        audienceLabel: request.audienceLabel ?? null,
        accessMode: request.accessMode,
        availabilityType: request.availabilityType,
        opensAt: request.opensAt ?? null,
        closesAt: request.closesAt ?? null,
        lifecycleState: "active",
        status: "live",
        selectedStudentCount: request.selectedStudents.length,
        metrics: { registered: 0, started: 0, submitted: 0 },
        isCurrentRelease: true,
        hasParticipation: false,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      if (options.createOutcome === "commit-then-timeout") {
        createdLink = responseLink;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          headers: { "x-csrf-token": "csrf-e2e-token" },
          body: JSON.stringify({ code: "NETWORK_UNCERTAIN", message: "The connection was interrupted." }),
        });
        return;
      }
      if (options.createOutcome === "not-committed-once" && !createFailureSpent) {
        createFailureSpent = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          headers: { "x-csrf-token": "csrf-e2e-token" },
          body: JSON.stringify({ code: "CREATE_UNAVAILABLE", message: "The room was not created." }),
        });
        return;
      }
      createdLink = responseLink;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-e2e-token" },
        body: JSON.stringify(responseLink),
      });
    });
  }

  return recording;
}

test.describe("SAT authoring shell lifecycle", () => {
  test("a pre-draft exam loads as NO_DRAFT with zero POSTs and a clean console", async ({
    page,
  }) => {
    const recording = await installTransport(page);

    await page.goto("/__dev/sat-authoring");

    await expect(page.getByRole("heading", { name: "No editable draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open draft" })).toBeVisible();
    await expectNoSeriousAxeViolations(page, "SAT authoring pre-draft state");

    // The read happened, and reading is all that happened: the CTA is the only
    // thing in the product allowed to open a draft.
    expect(recording.getShell).toBeGreaterThanOrEqual(1);
    expect(recording.postShell).toBe(0);

    // The original bug's most visible symptom.
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("opening the draft is explicit: exactly one POST, then the workspace renders", async ({
    page,
  }) => {
    const recording = await installTransport(page);

    await page.goto("/__dev/sat-authoring");
    await expect(page.getByRole("heading", { name: "No editable draft" })).toBeVisible();

    await page.getByRole("button", { name: "Open draft" }).click();

    // Prove the shell and the selected question detail both reached the editor.
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();
    await expect(page.getByLabel("Question prompt")).toBeVisible();
    await expect(page.getByText("Which choice best states the main idea of the text?", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Question could not be loaded" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No editable draft" })).toHaveCount(0);
    await expectNoSeriousAxeViolations(page, "SAT authoring workspace");
    expect(recording.postShell).toBe(1);
    expect(recording.getQuestion).toBeGreaterThanOrEqual(1);
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("refreshing after a draft exists re-reads it and never opens another", async ({ page }) => {
    const recording = await installTransport(page);

    await page.goto("/__dev/sat-authoring");
    await page.getByRole("button", { name: "Open draft" }).click();
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();
    await expect(page.getByLabel("Question prompt")).toBeVisible();
    expect(recording.postShell).toBe(1);

    const readsBeforeReload = recording.getShell;
    await page.reload();

    // The refresh is a READ of the same draft: no new POST, and no "Open draft"
    // CTA in place of a draft that already exists.
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();
    await expect(page.getByLabel("Question prompt")).toBeVisible();
    expect(recording.postShell).toBe(1);
    expect(recording.getShell).toBeGreaterThan(readsBeforeReload);
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("a missing exam renders as not-found and offers no Open draft CTA", async ({ page }) => {
    const recording = await installTransport(page, { missingExam: true });

    await page.goto("/__dev/sat-authoring");

    await expect(page.getByText("Exam not found", { exact: false })).toBeVisible();
    await expectNoSeriousAxeViolations(page, "SAT authoring not-found state");
    // Offering the CTA for an exam that does not exist would invite the author
    // to retry a command that cannot succeed.
    await expect(page.getByRole("button", { name: "Open draft" })).toHaveCount(0);
    expect(recording.postShell).toBe(0);
  });

  test("release review blocks an incomplete full SAT, then confirms the selected version scope", async ({ page }) => {
    const recording = await installTransport(page, { readyDraft: true, releaseWorkflow: true });

    await page.goto(`/sat/exams/${EXAM_ID}/release`);

    await expect(page.getByRole("heading", { name: "Release checks" })).toBeVisible();
    expect(recording.readinessScopes).toEqual(["full"]);
    await expect(page.getByText("Add the required Math module before publishing the full SAT.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish version" })).toBeDisabled();
    await expectNoSeriousAxeViolations(page, "SAT release review with a blocking issue");

    await page.getByRole("radio", { name: "Reading & Writing" }).check();
    await expect(page.getByText("Ready to publish.")).toBeVisible();
    const publishButton = page.getByRole("button", { name: "Publish version" });
    await expect(publishButton).toBeEnabled();
    // Let the 180ms workspace transition finish before inspecting text contrast.
    await expect(publishButton).toHaveCSS("color", "rgb(255, 255, 255)");
    await expectNoSeriousAxeViolations(page, "SAT release review ready for selected scope");

    await page.getByRole("button", { name: "Publish version" }).click();
    const confirmationDialog = page.getByRole("dialog", { name: "Publish Reading & Writing only?" });
    await expect(confirmationDialog).toBeVisible();
    await expect(confirmationDialog).toHaveCSS("opacity", "1");
    await expect(page.getByText("Release checks passed")).toBeVisible();
    await expect(page.getByText("Not included")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish Reading & Writing", exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
    await expectNoSeriousAxeViolations(page, "SAT publish version confirmation");

    await page.getByRole("button", { name: "Publish Reading & Writing", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/sat/exams/${EXAM_ID}/access`));
    expect(recording.readinessScopes.slice(0, 2)).toEqual(["full", "reading-writing"]);
    expect(recording.readinessScopes.every((scope) => ["full", "reading-writing"].includes(scope))).toBe(true);
    expect(recording.publishRequests).toHaveLength(1);
    expect(recording.publishRequests[0]).toMatchObject({
      expectedDraftVersionId: "draft-1",
      expectedDraftRevision: 1,
      publishScope: "reading-writing",
      revision: 1,
    });
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("publish success survives shell removal, Done, reload, and keeps the exact room target", async ({ page }) => {
    const recording = await installTransport(page, { readyDraft: true, releaseWorkflow: true });
    await page.goto(`/sat/exams/${EXAM_ID}`);

    await page.getByRole("button", { name: "Publish version" }).click();
    await expect(page.getByRole("dialog", { name: "Publish version" })).toBeVisible();
    await page.getByRole("radio", { name: "Reading & Writing" }).check();
    await expect(page.getByRole("button", { name: "Publish Reading & Writing" })).toBeEnabled();
    await page.getByRole("button", { name: "Publish Reading & Writing" }).click();

    await expect(page.getByText("Version 1 published. Create a room to give students access.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No editable draft" })).toHaveCount(0);
    await expectNoSeriousAxeViolations(page, "SAT publish success sheet after draft sealing");
    expect(recording.publishRequests).toHaveLength(1);
    expect(recording.postShell).toBe(0);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Version 1 is published.")).toBeVisible();
    const createRoom = page.getByRole("button", { name: "Create room" });
    await expect(createRoom).toBeFocused();

    // A reload drops the in-memory receipt. The published release read must
    // still render the usable view without converting a read into a draft POST.
    await page.reload();
    await expect(page.getByText("Version 1 is published.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit exam" })).toBeVisible();
    expect(recording.postShell).toBe(0);
    await expectNoSeriousAxeViolations(page, "SAT published workspace after reload");

    await page.getByRole("button", { name: "Create room" }).click();
    const room = page.getByRole("dialog", { name: "Create room" });
    await expect(room).toBeVisible();
    await expect(room).toContainText("Room uses Version 1");
    await room.getByLabel("Room name").fill("Published receipt room");
    await room.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/sat/exams/${EXAM_ID}/access\\?link=access-link-1`), { timeout: 30_000 });
    expect(recording.publishRequests).toHaveLength(1);
    expect(recording.createRequests).toHaveLength(1);
    expect(recording.createRequests[0]?.publishedVersionId).toBe("draft-1");
    expect(recording.postShell).toBe(0);
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });
});

async function openCreateRoom(page: Page) {
  await page.goto(`/sat/exams/${EXAM_ID}`);
  const createRoom = page.getByRole("button", { name: "Create room", exact: true }).first();
  await expect(createRoom).toBeVisible({ timeout: 30_000 });
  await createRoom.click();
  const room = page.getByRole("dialog", { name: "Create room" });
  await expect(room).toBeVisible({ timeout: 30_000 });
  return room;
}

async function finishRoomCreation(page: Page, room: Locator, actionName: string) {
  await room.getByLabel("Room name").fill("Saturday morning mock");
  await room.getByRole("button", { name: actionName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sat/exams/${EXAM_ID}/access\\?link=access-link-1`), { timeout: 30_000 });
}

test.describe("SAT Create room handoff", () => {
  test("publishes a ready draft and creates the room from one sheet", async ({ page }) => {
    const recording = await installTransport(page, {
      readyDraft: true,
      releaseWorkflow: true,
      readyFullDraft: true,
    });
    const room = await openCreateRoom(page);
    const fullSat = room.getByRole("radio", { name: "Full SAT" });
    await expect(fullSat).not.toBeChecked();
    await fullSat.check();
    const action = room.getByRole("button", { name: "Publish & create room", exact: true });
    await expect(action).toBeEnabled({ timeout: 30_000 });
    await finishRoomCreation(page, room, "Publish & create room");

    expect(recording.postShell).toBe(0);
    expect(recording.publishRequests).toHaveLength(1);
    expect(recording.publishRequests[0]?.publishScope).toBe("full");
    expect(recording.createRequests).toHaveLength(1);
    expect(recording.createRequests[0]?.publishedVersionId).toBe("draft-1");
  });

  test("blocks an invalid full SAT and requires confirmation of the prepared section", async ({ page }) => {
    const recording = await installTransport(page, { readyDraft: true, releaseWorkflow: true });
    const room = await openCreateRoom(page);
    await room.getByRole("radio", { name: "Full SAT" }).check();
    await expect(room.getByText("Add the required Math module before publishing the full SAT.")).toBeVisible();
    await expect(room.getByRole("button", { name: "Publish & create room", exact: true })).toBeDisabled();

    const readingWriting = room.getByRole("radio", { name: "Reading & Writing only" });
    await readingWriting.check();
    await expect(readingWriting).toBeChecked();
    await expect(room.getByText("Add the required Math module before publishing the full SAT.")).toHaveCount(0);
    await expect(room.getByRole("button", { name: "Publish & create room", exact: true })).toBeEnabled({ timeout: 30_000 });
    await finishRoomCreation(page, room, "Publish & create room");

    expect(recording.readinessScopes).toContain("full");
    expect(recording.readinessScopes).toContain("reading-writing");
    expect(recording.publishRequests).toHaveLength(1);
    expect(recording.publishRequests[0]?.publishScope).toBe("reading-writing");
    expect(recording.createRequests[0]?.publishedVersionId).toBe("draft-1");
  });

  test("uses unpublished changes instead of the older published version", async ({ page }) => {
    const recording = await installTransport(page, {
      readyDraft: true,
      releaseWorkflow: true,
      readyFullDraft: true,
      initiallyPublished: true,
    });
    const room = await openCreateRoom(page);
    await expect(room).toContainText("Version 2 will be checked and published as a new version.");
    await room.getByRole("radio", { name: "Full SAT" }).check();
    await expect(room.getByRole("button", { name: "Publish & create room", exact: true })).toBeEnabled({ timeout: 30_000 });
    await finishRoomCreation(page, room, "Publish & create room");

    expect(recording.publishRequests).toHaveLength(1);
    expect(recording.createRequests[0]?.publishedVersionId).toBe("draft-1");
    expect(recording.createRequests[0]?.publishedVersionId).not.toBe("published-v1");
  });

  test("creates from the current published version without requiring publish permission", async ({ page }) => {
    const recording = await installTransport(page, {
      releaseWorkflow: true,
      initiallyPublished: true,
      canPublish: false,
    });
    const room = await openCreateRoom(page);
    await expect(room).toContainText("Room uses Version 1");
    await expect(room.getByRole("button", { name: "Create room", exact: true })).toBeEnabled();
    await finishRoomCreation(page, room, "Create room");

    expect(recording.publishRequests).toHaveLength(0);
    expect(recording.createRequests).toHaveLength(1);
    expect(recording.createRequests[0]?.publishedVersionId).toBe("published-v1");
  });

  test("does not offer room creation to a staff member without edit permission", async ({ page }) => {
    await installTransport(page, {
      releaseWorkflow: true,
      initiallyPublished: true,
      canEdit: false,
    });
    await page.goto(`/sat/exams/${EXAM_ID}`);
    await expect(page.getByRole("button", { name: "Create room", exact: true })).toHaveCount(0);
  });

  test("adopts the same exact draft and scope if another staff member publishes during setup", async ({ page }) => {
    const recording = await installTransport(page, {
      readyDraft: true,
      releaseWorkflow: true,
      readyFullDraft: true,
      concurrentPublish: true,
    });
    const room = await openCreateRoom(page);
    await room.getByRole("radio", { name: "Full SAT" }).check();
    await expect(room.getByRole("button", { name: "Publish & create room", exact: true })).toBeEnabled({ timeout: 30_000 });
    await finishRoomCreation(page, room, "Publish & create room");

    expect(recording.publishRequests).toHaveLength(1);
    expect(recording.createRequests).toHaveLength(1);
    expect(recording.createRequests[0]?.publishedVersionId).toBe("draft-1");
  });

  test("does not switch to a different scope published by another staff member", async ({ page }) => {
    const recording = await installTransport(page, {
      readyDraft: true,
      releaseWorkflow: true,
      readyFullDraft: true,
      concurrentPublish: true,
      concurrentPublishScope: "reading-writing",
    });
    const room = await openCreateRoom(page);
    await room.getByRole("radio", { name: "Full SAT" }).check();
    await expect(room.getByRole("button", { name: "Publish & create room", exact: true })).toBeEnabled({ timeout: 30_000 });
    await room.getByLabel("Room name").fill("Saturday morning mock");
    await room.getByRole("button", { name: "Publish & create room", exact: true }).click();

    await expect(room.getByText("This draft was published with a different scope while you were setting up.")).toBeVisible({ timeout: 30_000 });
    await expect(room.getByRole("button", { name: "Publish & create room", exact: true })).toBeDisabled();
    expect(recording.createRequests).toHaveLength(0);
  });

  test("reuses the same publish operation key after a transient publish failure", async ({ page }) => {
    const recording = await installTransport(page, {
      readyDraft: true,
      releaseWorkflow: true,
      readyFullDraft: true,
      failPublishOnce: true,
    });
    const room = await openCreateRoom(page);
    await room.getByRole("radio", { name: "Full SAT" }).check();
    await expect(room.getByRole("button", { name: "Publish & create room", exact: true })).toBeEnabled({ timeout: 30_000 });
    await room.getByLabel("Room name").fill("Saturday morning mock");
    const action = room.getByRole("button", { name: "Publish & create room", exact: true });
    await action.click();
    await expect(room.getByRole("alert").last()).toBeVisible();
    await action.click();
    await expect(page).toHaveURL(new RegExp(`/sat/exams/${EXAM_ID}/access\\?link=access-link-1`), { timeout: 30_000 });

    expect(recording.publishRequests).toHaveLength(2);
    expect(recording.publishRequests[0]?.operationKey).toBeTruthy();
    expect(recording.publishRequests[1]?.operationKey).toBe(recording.publishRequests[0]?.operationKey);
    expect(recording.createRequests).toHaveLength(1);
  });

  test("reconciles a committed room after a lost response without creating a duplicate", async ({ page }) => {
    const recording = await installTransport(page, {
      releaseWorkflow: true,
      initiallyPublished: true,
      createOutcome: "commit-then-timeout",
    });
    const room = await openCreateRoom(page);
    await finishRoomCreation(page, room, "Create room");

    expect(recording.createRequests).toHaveLength(1);
    expect(recording.overviewReads).toBeGreaterThanOrEqual(2);
    expect(recording.publishRequests).toHaveLength(0);
  });

  test("retries room creation only after the first uncertain attempt is confirmed absent", async ({ page }) => {
    const recording = await installTransport(page, {
      readyDraft: true,
      releaseWorkflow: true,
      readyFullDraft: true,
      createOutcome: "not-committed-once",
    });
    const room = await openCreateRoom(page);
    await room.getByRole("radio", { name: "Full SAT" }).check();
    await expect(room.getByRole("button", { name: "Publish & create room", exact: true })).toBeEnabled({ timeout: 30_000 });
    await room.getByLabel("Room name").fill("Saturday morning mock");
    await room.getByRole("button", { name: "Publish & create room", exact: true }).click();
    await expect(room.getByText("No room matching this setup was found. You can retry creation.")).toBeVisible({ timeout: 30_000 });
    await expect(room.getByRole("button", { name: "Create room", exact: true })).toBeEnabled();
    expect(recording.overviewReads).toBeGreaterThanOrEqual(4);
    await room.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/sat/exams/${EXAM_ID}/access\\?link=access-link-1`), { timeout: 30_000 });

    expect(recording.publishRequests).toHaveLength(1);
    expect(recording.createRequests).toHaveLength(2);
  });
});
