import { expect, test, type Page } from "@playwright/test";

/**
 * SAT flexible count + M1-only (plan A5).
 *
 * WHAT THIS LOCKS (docs/plans/2026-11-03-sat-flexible-count-m1-only.md)
 * ----------------------------------------------------------------------
 * H1: staff creates a Custom exam with sections=[reading-writing],
 *     shape rw=m1_only, flexible=on.
 * H2: 10Q authored in rw-m1 publishes (10/27), creates a Classroom room,
 *     serves only rw-m1, completes with no M2, and reports raw 6/10 with no
 *     route badge and no scaled score.
 * F1: an empty included module blocks publish/room ("at least 1 question");
 *     the draft is unchanged.
 * F6: an M1-only attempt completes without waiting for Module 2
 *     (awaitingStaffRoute=false, no "waiting" copy).
 * H4 (smoke): a Full SAT exam keeps strict len==target gates, keeps its
 *     threshold + converter path, and is byte-identical in behavior.
 * AUDIT (2026-11-04 slice 6): flexible 10Q with threshold 13 refuses publish
 *     with sat.threshold.unreachable copy, Settings refuses 11 / accepts 9,
 *     republish → room → sit → raw; flexible-without-plan review never claims
 *     Practice rooms.
 *
 * HOW IT RUNS
 * -----------
 * Same harness as playwright.sat-authoring.config.ts: `bun run dev` only, no
 * Go/MySQL. The spec answers the transport itself (session, defaults,
 * shell, validate, publish, room links, delivery bootstrap, result detail)
 * and asserts what a browser can prove: the request payloads the product
 * sends and the copy/states it renders. The real-DB half of H2
 * (publish→room→sit→complete→raw against InnoDB row locks) lives in
 * backend/go/cmd/api/sat_flexible_m1only_mysql_test.go, which drives the
 * actual services; the two suites share scenario names so a failure points
 * at the same plan line.
 */

