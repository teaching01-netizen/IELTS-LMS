import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoSeriousAxeViolations } from "./support/axeAudit";

/*
 * Browser evidence for SAT registration forms + Eva SIM (UX-02..UX-08, TC-28).
 * Every API is intercepted; embedded providers are controlled fixture origins
 * (an allowed frame, a frame-denying one), never a real third party.
 */

const SCHEDULE_ID = "sched-forms-e2e";
const LONG_THAI = "ปีที่คาดว่าจะเข้าศึกษาในมหาวิทยาลัย (ค.ศ.) สำหรับการสมัครรอบพิเศษของโครงการทุนการศึกษาระยะยาว";

const registrationForm = {
  versionId: "ver-forms-1",
  schemaVersion: 1,
  fields: [
    { id: "sat_admission_year", type: "number", label: "Admission year (ค.ศ.)", help: "Expected university admission year, e.g. 2027.", required: true, scope: "all", integer: true, min: 1000, max: 9999 },
    { id: "sat_seat_number", type: "text", label: "Seat number", help: "Enter the seat assigned by your proctor, e.g. A-007.", required: true, scope: "all", maxLength: 255 },
    {
      id: "sat_expected_class",
      type: "single_choice",
      label: "Expected Class",
      required: true,
      scope: "math",
      options: ["Unenroll", "Rank 4", "Rank 3", "Rank 2", "Rank 1"].map((label, i) => ({ id: i === 0 ? "unenroll" : `rank_${5 - i}`, label })),
    },
    { id: "q_thai", type: "text", label: LONG_THAI, required: false, scope: "all", maxLength: 255 },
  ],
};

const VIEWPORTS = [
  { name: "320px", width: 320, height: 760 },
  // 200% zoom of a 1280px window lays out at 640 CSS px.
  { name: "200% zoom", width: 640, height: 800 },
  { name: "768px", width: 768, height: 1024 },
  { name: "1440px", width: 1440, height: 900 },
] as const;

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }),
  });
}

async function baseTransport(page: Page) {
  await page.routeWebSocket("**/api/v1/ws/**", (socket) => void socket.close({ code: 1000, reason: "REST-only test" }));
  await page.route("**/api/v1/**", (route) => json(route, {}));
  await page.route("**/api/v1/auth/session", (route) => json(route, { code: "UNAUTHORIZED", message: "No session." }, 401));
}

