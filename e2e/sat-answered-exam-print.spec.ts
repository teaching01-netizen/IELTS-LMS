import { expect, test, type Page, type Route } from "@playwright/test";

// PDF-05 / PDF-10 (docs/sat-result.md §4–5) in real engines: the staff
// "Download answered exam" prints only the paper, every figure decoded, nothing
// clipped at page width, and never prints when a figure cannot load.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const LONG = "A long stimulus line that must wrap inside the page rather than run off its edge. ".repeat(12);

async function fulfillJson(route: Route, data: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", json: { success: true, data } });
}

const text = (value: string) => ({ version: 1, nodes: [{ type: "paragraph", id: value.slice(0, 24), text: value }] });
const figure = (assetId: string) => ({
  version: 2,
  nodes: [],
  document: { type: "doc", content: [{ type: "image", attrs: { assetId, alt: "Graph", width: 1600 } }] },
});

function answeredExam(figureAsset: string) {
  const modules = ["m1", "m2"].map((id, moduleIndex) => ({
    id,
    moduleKey: `math-${moduleIndex + 1}`,
    title: `Module ${moduleIndex + 1}`,
    displayOrder: moduleIndex,
    questions: Array.from({ length: 12 }, (_, index) => ({
      examQuestionId: `${id}-q${index}`,
      questionId: `${id}-q${index}`,
      displayOrder: index,
      isPretest: false,
      questionType: index % 2 ? "student_produced_response" : "single_choice",
      stimulus: index === 0 ? figure(figureAsset) : text(`${LONG} (${id} ${index})`),
      prompt: text(`Prompt ${id}-${index}`),
      answer:
        index % 2
          ? { kind: "student_produced_response" }
          : { kind: "single_choice", options: ["a", "b", "c", "d"].map((option) => ({ id: `${id}-${index}-${option}`, content: text(`Choice ${option}`) })) },
      metadata: {},
      accessibility: { longDescription: null },
    })),
  }));
  return {
    attemptId: "attempt-print",
    examTitle: "SAT Practice 04",
    candidateName: "Mina Chen",
    versionId: "v3",
    sections: [{ sectionKey: "math", title: "Math", modules }],
    attempt: {
      id: "attempt-print",
      moduleAttempts: modules.map((module, index) => ({ id: `ma${index}`, moduleId: module.id, startedAt: "2026-10-07T09:03:00Z" })),
      responses: [
        { moduleAttemptId: "ma0", examQuestionId: "m1-q0", response: "m1-0-b" },
        { moduleAttemptId: "ma0", examQuestionId: "m1-q1", response: "3/4" },
        { moduleAttemptId: "ma1", examQuestionId: "m2-q1", response: "-12.5" },
      ],
    },
  };
}

async function openDetail(page: Page, figureAsset: string) {
  await page.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints++;
    };
  });
  await page.route("**/api/v1/auth/session", (route) =>
    fulfillJson(route, {
      user: { id: "e2e-admin", email: "sat-print@example.test", displayName: "SAT Print E2E", role: "admin", state: "active" },
      csrfToken: "e2e-csrf-token",
      expiresAt: "2099-01-01T00:00:00Z",
    }),
  );
  await page.route("**/api/v1/results/sat/result-print", (route) =>
    fulfillJson(route, {
      summary: {
        id: "result-print", attemptId: "attempt-print", outcomeStatus: "scored", releaseStatus: "ready", totalScore: null,
        scheduleId: "access-e2e", examId: "exam-e2e", examTitle: "SAT Practice 04", versionNumber: 3,
        studentId: "ST-1042", studentName: "Mina Chen", studentEmail: null, cohortName: "Class A", submittedAt: "2026-10-07T11:18:00Z",
      },
      scorePayload: {}, sections: [], questions: [], testStartedAt: "2026-10-07T09:03:00Z",
    }),
  );
  await page.route("**/api/v1/results/sat/attempts/attempt-print/answered-exam", (route) => fulfillJson(route, answeredExam(figureAsset)));
  await page.route("**/api/v1/media/asset-ok", (route) =>
    fulfillJson(route, { id: "asset-ok", contentType: "image/png", fileName: "graph.png", uploadStatus: "ready", downloadUrl: "/__e2e/graph.png" }),
  );
  await page.route("**/__e2e/graph.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route("**/api/v1/media/asset-blocked", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", json: { success: false, error: { code: "FORBIDDEN", message: "Forbidden" } } }),
  );
  await page.goto("/sat/results/result-print");
  await expect(page.getByRole("heading", { name: "Mina Chen", level: 1 })).toBeVisible();
}

const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: number }).__prints);

test("prints only the complete paper, figures decoded, nothing clipped", async ({ page, browserName }, testInfo) => {
  await openDetail(page, "asset-ok");
  await page.getByRole("button", { name: "Download answered exam (PDF)" }).click();
  await expect.poll(() => prints(page), { timeout: 35_000 }).toBe(1);

  await page.emulateMedia({ media: "print" });
  const layout = await page.evaluate(() => {
    const paper = document.querySelector<HTMLElement>("body > .sat-answered-print .sat-answered-paper")!;
    const width = document.documentElement.clientWidth;
    const shown = [...document.body.children].filter((child) => getComputedStyle(child).display !== "none");
    return {
      paperDisplay: getComputedStyle(paper).display,
      onlyPaperShown: shown.length === 1 && shown[0]!.classList.contains("sat-answered-print"),
      modules: paper.querySelectorAll("section").length,
      questions: paper.querySelectorAll("article").length,
      images: [...paper.querySelectorAll("img")].map((image) => ({ complete: image.complete, natural: image.naturalWidth, right: image.getBoundingClientRect().right })),
      clipped: [...paper.querySelectorAll<HTMLElement>("article, article *")].filter((element) => element.getBoundingClientRect().right > width + 0.5).length,
      overflow: paper.scrollWidth - paper.clientWidth,
      selected: paper.querySelectorAll("[data-selected]").length,
      text: paper.textContent ?? "",
      width,
    };
  });
  expect(layout.paperDisplay).toBe("block");
  expect(layout.onlyPaperShown).toBe(true);
  expect(layout.modules).toBe(2);
  expect(layout.questions).toBe(24);
  expect(layout.images).toHaveLength(2);
  for (const image of layout.images) {
    expect(image.complete).toBe(true);
    expect(image.natural).toBeGreaterThan(0);
    expect(image.right).toBeLessThanOrEqual(layout.width + 0.5);
  }
  expect(layout.clipped).toBe(0);
  expect(layout.overflow).toBeLessThanOrEqual(0);
  expect(layout.selected).toBe(1);
  expect(layout.text).toContain("Your answer: 3/4");
  expect(layout.text).toContain("Your answer: -12.5");
  expect(layout.text).not.toContain("Mina Chen, In progress");

  if (browserName === "chromium") {
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
    // Each module starts on a new page and 24 questions do not fit on two.
    expect(pages).toBeGreaterThanOrEqual(3);
    await testInfo.attach("answered-exam.pdf", { body: pdf, contentType: "application/pdf" });
  }
});

test("never prints when a figure cannot load", async ({ page }) => {
  await openDetail(page, "asset-blocked");
  const started = Date.now();
  await page.getByRole("button", { name: "Download answered exam (PDF)" }).click();
  await expect(page.getByRole("alert")).toContainText("no PDF was made", { timeout: 10_000 });
  // Fails fast on the reported figure, not after the 30 s readiness bound.
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(await prints(page)).toBe(0);
});