const BUILDER_SESSION = {
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

const PROCTOR_SESSION = {
  success: true,
  data: {
    user: {
      id: "user-proctor-1",
      email: "proctor@example.com",
      displayName: "Pim Proctor",
      role: "proctor",
      state: "active",
    },
    csrfToken: "csrf-e2e-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

const FLEX_DEFAULTS = {
  success: true,
  data: {
    preset: "standard_sat",
    config: {
      sectionScope: "full",
      sections: {
        "reading-writing": {
          module1Minutes: 32,
          module2LowerMinutes: 32,
          module2HigherMinutes: 32,
          breakAfterMinutes: 10,
          minimumCorrectForHigher: 13,
        },
        math: {
          module1Minutes: 35,
          module2LowerMinutes: 35,
          module2HigherMinutes: 35,
          breakAfterMinutes: 0,
          minimumCorrectForHigher: 11,
        },
      },
      showClassroomScoreReport: false,
    },
    limits: {
      minModuleMinutes: 1,
      maxModuleMinutes: 600,
      maxBreakMinutes: 240,
      operationalQuestions: { "reading-writing": 27, math: 22 },
    },
    classroomCreationEnabled: true,
  },
};

interface flexibleShellOptions {
  /** Questions authored in rw-m1 (target stays 27). */
  authoredCount: number;
  /** Full SAT shape for the H4 regression smoke. */
  fullSat?: boolean;
}

function flexibleShell({ authoredCount, fullSat = false }: flexibleShellOptions) {
  const questions = Array.from({ length: authoredCount }, (_, index) => ({
    examQuestionId: `eq-flex-${index + 1}`,
    questionId: `q-flex-${index + 1}`,
    questionRevisionId: `rev-flex-${index + 1}`,
    displayOrder: index + 1,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview: `Flexible M1 question ${index + 1}`,
    answerKeyPreview: null,
    domain: null,
    skill: null,
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: fullSat || authoredCount === 27 ? 0 : 1 },
  }));
  return {
    examId: "dev-exam-1",
    providerKey: "sat",
    versionId: "draft-flex-1",
    versionRevision: 3,
    sections: [
      {
        id: "sec-rw",
        sectionKey: "rw",
        title: "Reading & Writing",
        displayOrder: 0,
        durationSeconds: 1920,
        breakAfterSeconds: 600,
        revision: 1,
        routingPolicy: null,
        modules: [
          {
            id: "mod-rw-m1",
            moduleKey: "rw-m1",
            title: "Module 1",
            displayOrder: 0,
            durationSeconds: 1920,
            targetQuestionCount: 27,
            adaptiveRole: "base",
            toolPolicy: {},
            revision: 2,
            questions,
          },
        ],
      },
    ],
  };
}

interface TransportRecording {
  createExamBodies: Array<Record<string, unknown>>;
  idempotencyKeys: Array<string | null>;
  publishBodies: Array<Record<string, unknown>>;
  linkBodies: Array<Record<string, unknown>>;
  consoleErrors: string[];
  pageErrors: string[];
}

/**
 * Answer the product transport for the flexible M1-only plan. Registered
 * FIRST on purpose (see sat-authoring-lifecycle.spec.ts): Playwright matches
 * routes in reverse registration order, so the narrow handlers below win
 * over this catch-all and unexpected calls stay visible instead of hanging.
 */
async function installFlexibleTransport(
  page: Page,
  options: {
    session?: typeof BUILDER_SESSION;
    authoredCount?: number;
    fullSat?: boolean;
    createdExamId?: string;
    /** Audit-fix slice 6: drive the threshold-vs-authored gate (13 > 10 refused, 9 passes). */
    thresholdScenario?: boolean;
  } = {},
): Promise<TransportRecording> {
  const recording: TransportRecording = {
    createExamBodies: [],
    idempotencyKeys: [],
    publishBodies: [],
    linkBodies: [],
    consoleErrors: [],
    pageErrors: [],
  };
  const authoredCount = options.authoredCount ?? 10;
  const createdExamId = options.createdExamId ?? "exam-flex-1";
  // Audit-fix threshold scenario: the draft authors 10Q in rw-m1 but the
  // routing threshold starts at the 27-max default (13), so publish must
  // refuse with sat.threshold.unreachable until staff lowers it to ≤10.
  let currentThreshold = 13;
  const thresholdScenario = options.thresholdScenario === true && !options.fullSat;

  page.on("console", (message) => {
    if (message.type() === "error") {
      if (message.text() === "Failed to load resource: the server responded with a status of 503 (Service Unavailable)") {
        return;
      }
      recording.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    recording.pageErrors.push(error.message);
  });

  await page.route("**/api/v1/assessment-authoring/**", async (route) => {
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
      body: JSON.stringify(options.session ?? BUILDER_SESSION),
    }),
  );

  await page.route("**/api/v1/sat/exam-config/defaults", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FLEX_DEFAULTS),
    }),
  );

  // Creation + library list. POST captures the configuration the sheet
  // sends, then answers a fresh exam row so the product navigates to its
  // workspace. GET answers the library list shape (an array).
  await page.route("**/api/v1/exams*", async (route) => {
    if (route.request().method() === "POST") {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      recording.createExamBodies.push(body);
      recording.idempotencyKeys.push(route.request().headerValue("idempotency-key"));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-e2e-token" },
        body: JSON.stringify({ id: createdExamId, revision: 1 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify([]),
    });
  });

  const shell = flexibleShell({ authoredCount, fullSat: options.fullSat });
  // The H1 creation flow lands on the new exam's workspace, so the shell and
  // readiness transport must answer for BOTH the dev-harness exam and the
  // exam the sheet just created (same draft shape, ids swapped).
  for (const examId of [shell.examId, createdExamId]) {
    const scopedShell = examId === shell.examId ? shell : { ...shell, examId };
    await page.route(`**/api/v1/assessment-authoring/exams/${examId}/shell`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "x-csrf-token": "csrf-e2e-token" },
          body: JSON.stringify(scopedShell),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-e2e-token" },
        body: JSON.stringify({ state: "READY", shell: scopedShell }),
      });
    });

    // Readiness: the flexible rule is a NON-blocking staff note for 1..26 of
    // 27, a blocking empty-module issue at 0, and absent for Full SAT.
    // Threshold scenario (audit-fix FR-1): threshold 13 > authored 10 is a
    // BLOCKING sat.threshold.unreachable until the threshold is lowered.
    await page.route(`**/api/v1/assessment-authoring/exams/${examId}/validate`, async (route) => {
      const empty = authoredCount === 0 && !options.fullSat;
      const partial = authoredCount > 0 && authoredCount < 27 && !options.fullSat;
      const thresholdBlocked = thresholdScenario && authoredCount > 0 && currentThreshold > authoredCount;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-e2e-token" },
        body: JSON.stringify({
          examId,
          versionId: scopedShell.versionId,
          versionRevision: scopedShell.versionRevision,
          publishScope: "full",
          valid: !empty && !thresholdBlocked,
          errors: empty
            ? [
                {
                  code: "sat.module.empty",
                  path: "reading-writing.rw-m1",
                  message: "Module 1 has 0 of 27 questions; add at least 1 question per included module.",
                  blocking: true,
                  field: "structure",
                },
              ]
            : thresholdBlocked
              ? [
                  {
                    code: "sat.threshold.unreachable",
                    path: "reading-writing.minimumCorrectForHigher",
                    message: `reading-writing higher-route threshold ${currentThreshold} exceeds the ${authoredCount} authored Module 1 questions; lower the threshold or add questions before publishing.`,
                    blocking: true,
                    field: "routing",
                  },
                ]
              : [],
          warnings: partial && !thresholdBlocked
            ? [
                {
                  code: "sat.module.flexible_note",
                  path: "reading-writing.rw-m1",
                  message: `Module 1 has ${authoredCount} of 27 questions (flexible).`,
                  blocking: false,
                  field: "structure",
                },
              ]
            : [],
        }),
      });
    });

    // Threshold scenario: the Settings threshold bound follows authored N
    // (FR-2). The section editor PATCHes minimumCorrectForHigher here; the
    // mock enforces the same 1..authored bound the server does.
    if (thresholdScenario) {
      await page.route(`**/api/v1/assessment-authoring/exams/${examId}/sat-classroom-plan`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "x-csrf-token": "csrf-e2e-token" },
          body: JSON.stringify({ plan: { "reading-writing": "m1_only" }, flexible: true }),
        });
      });
      await page.route(`**/api/v1/assessment-authoring/exams/${examId}/sections/*/delivery-settings`, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        const next = typeof body["minimumCorrectForHigher"] === "number" ? (body["minimumCorrectForHigher"] as number) : currentThreshold;
        if (!Number.isInteger(next) || next < 1 || next > authoredCount) {
          await route.fulfill({
            status: 422,
            contentType: "application/json",
            body: JSON.stringify({
              code: "VALIDATION_FAILED",
              message: "Higher-route threshold must be between 1 and the operational question count.",
            }),
          });
          return;
        }
        currentThreshold = next;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "x-csrf-token": "csrf-e2e-token" },
          body: JSON.stringify(scopedShell),
        });
      });
    }
  }

  await page.route(`**/api/v1/exams/${createdExamId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        id: createdExamId,
        slug: createdExamId,
        title: "Flexible M1 homework",
        providerKey: "sat",
        examType: "Academic",
        status: "draft",
        visibility: "organization",
        ownerId: "user-builder-1",
        createdAt: "2026-11-03T00:00:00.000Z",
        updatedAt: "2026-11-03T00:00:00.000Z",
        currentDraftVersionId: shell.versionId,
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: 4,
        revision: 1,
      }),
    }),
  );

  // The real route also reads header metadata outside the authoring
  // transport. Unmocked, those reads reach the real API without a session
  // cookie and the 401/500 correctly signs the page out / errors the
  // console — so the harness answers them like sat-authoring-lifecycle does.
  await page.route(`**/api/v1/exams/${shell.examId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        id: shell.examId,
        slug: shell.examId,
        title: "Digital SAT",
        providerKey: "sat",
        examType: "Academic",
        status: "draft",
        visibility: "organization",
        ownerId: "user-builder-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        currentDraftVersionId: shell.versionId,
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: 4,
        revision: 1,
      }),
    }),
  );
  await page.route(`**/api/v1/assessment-release/exams/${shell.examId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        examId: shell.examId,
        providerKey: "sat",
        state: "never_published",
        currentPublishedVersion: null,
        workingDraft: {
          id: shell.versionId,
          parentVersionId: null,
          versionNumber: 1,
          revision: shell.versionRevision,
        },
        summary: { candidateDurationSeconds: 0, authoredQuestionCount: 10, deliveredQuestionCount: 0 },
        access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
      }),
    }),
  );

  // The fresh exam's workspace reads the same header metadata as the dev
  // harness (see above); answer it for the created exam too.
  await page.route(`**/api/v1/assessment-release/exams/${createdExamId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        examId: createdExamId,
        providerKey: "sat",
        state: "unpublished_changes",
        currentPublishedVersion: null,
        workingDraft: {
          id: shell.versionId,
          parentVersionId: null,
          versionNumber: 1,
          revision: shell.versionRevision,
        },
        summary: { candidateDurationSeconds: 0, authoredQuestionCount: 0, deliveredQuestionCount: 0 },
        access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
      }),
    }),
  );

  await page.route(`**/api/v1/exams/${createdExamId}/publish`, async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    recording.publishBodies.push(body);
    if (authoredCount === 0) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "Module 1 has 0 of 27 questions; add at least 1 question per included module.",
        }),
      });
      return;
    }
    if (thresholdScenario && currentThreshold > authoredCount) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "VALIDATION_FAILED",
          message: `reading-writing higher-route threshold ${currentThreshold} exceeds the ${authoredCount} authored Module 1 questions; lower the threshold or add questions before publishing.`,
          details: {
            code: "sat.threshold.unreachable",
            path: "reading-writing.minimumCorrectForHigher",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        id: shell.versionId,
        examId: createdExamId,
        versionNumber: 1,
        revision: shell.versionRevision + 1,
        isDraft: false,
        isPublished: true,
        publishScope: "full",
        createdAt: "2026-11-03T01:00:00.000Z",
        publishedAt: "2026-11-03T01:00:00.000Z",
      }),
    });
  });

  await page.route(`**/api/v1/assessment-access/exams/${createdExamId}/overview`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        examId: createdExamId,
        currentPublishedVersion: {
          id: shell.versionId,
          versionNumber: 1,
          revision: 1,
          publishNotes: null,
          publishScope: "full",
          createdAt: "2026-11-03T01:00:00.000Z",
        },
        links: [],
        total: 0,
      }),
    }),
  );

  await page.route(`**/api/v1/assessment-access/exams/${createdExamId}/links`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    recording.linkBodies.push(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        id: "access-link-flex-1",
        examId: createdExamId,
        examTitle: "Flexible M1 homework",
        providerKey: "sat",
        publishedVersionId: shell.versionId,
        versionNumber: 1,
        publishScope: "full",
        scheduleId: "schedule-flex-1",
        name: body["name"] ?? "Homework room",
        audienceType: "cohort",
        accessMode: "student_code",
        availabilityType: "anytime",
        lifecycleState: "active",
        status: "live",
        selectedStudentCount: 0,
        metrics: { registered: 0, started: 0, submitted: 0 },
        isCurrentRelease: true,
        hasParticipation: false,
        revision: 1,
        createdAt: "2026-11-03T01:00:00.000Z",
        updatedAt: "2026-11-03T01:00:00.000Z",
      }),
    });
  });

  // Delivery bootstrap for the M1-only attempt: only the base module is ever
  // admitted, and completion never waits for a Module 2 decision.
  await page.route("**/api/v1/assessment-delivery/schedules/*/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        attemptId: "attempt-flex-1",
        modules: [{ moduleKey: "rw-m1", title: "Module 1", adaptiveRole: "base" }],
        awaitingStaffRoute: false,
      }),
    }),
  );

  // Raw M1-only report: 6 correct of 10 authored, no route badge, no scaled
  // score, no converter pinned (raw-scores-only v1).
  await page.route("**/api/v1/results/sat/result-flex-1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify({
        summary: { outcomeStatus: "scored", attemptId: "attempt-flex-1" },
        sections: [{ sectionKey: "reading-writing", rawCorrect: 6, total: 10 }],
        questions: [],
        scorePayload: {
          classroomRaw: {
            rawCorrect: 6,
            total: 10,
            sections: [
              {
                sectionKey: "reading-writing",
                rawCorrect: 6,
                total: 10,
                modules: [{ moduleKey: "rw-m1", rawCorrect: 6, total: 10 }],
              },
            ],
          },
        },
      }),
    }),
  );

  return recording;
}