async function expectNoHorizontalOverflow(page: Page, surface: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${surface} scrolls horizontally`).toBeLessThanOrEqual(1);
}

// Audit the steady state: axe samples mid-fade colours while a dialog animates in.
async function animationsSettled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
}

async function expectVisibleFocus(page: Page) {
  const indicator = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "none";
    const style = getComputedStyle(el);
    return style.outlineStyle !== "none" && style.outlineWidth !== "0px" ? "outline" : style.boxShadow !== "none" ? "ring" : "none";
  });
  expect(indicator, "focused control shows a focus indicator").not.toBe("none");
}

test.describe("student check-in with exam details", () => {
  test.beforeEach(async ({ page }) => {
    await baseTransport(page);
    await page.route(`**/api/v1/auth/student/schedules/${SCHEDULE_ID}`, (route) =>
      json(route, { id: SCHEDULE_ID, providerKey: "sat", status: "live", examTitle: "SAT Practice", examId: "exam-1", registrationForm })
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`reflows and passes axe at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/student/${SCHEDULE_ID}`);
      await expect(page.getByRole("group", { name: "Exam details" })).toBeVisible();
      await expect(page.getByText(LONG_THAI)).toBeVisible();
      await expectNoHorizontalOverflow(page, `check-in ${viewport.name}`);
      await expectNoSeriousAxeViolations(page, `check-in ${viewport.name}`);
      // Student input sizing is kept (UX-03).
      const size = await page.getByLabel(/Seat number/).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
    });
  }

  test("keyboard: Continue explains errors, focuses the first invalid field, and sends exact answers", async ({ page }) => {
    const bodies: unknown[] = [];
    await page.route("**/api/v1/auth/student/entry", async (route) => {
      bodies.push(route.request().postDataJSON());
      await json(route, { code: "CONFLICT", message: "The registration form changed.", details: { reason: "FORM_VERSION_CHANGED" } }, 409);
    });
    await page.goto(`/student/${SCHEDULE_ID}`);
    await page.getByLabel("Student ID/WCODE").fill("W250334");
    await page.getByLabel("Full name").fill("Student One");
    await page.getByLabel("Email").fill("student@example.com");
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/Admission year/)).toBeFocused();
    await expect(page.getByLabel(/Admission year/)).toHaveAttribute("aria-invalid", "true");
    await expectVisibleFocus(page);
    expect(bodies).toHaveLength(0);

    await page.keyboard.type("2027");
    await page.keyboard.press("Tab");
    await page.keyboard.type("A-007");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(/Expected Class/)).toBeFocused();
    await page.getByLabel(/Expected Class/).selectOption("rank_1");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("The registration form changed. Review your details and continue.")).toBeVisible();
    expect(bodies[0]).toMatchObject({
      scheduleId: SCHEDULE_ID,
      registrationForm: { versionId: "ver-forms-1", answers: { sat_admission_year: 2027, sat_seat_number: "A-007", sat_expected_class: "rank_1" } },
    });
    // Compatible answers survive a version conflict; the card is not reset.
    await expect(page.getByLabel(/Seat number/)).toHaveValue("A-007");
    await expect(page.getByLabel("Full name")).toHaveValue("Student One");
  });
});

const EVA_PATH = "**/api/v1/assessment-forms/schedules/debug-schedule/attempts/debug-attempt/eva-sim";

function embedState(url: string, host: string, open = true) {
  return {
    eligibility: "eligible",
    mode: "embed",
    collection: open ? "open" : "closed",
    versionId: "ver-1",
    closedAt: open ? null : "2026-10-22T11:00:00Z",
    canReturnToComplete: true,
    response: "not_tracked",
    canSubmit: false,
    canOpen: open,
    embedUrl: open ? url : null,
    externalOpenUrl: open ? url : null,
    embedHost: host,
  };
}

test.describe("Eva SIM after completion", () => {
  test.beforeEach(async ({ page }) => {
    await baseTransport(page);
    await page.route("https://forms.example.org/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Provider</title><form><label>Feedback <input name=f></label><button>Send</button></form>" })
    );
    await page.route("https://denied.example.org/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", headers: { "x-frame-options": "DENY" }, body: "<p>denied</p>" })
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`embed view keeps outside controls usable at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route(EVA_PATH, (route) => json(route, embedState("https://forms.example.org/f/1", "forms.example.org")));
      await page.goto("/__dev/sat-forms");
      const frame = page.getByTitle("Eva SIM form from forms.example.org");
      await expect(frame).toBeVisible();
      await expect(frame).toHaveAttribute("sandbox", "allow-forms allow-scripts allow-same-origin");
      await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
      await expect(page.frameLocator("iframe").getByRole("button", { name: "Send" })).toBeVisible();
      const back = page.getByRole("button", { name: "Back to SAT Complete" });
      const link = page.getByRole("link", { name: /Open form in new tab/ });
      await expect(back).toBeInViewport();
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      // Back precedes the frame in DOM order (UX spec §3).
      const order = await page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Back to SAT Complete"));
        const iframe = document.querySelector("iframe");
        return button && iframe ? button.compareDocumentPosition(iframe) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
      });
      expect(order).toBeTruthy();
      await expectNoHorizontalOverflow(page, `embed ${viewport.name}`);
      await expectNoSeriousAxeViolations(page, `embed ${viewport.name}`);
    });
  }

  test("a frame-denying provider still leaves Back and the new-tab fallback", async ({ page }) => {
    await page.route(EVA_PATH, (route) => json(route, embedState("https://denied.example.org/f", "denied.example.org")));
    await page.goto("/__dev/sat-forms");
    await expect(page.getByTitle("Eva SIM form from denied.example.org")).toBeAttached();
    await expect(page.getByRole("link", { name: /Open form in new tab/ })).toBeVisible();
    await page.getByRole("button", { name: "Back to SAT Complete" }).click();
    await expect(page.getByText("External Eva SIM · submission not tracked")).toBeVisible();
    // Returning focuses the surviving Eva action.
    await expect(page.getByRole("button", { name: "Open Eva SIM" })).toBeFocused();
    // Back sticks across reload; polling does not reopen the frame.
    await page.reload();
    await expect(page.getByText("External Eva SIM · submission not tracked")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("closed embed access shows no frame or launch action", async ({ page }) => {
    await page.route(EVA_PATH, (route) => json(route, embedState("", "forms.example.org", false)));
    await page.goto("/__dev/sat-forms");
    await expect(page.getByText("Eva SIM access closed · submission not tracked")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open Eva SIM" })).toHaveCount(0);
  });

  test("native: keyboard first submission, accepted status, then reflow and contrast", async ({ page }) => {
    let accepted: Record<string, unknown> | null = null;
    const fields = [
      { id: "q_mood", type: "single_choice", label: "How was the Math section?", required: true, scope: "math", options: [{ id: "good", label: "Good" }, { id: "hard", label: "Hard" }] },
      { id: "q_note", type: "text", label: LONG_THAI, required: false, scope: "math", maxLength: 500 },
    ];
    await page.route(EVA_PATH, async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { answers: Record<string, unknown> };
        accepted = body.answers;
        await json(route, { revision: 1, firstSubmittedAt: "2026-10-22T10:00:00Z", updatedAt: "2026-10-22T10:00:00Z", answers: body.answers });
        return;
      }
      await json(route, {
        eligibility: "eligible",
        mode: "native",
        collection: "open",
        versionId: "ver-1",
        closedAt: null,
        canReturnToComplete: accepted !== null,
        response: accepted ? "submitted" : "not_submitted",
        canSubmit: true,
        fields,
        revision: accepted ? 1 : 0,
        answers: accepted,
        updatedAt: accepted ? "2026-10-22T10:00:00Z" : null,
      });
    });
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto("/__dev/sat-forms");
    await expect(page.getByText("Submit Eva SIM to continue. You can edit your response until your proctor ends the exam.")).toBeVisible();
    await expectNoHorizontalOverflow(page, "native Eva 320px");
    await expectNoSeriousAxeViolations(page, "native Eva");

    await page.getByRole("button", { name: "Submit Eva SIM" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/How was the Math section/)).toBeFocused();
    await page.getByLabel(/How was the Math section/).selectOption("good");
    await page.getByRole("button", { name: "Submit Eva SIM" }).click();

    await expect(page.getByText("Eva SIM submitted", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Eva SIM" })).toBeFocused();
    expect(accepted).toEqual({ q_mood: "good" });
    await expectNoHorizontalOverflow(page, "SAT Complete with Eva 320px");
    await expectNoSeriousAxeViolations(page, "SAT Complete with Eva");
  });

  test("reduced motion and forced colors keep the Eva actions visible", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await page.route(EVA_PATH, (route) => json(route, embedState("https://forms.example.org/f/1", "forms.example.org")));
    await page.goto("/__dev/sat-forms");
    await expect(page.getByRole("button", { name: "Back to SAT Complete" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open form in new tab/ })).toBeVisible();
  });
});

const standardForms = {
  schemaVersion: 1,
  registration: { fields: registrationForm.fields.slice(0, 3) },
  evaSim: { enabled: false, mode: "native" },
};

test.describe("staff Settings: Registration form and Eva SIM", () => {
  test.beforeEach(async ({ page }) => {
    await baseTransport(page);
    let current: Record<string, unknown> = { versionId: "ver-draft", versionRevision: 3, editable: true, forms: standardForms, standard: standardForms, issues: [], limits: { maxFields: 50, maxOptions: 50, maxLabelChars: 200, maxHelpChars: 300, maxTextAnswerChars: 4000, maxUrlChars: 2048 } };
    await page.route("**/api/v1/assessment-authoring/exams/debug-exam/forms", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { forms: unknown };
        current = { ...current, forms: body.forms, versionRevision: (current["versionRevision"] as number) + 1 };
      }
      await json(route, current);
    });
  });

  for (const viewport of VIEWPORTS) {
    test(`editor reflows and passes axe at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/__dev/sat-forms?surface=settings");
      await expect(page.getByRole("heading", { name: "Registration form" })).toBeVisible();
      await page.getByRole("button", { name: "Edit Expected Class" }).click();
      await expectNoHorizontalOverflow(page, `settings ${viewport.name}`);
      await expectNoSeriousAxeViolations(page, `settings ${viewport.name}`);
      const size = await page.getByLabel("Label").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
    });
  }

  test("keyboard reorder keeps focus and announces, save confirms, embed preview warns", async ({ page }) => {
    await page.goto("/__dev/sat-forms?surface=settings");
    const up = page.getByRole("button", { name: "Move Expected Class up" });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Move Expected Class up" })).toBeFocused();
    await expect(page.getByText("Expected Class moved to position 2 of 3.")).toBeAttached();
    await expectVisibleFocus(page);
    await page.getByRole("button", { name: "Save registration form" }).click();
    await expect(page.getByText("Registration form saved.")).toBeAttached();
    await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();

    await page.getByRole("switch", { name: "Enable Eva SIM" }).check();
    await page.getByRole("radio", { name: "Embedded link" }).check();
    await page.getByLabel("Form URL").fill("https://forms.example.org/f/1");
    await expect(page.getByText("Destination: forms.example.org")).toBeVisible();
    await page.route("https://forms.example.org/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>provider</p>" }));
    // Keyboard open: WebKit does not focus buttons on mouse click, and focus return is what is under test.
    await page.getByRole("button", { name: "Preview", exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Preview — opening this external form may allow real submissions.").first()).toBeVisible();
    await expect(dialog.getByTitle("Eva SIM form from forms.example.org")).toHaveAttribute("sandbox", "allow-forms allow-scripts allow-same-origin");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeFocused();
  });
});

const RESPONSE_ROW = {
  attemptId: "attempt-r1",
  studentName: "สมชาย ใจดี นักเรียนที่มีชื่อยาวมากเป็นพิเศษสำหรับทดสอบการตัดบรรทัด",
  studentEmail: "very.long.student.address.for.wrapping@example-school.ac.th",
  studentCode: "W250334",
  examId: "exam-1",
  examTitle: "SAT Practice Test 06",
  scheduleId: "sched-r1",
  scheduleName: "Morning room",
  versionId: "ver-1",
  versionNumber: 2,
  formKey: "eva_sim",
  mode: "native",
  status: "submitted",
  collection: "closed",
  closedAt: "2026-10-22T11:00:00Z",
  revision: 2,
  updatedAt: "2026-10-22T10:30:00Z",
};

test.describe("staff /sat/forms responses", () => {
  test.beforeEach(async ({ page }) => {
    await baseTransport(page);
    await page.route("**/api/v1/auth/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-csrf-token": "csrf-forms" },
        body: JSON.stringify({
          success: true,
          data: { user: { id: "admin-1", email: "admin@example.test", displayName: "Dana Admin", role: "admin", state: "active" }, csrfToken: "csrf-forms", expiresAt: "2099-01-01T00:00:00.000Z" },
        }),
      })
    );
    await page.route("**/api/v1/proctor/sessions**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/proctor/sessions") {
        return json(route, [
          {
            schedule: { id: "sched-r1", examId: "exam-1", providerKey: "sat", examTitle: "SAT Practice Test 06", cohortName: "Morning room", status: "completed", startTime: "2026-10-22T08:00:00Z", endTime: "2026-10-22T12:00:00Z" },
            runtime: null,
            studentCount: 1,
            activeCount: 0,
            joinReadyCount: 0,
            joinTotalCount: 0,
            degradedLiveMode: false,
          },
        ]);
      }
      return json(route, {});
    });
    await page.route("**/api/v1/assessment-forms/responses**", (route) => json(route, { items: [RESPONSE_ROW], nextCursor: null }));
    await page.route("**/api/v1/assessment-forms/attempts/attempt-r1/responses/eva_sim", (route) =>
      json(route, {
        ...RESPONSE_ROW,
        firstSubmittedAt: "2026-10-22T10:00:00Z",
        fields: [{ id: "q_note", type: "text", label: LONG_THAI, required: false, scope: "math", maxLength: 500 }],
        answers: { q_note: "ข้อสอบคณิตศาสตร์ยากกว่าที่คาดไว้มาก ".repeat(6) },
      })
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`list and detail reflow and pass axe at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/sat/forms?form=eva_sim");
      const row = page.getByRole("button", { name: /Submitted\. Open response/ });
      await expect(row).toBeVisible();
      await expectNoHorizontalOverflow(page, `responses ${viewport.name}`);
      await expectNoSeriousAxeViolations(page, `responses ${viewport.name}`);

      await row.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Eva SIM response" });
      await expect(dialog.getByText(LONG_THAI)).toBeVisible();
      await animationsSettled(page);
      await expectNoHorizontalOverflow(page, `response detail ${viewport.name}`);
      await expectNoSeriousAxeViolations(page, `response detail ${viewport.name}`);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(row).toBeFocused();
    });
  }
});


