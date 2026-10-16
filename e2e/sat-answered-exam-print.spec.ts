import { expect, test, type Page, type Route } from "@playwright/test";

// PDF-05 / PDF-10 (docs/sat-result.md §4–5) in real engines. The staff
// "Download answered exam" posts the decoded figures to the server renderer
// and downloads its PDF; it never asks when a figure cannot load. The server
// prints /print/sat-answered in Chromium, A4 landscape, one question per page.

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
  const posts: { title: string; view: unknown; media: Record<string, string> }[] = [];
  await page.route("**/api/v1/sat-answered-pdf/attempts/attempt-print", async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/pdf", body: Buffer.from("%PDF-1.7\n%%EOF\n") });
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
  return posts;
}

async function examPresentation(page: Page) {
  return page.locator('[data-review-module] article').first().evaluate(article => {
    const selectors = [
      'h2',
      '[data-sat-color-rail]',
      '[data-review-choices] .sat-answer-choice[data-selected]',
      '[data-review-choices] .sat-answer-choice[data-selected] .sat-type-body',
    ];
    return selectors.map(selector => {
      const element = article.querySelector(selector);
      if (!element) throw new Error(`Live exam component missing: ${selector}`);
      const style = getComputedStyle(element);
      return {
        font: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
        color: style.color, background: style.backgroundColor,
        border: style.border, radius: style.borderRadius, padding: style.padding,
      };
    });
  });
}

const PAGE_HEIGHT_PX = 718; // A4 landscape content box at 10 mm margins

test("downloads the server's PDF of the complete paper, with its figures inline", async ({ page }) => {
  const posts = await openDetail(page, "asset-ok");
  let printed = 0;
  await page.exposeFunction("__printed", () => printed++);
  await page.addInitScript(() => { window.print = () => void (window as unknown as { __printed: () => void }).__printed(); });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download answered exam (PDF)" }).click();
  expect((await download).suggestedFilename()).toBe("Mina Chen - SAT Practice 04 - Answered exam.pdf");
  expect(posts).toHaveLength(1);
  expect(posts[0]!.title).toBe("Mina Chen - SAT Practice 04 - Answered exam");
  // The renderer has no network: the figure travels as the bytes the paper decoded.
  expect(posts[0]!.media).toEqual({ "asset-ok": `data:image/png;base64,${PNG.toString("base64")}` });
  expect(printed).toBe(0);
  await expect(page.locator(".sat-answered-paper")).toHaveCount(0);
});

test("never asks for a PDF when a figure cannot load", async ({ page }) => {
  const posts = await openDetail(page, "asset-blocked");
  const started = Date.now();
  await page.getByRole("button", { name: "Download answered exam (PDF)" }).click();
  await expect(page.getByRole("alert")).toContainText("no PDF was made", { timeout: 10_000 });
  // Fails fast on the reported figure, not after the 30 s readiness bound.
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(posts).toHaveLength(0);
});

