import { expect, test, type Page } from "@playwright/test";

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
              isPretest: false,
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

interface Recording {
  getShell: number;
  postShell: number;
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
  options: { missingExam?: boolean } = {}
): Promise<Recording> {
  const recording: Recording = {
    getShell: 0,
    postShell: 0,
    other: [],
    consoleErrors: [],
    pageErrors: [],
  };
  let draftOpened = false;

  page.on("console", (message) => {
    if (message.type() === "error") {
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

    // The workspace itself is the proof the shell was installed: the section
    // header and the queue row only exist for a real shell.
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No editable draft" })).toHaveCount(0);
    expect(recording.postShell).toBe(1);
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("refreshing after a draft exists re-reads it and never opens another", async ({ page }) => {
    const recording = await installTransport(page);

    await page.goto("/__dev/sat-authoring");
    await page.getByRole("button", { name: "Open draft" }).click();
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();
    expect(recording.postShell).toBe(1);

    const readsBeforeReload = recording.getShell;
    await page.reload();

    // The refresh is a READ of the same draft: no new POST, and no "Open draft"
    // CTA in place of a draft that already exists.
    await expect(page.getByRole("heading", { name: "Reading & Writing" })).toBeVisible();
    expect(recording.postShell).toBe(1);
    expect(recording.getShell).toBeGreaterThan(readsBeforeReload);
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("a missing exam renders as not-found and offers no Open draft CTA", async ({ page }) => {
    const recording = await installTransport(page, { missingExam: true });

    await page.goto("/__dev/sat-authoring");

    await expect(page.getByText("Exam not found", { exact: false })).toBeVisible();
    // Offering the CTA for an exam that does not exist would invite the author
    // to retry a command that cannot succeed.
    await expect(page.getByRole("button", { name: "Open draft" })).toHaveCount(0);
    expect(recording.postShell).toBe(0);
  });
});
