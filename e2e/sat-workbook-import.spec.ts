import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ADMIN_STORAGE_STATE_PATH, BUILDER_STORAGE_STATE_PATH } from "./support/backendE2e";
import { stubScreenDetails } from "./support/studentUi";

test.use({ storageState: BUILDER_STORAGE_STATE_PATH, actionTimeout: 10_000 });

const questionCount = 20;

async function createExam(page: Page, flexible: boolean) {
  await page.goto("/sat/exams");
  await page.getByRole("button", { name: "Create exam", exact: true }).first().click();
  const wizard = page.getByRole("dialog", { name: "New exam" });
  await wizard.getByLabel("Exam name").fill(`SAT workbook ${flexible ? "flexible" : "standard"} ${Date.now()}`);
  if (flexible) {
    await wizard.getByRole("radio", { name: "Custom modules" }).check();
    await wizard.getByRole("button", { name: "Math", exact: true }).click();
    await wizard.getByRole("checkbox", { name: /Flexible question count/ }).check();
    const next = wizard.getByRole("button", { name: "Continue", exact: true });
    await next.click();
    await wizard.getByRole("radio", { name: "Reading & Writing: Module 1 only" }).check();
    await wizard.getByRole("spinbutton", { name: "Module 1", exact: true }).fill("1");
    await next.click();
    await wizard.getByRole("switch", { name: "Show score report when a Classroom sitting ends" }).check();
    await next.click();
    await wizard.getByRole("button", { name: "Create exam", exact: true }).focus();
    await page.keyboard.press("Enter");
  } else {
    await wizard.getByRole("button", { name: "Create with standard settings" }).click();
  }
  await expect(page).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i);
}

async function openWorkbookImport(page: Page) {
  await page.getByRole("button", { name: "Import questions", exact: true }).click();
  await page.getByRole("menuitem", { name: /Import Excel workbook/ }).click();
  const dialog = page.getByRole("dialog", { name: "Import SAT from Excel" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function makePartialWorkbook(page: Page, dialog: Locator) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download SAT Excel template" }).click(),
  ]);
  const archive = unzipSync(await readFile(await download.path()));
  const questionsSheet = "xl/worksheets/sheet1.xml";
  const template = archive[questionsSheet];
  if (!template) throw new Error("The SAT template is missing the Questions worksheet.");

  // Fill the first 20 Reading & Writing rows in the actual download.
  // The remaining rows retain their template defaults.
  const rows = strFromU8(template).replace(/<row r="(\d+)">.*?<\/row>/g, (row, rowNumber: string) => {
    const order = Number(rowNumber) - 1;
    if (order < 1 || order > questionCount) return row;
    const cells = {
      A: "Reading &amp; Writing · Module 1",
      B: String(order),
      C: `Workbook question ${order}`,
      E: "Multiple Choice",
      F: "Choice A",
      G: "Choice B",
      H: "Choice C",
      I: "Choice D",
      J: "A",
      L: "Information and Ideas",
      M: "Central Ideas and Details",
      N: "Medium",
    };
    const xml = Object.entries(cells)
      .map(([column, value]) => `<c r="${column}${rowNumber}" t="inlineStr"><is><t>${value}</t></is></c>`)
      .join("");
    return `<row r="${rowNumber}">${xml}</row>`;
  });
  archive[questionsSheet] = strToU8(rows);
  return {
    name: "partial-sat.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(zipSync(archive)),
  };
}