const SECTION_PATH = "**/api/v1/assessment-forms/schedules/debug-schedule/attempts/debug-attempt/section-entry/math";
function mathEntryState(state = "required", canSubmit = true) {
  return { versionId: "v2", sectionKey: "math", formKey: "math_entry", moduleId: "debug-math", state, canSubmit, canStart: state === "submitted", fields: [
    { id: "expected_class", type: "single_choice", label: "Expected Class", required: true, options: ["Unenroll", "Rank 4", "Rank 3", "Rank 2", "Rank 1"].map((label, index) => ({ id: String(index), label })) },
    { id: "note", type: "text", label: LONG_THAI, required: false, maxLength: 300 },
  ] };
}
test.describe("separate Math entry form", () => {
  for (const viewport of VIEWPORTS) {
    test(`reflows and passes axe at ${viewport.name}`, async ({ page }) => {
      await baseTransport(page);
      await page.route(SECTION_PATH, route => json(route, mathEntryState()));
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/__dev/sat-forms?surface=section");
      await expect(page.getByRole("heading", { name: "Before Math" })).toBeVisible();
      await expect(page.getByLabel(/Expected Class/)).toHaveValue("");
      await expect(page.getByRole("timer")).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `Math entry ${viewport.name}`);
      await expectNoSeriousAxeViolations(page, `Math entry ${viewport.name}`);
      await page.getByRole("button", { name: "Submit and continue" }).click();
      await expect(page.getByLabel(/Expected Class/)).toBeFocused();
      await expect(page.getByLabel(/Expected Class/)).toHaveAttribute("aria-invalid", "true");
      await expectVisibleFocus(page);
      if (viewport.width === 320) await page.screenshot({ path: test.info().outputPath("math-entry.png"), fullPage: true });
    });
  }
  test("retries a lost acknowledgement with the same operation, then leaves the sealed form", async ({ page }) => {
    await baseTransport(page);
    const writes: Array<{ operationId: string; answers: unknown }> = [];
    let submitted = false;
    await page.route(SECTION_PATH, async route => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON(); writes.push(body);
        if (writes.length === 1) return json(route, { code: "SERVICE_UNAVAILABLE", message: "Connection interrupted" }, 503);
        submitted = true;
        return json(route, { revision: 1, firstSubmittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), answers: body.answers });
      }
      return json(route, mathEntryState(submitted ? "submitted" : "required"));
    });
    await page.goto("/__dev/sat-forms?surface=section");
    await page.getByLabel(/Expected Class/).selectOption("1");
    await page.getByRole("button", { name: "Submit and continue" }).click();
    await expect(page.getByText("Connection interrupted", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Expected Class/)).toBeDisabled();
    await page.getByRole("button", { name: "Retry submission" }).click();
    await expect(page.getByRole("heading", { name: "Section details accepted" })).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]?.answers).toEqual({ expected_class: "1" });
  });
  test("pausing retains answers and End removes the submission action", async ({ page }) => {
    await baseTransport(page);
    let state = "required", canSubmit = true;
    await page.route(SECTION_PATH, route => json(route, mathEntryState(state, canSubmit)));
    await page.goto("/__dev/sat-forms?surface=section");
    await page.getByLabel(/Expected Class/).selectOption("2");
    canSubmit = false;
    await expect(page.getByRole("button", { name: "Submit and continue" })).toBeDisabled({ timeout: 10_000 });
    await expect(page.getByLabel(/Expected Class/)).toHaveValue("2");
    state = "closed";
    await expect(page.getByRole("heading", { name: "This section is closed" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Submit and continue" })).toHaveCount(0);
  });
});


function splitStandardForms() {
  const copy = (field: Record<string, unknown>) => { const out = { ...field }; delete out.scope; return out; };
  return { schemaVersion: 2, registration: { fields: registrationForm.fields.slice(0, 2).map(copy) },
    sectionEntry: { "reading-writing": { fields: [] }, math: { fields: registrationForm.fields.slice(2, 3).map(copy) } }, evaSim: { enabled: false, mode: "native" } };
}
function editorDocument(forms: unknown, revision = 3) {
  return { versionId: "ver-draft", versionRevision: revision, editable: true, forms, standard: splitStandardForms(), issues: [], limits: { maxFields: 50, maxOptions: 50, maxLabelChars: 200, maxHelpChars: 300, maxTextAnswerChars: 4000, maxUrlChars: 2048 } };
}
test.describe("staff separate section editors", () => {
  for (const viewport of VIEWPORTS) {
    test(`four editors reflow and pass axe at ${viewport.name}`, async ({ page }) => {
      await baseTransport(page);
      await page.route("**/api/v1/assessment-authoring/exams/debug-exam/forms", route => json(route, editorDocument(splitStandardForms())));
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/__dev/sat-forms?surface=settings");
      await expect(page.getByRole("heading", { name: "Verbal entry form" })).toBeVisible();
      const registration = page.locator("section").filter({ has: page.getByRole("heading", { name: "Registration form", exact: true }) });
      await expect(registration.getByText("Expected Class", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Edit Expected Class" }).click();
      await expect(page.getByLabel("Applies to")).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `section editors ${viewport.name}`);
      await expectNoSeriousAxeViolations(page, `section editors ${viewport.name}`);
      await page.getByRole("button", { name: "Preview Math entry form" }).click();
      const dialog = page.getByRole("dialog", { name: "Preview Math entry form (draft)" });
      await expect(dialog.getByLabel(/Expected Class/)).toHaveValue("");
      await expect(dialog.getByText("Sitting", { exact: true })).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `Math preview ${viewport.name}`);
    });
  }
  test("a legacy draft upgrades only after the reviewed confirmation", async ({ page }) => {
    await baseTransport(page);
    let current = editorDocument(standardForms);
    const writes: unknown[] = [];
    await page.route("**/api/v1/assessment-authoring/exams/debug-exam/forms", async route => {
      if (route.request().method() === "PUT") { const body = route.request().postDataJSON(); writes.push(body.forms); current = editorDocument(body.forms, 4); }
      return json(route, current);
    });
    await page.goto("/__dev/sat-forms?surface=settings");
    await page.getByRole("button", { name: "Review section form upgrade" }).click();
    const dialog = page.getByRole("dialog", { name: "Review section form upgrade" });
    await expect(dialog.getByText("Before Math", { exact: true })).toBeVisible();
    expect(writes).toHaveLength(0);
    await dialog.getByRole("button", { name: "Enable separate section forms" }).click();
    await expect(page.getByRole("heading", { name: "Math entry form" })).toBeVisible();
    expect(writes).toEqual([splitStandardForms()]);
  });
});


test("acknowledged section answers stay sealed when the following read fails", async ({ page }) => {
  await baseTransport(page);
  let accepted = false, failRead = true, writes = 0;
  await page.route(SECTION_PATH, async route => {
    if (route.request().method() === "PUT") { accepted = true; writes++; return json(route, { revision: 1, firstSubmittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), answers: route.request().postDataJSON().answers }); }
    if (accepted && failRead) return json(route, { code: "SERVICE_UNAVAILABLE", message: "State read unavailable" }, 503);
    return json(route, mathEntryState(accepted ? "submitted" : "required"));
  });
  await page.goto("/__dev/sat-forms?surface=section");
  await page.getByLabel(/Expected Class/).selectOption("2");
  await page.getByRole("button", { name: "Submit and continue" }).click();
  await expect(page.getByRole("button", { name: "Submitted", exact: true })).toBeDisabled();
  await expect(page.getByLabel(/Expected Class/)).toBeDisabled();
  await expect(page.getByLabel(/Expected Class/)).toHaveValue("2");
  await expect(page.getByText("State read unavailable", { exact: true })).toBeVisible();
  failRead = false;
  await page.getByRole("button", { name: "Check status" }).click();
  await expect(page.getByRole("heading", { name: "Section details accepted" })).toBeVisible();
  expect(writes).toBe(1);
});