// What backend/go/internal/answeredpdf does, minus the browser launch.
test("print route fits every question to one A4 landscape page", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "the server renders with Chromium only");
  const token = "0123456789abcdef0123456789abcdef";
  await page.route(`**/__answered-exam-payload/${token}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { exam: answeredExam("asset-ok"), view: null, media: { "asset-ok": `data:image/png;base64,${PNG.toString("base64")}` } },
    }),
  );
  await page.setViewportSize({ width: 1047, height: PAGE_HEIGHT_PX });
  await page.emulateMedia({ media: "print" });
  await page.goto(`/print/sat-answered?payload=${token}`);
  await expect(page.locator("body")).toHaveAttribute("data-print-state", "ready", { timeout: 35_000 });

  const layout = await page.evaluate((pageHeight) => {
    const paper = document.querySelector<HTMLElement>("body > .sat-answered-paper")!;
    const width = document.documentElement.clientWidth;
    const shown = [...document.body.children].filter((child) => getComputedStyle(child).display !== "none" && child.tagName !== "STYLE" && child.tagName !== "SCRIPT");
    const tables = [...paper.querySelectorAll<HTMLElement>(".sat-paper-review")];
    const unfit = tables.flatMap((table) => {
      const reserve = (table.querySelector(":scope > thead")?.getBoundingClientRect().height ?? 0)
        + (table.querySelector(":scope > tfoot")?.getBoundingClientRect().height ?? 0);
      return [...table.querySelectorAll<HTMLElement>(".sat-paper-question-row")]
        .filter((row) => row.getBoundingClientRect().height > pageHeight - reserve)
        .map((row) => row.textContent?.slice(0, 40));
    });
    return {
      paperDisplay: getComputedStyle(paper).display,
      onlyPaperShown: shown.length === 1 && shown[0] === paper,
      answerSheets: paper.querySelectorAll("ol li[data-question]").length,
      reviewModules: paper.querySelectorAll("[data-review-module]").length,
      runheads: paper.querySelectorAll("[data-runhead-module]").length,
      questions: paper.querySelectorAll("article").length,
      coverCount: paper.querySelectorAll("[data-cover-page]").length,
      coverLogoLoaded: [...paper.querySelectorAll<HTMLImageElement>("[data-cover-page] img")].every((image) => image.complete && image.naturalWidth > 0),
      images: [...paper.querySelectorAll("figure img")].map((image) => ({ complete: (image as HTMLImageElement).complete, natural: (image as HTMLImageElement).naturalWidth, right: image.getBoundingClientRect().right })),
      smallWatermarks: paper.querySelectorAll('[data-watermark="small"]').length,
      largeWatermarks: paper.querySelectorAll('[data-watermark="large"]').length,
      clipped: [...paper.querySelectorAll<HTMLElement>("article, article *")].filter((element) => element.getBoundingClientRect().right > width + 0.5).length,
      overflow: paper.scrollWidth - paper.clientWidth,
      selected: paper.querySelectorAll("[data-selected]").length,
      text: paper.textContent ?? "",
      footerVisible: getComputedStyle(paper.querySelector("tfoot .sat-paper-footer")!).visibility,
      unfit,
      width,
    };
  }, PAGE_HEIGHT_PX);
  expect(layout.paperDisplay).toBe("block");
  expect(layout.onlyPaperShown).toBe(true);
  expect(layout.answerSheets).toBe(24);
  expect(layout.reviewModules).toBe(2);
  expect(layout.runheads).toBe(2);
  expect(layout.questions).toBe(24);
  expect(layout.coverCount).toBe(1);
  expect(layout.coverLogoLoaded).toBe(true);
  expect(layout.smallWatermarks).toBe(8);
  expect(layout.largeWatermarks).toBe(1);
  expect(layout.footerVisible).toBe("visible");
  expect(layout.text).toContain("LEGAL DISCLAIMER");
  expect(layout.text).toContain("THB 540,000");
  expect(layout.images).toHaveLength(2);
  for (const image of layout.images) {
    expect(image.complete).toBe(true);
    expect(image.natural).toBeGreaterThan(0);
    expect(image.right).toBeLessThanOrEqual(layout.width + 0.5);
  }
  expect(layout.clipped).toBe(0);
  expect(layout.overflow).toBeLessThanOrEqual(0);
  // Every question, choices included, fits under its runhead and footer.
  expect(layout.unfit).toEqual([]);
  expect(layout.selected).toBe(1);
  expect(layout.text).toContain("Exam review");
  expect(layout.text).toContain("Correct answers are not shown");
  expect(layout.text).toContain("3/4");
  expect(layout.text).toContain("-12.5");

  // Printing must not restyle the live exam's components (same zoom both ways).
  await page.locator(".sat-paper-exam-frame").evaluateAll((frames) => {
    for (const frame of frames) (frame as HTMLElement).style.zoom = "0.75";
  });
  const printPresentation = await examPresentation(page);
  await page.emulateMedia({ media: "screen" });
  expect(await examPresentation(page)).toEqual(printPresentation);
  await page.reload();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("body")).toHaveAttribute("data-print-state", "ready", { timeout: 35_000 });

  // The renderer's PrintToPDF call: the page's own @page decides size and margins.
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = [...pdf.toString("latin1").matchAll(/\/Type\s*\/Page[^s]/g)];
  const boxes = [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/g)];
  // Landscape A4 (842 × 595 pt) on every page.
  for (const [, w, h] of boxes) {
    expect(Math.round(Number(w))).toBe(842);
    expect(Math.round(Number(h))).toBe(595);
  }
  // Front matter, then exactly one page per question.
  expect(pages.length).toBeGreaterThanOrEqual(24 + 2);
  expect(pages.length).toBeLessThanOrEqual(24 + 4);
  await testInfo.attach("answered-exam.pdf", { body: pdf, contentType: "application/pdf" });
});