test("flexible SAT workbook goes from import and retry to a released student score", async ({ page, browser }) => {
  // The student sits a real one-minute module and finishes on its server clock.
  test.setTimeout(120_000);
  await createExam(page, true);
  const dialog = await openWorkbookImport(page);
  const workbook = await makePartialWorkbook(page, dialog);
  await dialog.getByLabel("Choose SAT Excel workbook").setInputFiles(workbook);
  await expect(dialog.getByText("20/27", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Ready to import", { exact: true })).toBeVisible();

  // Let the real server commit, then drop its response once.
  await page.route("**/sat-workbook-commit", async (route) => {
    const response = await route.fetch();
    expect(response.ok(), "the first commit reached the API").toBe(true);
    await route.abort();
  }, { times: 1 });
  await dialog.getByRole("button", { name: "Import 20 questions" }).click();
  await dialog.getByRole("button", { name: "Retry import" }).click();
  await expect(dialog).toBeHidden();

  const banner = page.getByTestId("workbook-import-banner");
  await expect(banner).toContainText("Imported 20 questions from Excel");
  await expect(page.getByRole("tab", { name: /^Module 1, 20 of 27 questions ready/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: /^Module 1, 20 of 27 questions ready/ })).toBeVisible();
  const examId = new URL(page.url()).pathname.split("/").at(-1);
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === (process.env["CSRF_COOKIE_NAME"] ?? "csrf"),
  );
  if (!csrf) throw new Error("Builder session did not provide a CSRF cookie.");
  const readiness = await page.request.post(`/api/v1/assessment-authoring/exams/${examId}/validate`, {
    headers: { "x-csrf-token": csrf.value },
    data: { publishScope: "reading-writing" },
  });
  await expect(readiness).toBeOK();
  expect(await readiness.json()).toMatchObject({
    valid: true,
    errors: [],
    warnings: expect.arrayContaining([expect.objectContaining({ code: "sat.module.flexible_note", blocking: false })]),
  });
  await sitClassroomExam(page, browser);
});

test("standard SAT blocks the same 20-question workbook at preview", async ({ page }) => {
  await createExam(page, false);
  const dialog = await openWorkbookImport(page);
  const workbook = await makePartialWorkbook(page, dialog);
  await dialog.getByLabel("Choose SAT Excel workbook").setInputFiles(workbook);

  await expect(dialog.getByText("20/27", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Preview Reading & Writing · Module 1" })).toContainText("Needs attention");
  await expect(dialog.getByRole("button", { name: "Import workbook" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^Module 1, 0 of 27 questions ready/ })).toBeVisible();
});

async function sitClassroomExam(staff: Page, browser: Browser) {
  const roomName = `Workbook Classroom ${Date.now()}`;
  const createRoom = staff.getByRole("button", { name: "Create room", exact: true });
  await createRoom.first().click();
  const setup = staff.getByRole("dialog", { name: "Create room" });
  await setup.getByLabel("Room name").fill(roomName);
  await setup.getByRole("button", { name: /^Classroom/ }).click();
  await setup.getByText("More options", { exact: true }).click();
  await setup.getByRole("button", { name: /Name \+ email only/i }).click();
  await setup.getByRole("button", { name: /^Open now/ }).click();
  const [published] = await Promise.all([
    staff.waitForResponse((response) => response.request().method() === "POST" && /\/sat\/exams\/[^/]+\/rooms$/.test(response.url())),
    setup.getByRole("button", { name: "Create room", exact: true }).click(),
  ]);
  expect(published.ok()).toBe(true);
  const receipt = await published.json();
  expect(receipt.version).toMatchObject({ createdNow: true, scope: "reading-writing" });
  expect(receipt.room.publishedVersionId).toBe(receipt.version.id);
  await expect(setup).toBeHidden();

  const proctorContext = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH });
  const studentContext = await browser.newContext();
  try {
    const proctor = await proctorContext.newPage();
    await proctor.goto(new URL(`/sat/sessions/${receipt.room.scheduleId}`, staff.url()).href);
    await expect(proctor.getByRole("heading", { level: 1, name: roomName })).toBeVisible();
    await proctor.getByRole("button", { name: "Share student link", exact: true }).click();
    const share = proctor.getByRole("dialog", { name: `Share ${roomName} with students` });
    const joinHref = await share.getByText(/\/join\//).textContent();
    if (!joinHref) throw new Error("The Classroom room did not provide a student link.");
    await share.getByRole("button", { name: "Close share sheet" }).click();

    await stubScreenDetails(studentContext);
    const student = await studentContext.newPage();
    await student.goto(joinHref);
    await student.getByLabel("Full name").fill("Workbook Student");
    await student.getByLabel("Email").fill(`workbook-student-${Date.now()}@example.com`);
    await student.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(student).toHaveURL(/\/student\/[0-9a-f-]+\/[^/]+$/i);

    await proctor.getByRole("button", { name: "Review and start exam" }).click();
    await proctor.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click();
    await student.reload({ waitUntil: "domcontentloaded" });
    const exam = student.getByTestId("sat-exam-shell");
    for (let order = 1; order <= questionCount; order++) {
      await expect(exam.getByText(`Workbook question ${order}`, { exact: true })).toBeVisible();
      const choice = order <= 15 ? "Choice A" : "Choice B";
      await exam.locator("label").filter({ hasText: choice }).click();
      if (order < questionCount) {
        await exam.getByRole("button", { name: "Next question", exact: true }).click();
      }
    }
    await expect(student.getByRole("region", { name: "Score report" })).toContainText("15 of 20", { timeout: 75_000 });
  } finally {
    await Promise.all([studentContext.close(), proctorContext.close()]);
  }
}