test("Math form can be customized, disabled and restored without losing questions", async ({ page }) => {
  await baseTransport(page);
  let current = editorDocument(splitStandardForms());
  const writes: Array<ReturnType<typeof splitStandardForms> & { sectionEntry: { math: { enabled?: boolean; fields: Array<Record<string, unknown>> } } }> = [];
  await page.route("**/api/v1/assessment-authoring/exams/debug-exam/forms", async route => {
    if (route.request().method() === "PUT") { const body = route.request().postDataJSON(); writes.push(body.forms); current = editorDocument(body.forms, 3 + writes.length); }
    return json(route, current);
  });
  await page.goto("/__dev/sat-forms?surface=settings");
  const toggle = page.getByRole("switch", { name: "Enable Math entry form" });
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Edit Expected Class" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Choose next Math class");
  await toggle.uncheck();
  await page.getByRole("button", { name: "Save Math entry form" }).click();
  await expect(page.getByRole("button", { name: "Save Math entry form" })).toBeDisabled();
  expect(writes[0]?.sectionEntry.math.enabled).toBe(false);
  expect(writes[0]?.sectionEntry.math.fields[0]?.label).toBe("Choose next Math class");
  expect(writes[0]?.sectionEntry.math.fields[0]?.options).toEqual(splitStandardForms().sectionEntry.math.fields[0]?.options);
  await page.getByRole("button", { name: "Preview Math entry form" }).click();
  await expect(page.getByRole("dialog").getByText(/This form is disabled for new rooms/)).toBeVisible();
  await page.keyboard.press("Escape");
  await toggle.check();
  await page.getByRole("button", { name: "Save Math entry form" }).click();
  await expect(page.getByRole("button", { name: "Save Math entry form" })).toBeDisabled();
  expect(writes[1]?.sectionEntry.math.enabled).toBe(true);
  expect(writes[1]?.sectionEntry.math.fields).toEqual(writes[0]?.sectionEntry.math.fields);
});