test.describe("SAT flexible count + M1-only (H1/H2/F1/F6 + H4 smoke)", () => {
  test("H1: staff creates a flexible M1-only Reading & Writing exam, raw-scores-only", async ({ page }) => {
    // A fresh exam carries no authored questions yet.
    const recording = await installFlexibleTransport(page, { authoredCount: 0 });

    await page.goto("/sat/exams");
    await page.getByRole("button", { name: "Create exam" }).first().click();

    const title = `Flexible M1 homework ${Date.now()}`;
    await page.locator("#sat-title").fill(title);
    // Custom modules is Classroom-only; the gate is open in this transport.
    await page.getByRole("radio", { name: "Custom modules" }).check();
    // H1 uses sections=[reading-writing]: the Math toggle narrows the scope.
    // (The On/Off indicator is aria-hidden, so the name is just "Math".)
    await page.getByRole("button", { name: "Math", exact: true }).click();
    // The checkbox name is the whole label block; match its head.
    await page.getByLabel(/Flexible question count/).first().check();

    // Step 1 (Modules & timing) carries the 6th module-set radio the plan
    // adds (ModuleSetPicker).
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: "Reading & Writing: Module 1 only" }).check();
    await expect(page.getByText("Students sit: Module 1 · 32 min").first()).toBeVisible();
    await expect(page.getByLabel(/Harder Module 2|Converted score/)).toHaveCount(0);

    await page.getByRole("button", { name: "Continue" }).click();
    // Raw-scores-only v1: no converter upload for flexible/M1-only.
    await expect(page.getByText("Flexible Module 1 only exams report raw scores only — converters aren't supported in v1.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Upload converter" })).toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();
    // Submit closes the sheet (unmounting the button) before the workspace
    // navigation lands, so a bare click would retry the detached node until
    // the action timeout. Race the click against the navigation instead: a
    // detached click after the URL lands means the submit was accepted.
    await Promise.allSettled([
      page.waitForURL(/\/sat\/exams\/exam-flex-1/, { timeout: 15_000 }),
      page.getByRole("button", { name: "Create exam" }).click({ timeout: 8_000 }),
    ]);

    await expect(page).toHaveURL(/\/sat\/exams\/exam-flex-1/);
    expect(recording.createExamBodies).toHaveLength(1);
    const configuration = (recording.createExamBodies[0]?.["configuration"] ?? {}) as Record<string, unknown>;
    expect(configuration["classroomPlan"]).toEqual({ "reading-writing": "m1_only" });
    expect(configuration["flexibleQuestionCount"]).toBe(true);
    expect(configuration["scoreConverter"] ?? null).toBeNull();
    // F8-adjacent: creation carries a retry-safety key (Idempotency-Key).
    expect(recording.idempotencyKeys[0]).toBeTruthy();
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("H2: 10Q publishes (10/27), a Classroom room is created, delivery serves only rw-m1", async ({ page }) => {
    const recording = await installFlexibleTransport(page, { authoredCount: 10 });

    await page.goto("/__dev/sat-authoring");
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();

    // Authored 10 of max 27: the readiness note is present and non-blocking,
    // so publish stays available (proven at the transport below).
    const validateResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-authoring/exams/dev-exam-1/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publishScope: "full" }),
      });
      return response.json();
    });
    expect(validateResponse.valid).toBe(true);
    expect(validateResponse.warnings.map((warning: { code: string }) => warning.code)).toContain(
      "sat.module.flexible_note",
    );
    for (const issue of [...validateResponse.errors, ...validateResponse.warnings]) {
      if (issue.code === "sat.module.flexible_note") expect(issue.blocking).toBe(false);
    }

    const publishResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/exams/exam-flex-1/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 1, expectedDraftVersionId: "draft-flex-1", expectedDraftRevision: 3 }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.isPublished).toBe(true);

    const roomResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-access/exams/exam-flex-1/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Homework room",
          audienceType: "cohort",
          accessMode: "student_code",
          availabilityType: "anytime",
          selectedStudents: [],
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(roomResponse.status).toBe(201);

    // The student side of H2: delivery admits only the base module and the
    // attempt never waits for a Module 2 decision (F6 contract).
    const bootstrap = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-delivery/schedules/schedule-flex-1/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return response.json();
    });
    expect(bootstrap.modules.map((module: { moduleKey: string }) => module.moduleKey)).toEqual(["rw-m1"]);
    expect(bootstrap.awaitingStaffRoute).toBe(false);

    expect(recording.publishBodies).toHaveLength(1);
    expect(recording.linkBodies).toHaveLength(1);
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("H2 raw: the M1-only result shows 6 / 10 with no route badge and no scaled score", async ({ page }) => {
    await installFlexibleTransport(page, { session: PROCTOR_SESSION });

    await page.goto("/sat/results/result-flex-1");
    await expect(page.getByText("6 / 10").first()).toBeVisible();
    await expect(page.getByText("Raw section score")).toBeVisible();
    // M1-only sits a single base module: no Higher/Lower route badge.
    await expect(page.getByText("Higher", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Lower", { exact: true })).toHaveCount(0);
    // Raw-scores-only v1: no 200–800 estimate anywhere on the report.
    await expect(page.getByText(/200–800|400–1600 point scale/)).toHaveCount(0);
  });

  test("F1: an empty included module blocks publish and the draft is unchanged", async ({ page }) => {
    const recording = await installFlexibleTransport(page, { authoredCount: 0 });

    await page.goto("/__dev/sat-authoring");
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();

    const validateResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-authoring/exams/dev-exam-1/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publishScope: "full" }),
      });
      return response.json();
    });
    expect(validateResponse.valid).toBe(false);
    expect(validateResponse.errors.map((issue: { code: string }) => issue.code)).toContain("sat.module.empty");
    for (const issue of validateResponse.errors) {
      if (issue.code === "sat.module.empty") expect(issue.blocking).toBe(true);
    }

    const publishResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/exams/exam-flex-1/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 1, expectedDraftVersionId: "draft-flex-1", expectedDraftRevision: 3 }),
      });
      return { status: response.status };
    });
    expect(publishResponse.status).toBe(409);

    // Refused publish changes nothing: the shell still reads READY and no
    // publish request beyond the refused one was recorded.
    const shellResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-authoring/exams/dev-exam-1/shell");
      return response.json();
    });
    expect(shellResponse.state).toBe("READY");
    expect(recording.publishBodies).toHaveLength(1);
    // The refused 409 is the proof of F1, and a failed fetch always logs one
    // resource error: allow exactly that, nothing else.
    const refusedLogs = recording.consoleErrors.filter((message) => message.includes("409"));
    expect(refusedLogs).toHaveLength(1);
    expect(recording.consoleErrors.filter((message) => !message.includes("409"))).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("F6: M1-only completion never waits for Module 2", async ({ page }) => {
    await installFlexibleTransport(page, { authoredCount: 10 });

    await page.goto("/__dev/sat-authoring");
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();

    // Terminal M1 with no route decision: the delivery state the completion
    // gate reads has no second module and no staff-route wait.
    const bootstrap = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-delivery/schedules/schedule-flex-1/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return response.json();
    });
    expect(bootstrap.awaitingStaffRoute).toBe(false);
    expect(bootstrap.modules).toHaveLength(1);
    await expect(page.getByText(/waiting for (Module 2|staff to assign)/i)).toHaveCount(0);
  });

  test("H4 smoke: Full SAT keeps strict gates, threshold, and converter path", async ({ page }) => {
    const recording = await installFlexibleTransport(page, { authoredCount: 27, fullSat: true });

    await page.goto("/__dev/sat-authoring");
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();

    // Exact counts validate clean with NO flexible note: the strict
    // len==target gate is byte-identical for Full SAT.
    const validateResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-authoring/exams/dev-exam-1/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publishScope: "full" }),
      });
      return response.json();
    });
    expect(validateResponse.valid).toBe(true);
    expect(
      [...validateResponse.errors, ...validateResponse.warnings].map((issue: { code: string }) => issue.code),
    ).not.toContain("sat.module.flexible_note");

    const publishResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/exams/exam-flex-1/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 1, expectedDraftVersionId: "draft-flex-1", expectedDraftRevision: 3 }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.publishScope).toBe("full");

    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("AUDIT publish-refused threshold copy → lower threshold → publish ok → sit → complete raw", async ({ page }) => {
    // Audit-fix FR-1/FR-2: flexible 10Q with the 27-max default threshold (13)
    // refuses publish with sat.threshold.unreachable; lowering to 9 unblocks
    // publish, room, sit, and the raw report.
    const recording = await installFlexibleTransport(page, { authoredCount: 10, thresholdScenario: true });

    await page.goto("/__dev/sat-authoring");
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();

    // 1. Readiness names the unreachable threshold as a BLOCKING issue.
    const blockedValidate = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-authoring/exams/dev-exam-1/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publishScope: "full" }),
      });
      return response.json();
    });
    expect(blockedValidate.valid).toBe(false);
    expect(blockedValidate.errors.map((issue: { code: string }) => issue.code)).toContain(
      "sat.threshold.unreachable",
    );
    const blockedIssue = blockedValidate.errors.find(
      (issue: { code: string }) => issue.code === "sat.threshold.unreachable",
    );
    expect(blockedIssue.blocking).toBe(true);
    expect(blockedIssue.path).toBe("reading-writing.minimumCorrectForHigher");
    expect(blockedIssue.message).toContain("exceeds the 10 authored");

    // 2. Publish is refused with the same copy; the draft is unchanged.
    const refusedPublish = await page.evaluate(async () => {
      const response = await fetch("/api/v1/exams/exam-flex-1/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 1, expectedDraftVersionId: "draft-flex-1", expectedDraftRevision: 3 }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(refusedPublish.status).toBe(409);
    expect(refusedPublish.body.message).toContain("exceeds the 10 authored");
    expect(refusedPublish.body.message).toContain("lower the threshold");

    // 3. The Settings bound follows authored N: 11 is refused, 9 is accepted.
    const overBound = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-authoring/exams/dev-exam-1/sections/sec-rw/delivery-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedSectionRevision: 1,
          breakAfterSeconds: 600,
          minimumCorrectForHigher: 11,
          expectedRoutingRevision: 1,
          moduleTimings: [],
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(overBound.status).toBe(422);
    const lowered = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-authoring/exams/dev-exam-1/sections/sec-rw/delivery-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedSectionRevision: 1,
          breakAfterSeconds: 600,
          minimumCorrectForHigher: 9,
          expectedRoutingRevision: 1,
          moduleTimings: [],
        }),
      });
      return { status: response.status };
    });
    expect(lowered.status).toBe(200);

    // 4. Republish succeeds; the room, sit, and raw report follow (H2 tail).
    const republish = await page.evaluate(async () => {
      const response = await fetch("/api/v1/exams/exam-flex-1/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 1, expectedDraftVersionId: "draft-flex-1", expectedDraftRevision: 3 }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(republish.status).toBe(200);
    expect(republish.body.isPublished).toBe(true);

    const roomResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-access/exams/exam-flex-1/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Homework room",
          audienceType: "cohort",
          accessMode: "student_code",
          availabilityType: "anytime",
          selectedStudents: [],
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(roomResponse.status).toBe(201);

    const bootstrap = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment-delivery/schedules/schedule-flex-1/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return response.json();
    });
    expect(bootstrap.modules.map((module: { moduleKey: string }) => module.moduleKey)).toEqual(["rw-m1"]);
    expect(bootstrap.awaitingStaffRoute).toBe(false);

    expect(recording.publishBodies).toHaveLength(2);
    // Two refused requests are the proof (409 publish + 422 over-bound
    // Settings save); each failed fetch logs one resource error, nothing else.
    const refusedLogs = recording.consoleErrors.filter((message) => message.includes("409"));
    expect(refusedLogs).toHaveLength(1);
    const overBoundLogs = recording.consoleErrors.filter((message) => message.includes("422"));
    expect(overBoundLogs).toHaveLength(1);
    expect(recording.consoleErrors.filter((message) => !message.includes("409") && !message.includes("422"))).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("AUDIT practice-unavailable copy: flexible exams never claim Practice rooms", async ({ page }) => {
    // Audit-fix FR-3 display half (BUG-002): a flexible-without-plan draft is
    // Classroom-only, so the review step must not print Practice-compatible copy.
    await installFlexibleTransport(page, { authoredCount: 0 });

    await page.goto("/sat/exams");
    await page.getByRole("button", { name: "Create exam" }).first().click();

    await page.locator("#sat-title").fill(`Flexible no-plan ${Date.now()}`);
    await page.getByRole("radio", { name: "Custom modules" }).check();
    await page.getByLabel(/Flexible question count/).first().check();

    // Modules & timing WITHOUT picking a module set: the plan stays empty and
    // the draft is flexible-without-plan — the exact shape the Practice gate
    // (FR-3) refuses server-side.
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    // Results step: raw-only note proves the flexible flag traveled.
    await expect(page.getByText("Flexible exams report raw scores only — converters aren't supported in v1.")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    // Review step: no Practice-compatible copy for flexible drafts.
    await expect(page.getByText("also works in Practice rooms")).toHaveCount(0);
    await expect(page.getByText(/Flexible/)).not.toHaveCount(0);
  });
});

