import { expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { stubScreenDetails } from "./studentUi";
import { executeUpdate } from "./db";

export interface RunningSatSessionOptions {
  /** Short label used to keep generated session and candidate identifiers unique. */
  label: string;
  /** Optional browser profile for the student page; the admin page remains the caller's page. */
  studentContext?: BrowserContextOptions;
  /** Leave the published session waiting so a test can control proctor start. */
  startRuntime?: boolean;
  /** Explicit cohort timing for scenarios that expire shared section rows. */
  timingModel?: "cohort_section_v3";
  /** Pin an opt-in SAT delivery policy before the student is admitted. */
  deliveryPolicy?: {
    version: "sat_recovery_v1";
    recoverySeconds: number;
    entryRecoverySeconds: number;
    lateAnswerPolicy: "frozen_arrival_window" | "server_confirmed_only";
  };
}

/** Create one published SAT session, optionally leaving it for a later proctor start. */
export async function createRunningSatSession(
  browser: Browser,
  adminPage: Page,
  options: RunningSatSessionOptions
) {
  // Keep stale authoring selectors from consuming the entire test timeout.
  adminPage.setDefaultTimeout(30_000);
  const suffix = Date.now().toString(36);
  const label = options.label
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  const examTitle = `SAT ${label} ${suffix}`;
  const linkName = `SAT ${label} link ${suffix}`;
  const studentName = `SAT ${label} candidate ${suffix}`;
  const studentEmail = `sat-${label}-${suffix}@example.com`;

  await adminPage.goto("/sat/exams");
  const createSatButton = adminPage.getByRole("button", { name: "Create exam" }).first();
  await expect(createSatButton).toBeVisible({ timeout: 30_000 });
  await createSatButton.click();
  await adminPage.getByLabel("Exam name").fill(examTitle);
  await adminPage.getByRole("button", { name: "Create" }).click();
  await expect(adminPage).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i, { timeout: 30_000 });

  await adminPage.getByRole("button", { name: "More exam actions" }).click();
  await adminPage.getByRole("menuitem", { name: /Load sample exam/ }).click();
  await expect(adminPage.getByRole("dialog", { name: "Load sample SAT" })).toBeVisible();
  await adminPage.getByRole("button", { name: "Load 147 questions" }).click();
  await expect(
    adminPage.getByRole("tab", { name: /^Reading & Writing, 81 of 81 authored/ })
  ).toBeVisible({ timeout: 90_000 });
  await expect(adminPage.getByRole("tab", { name: /^Math, 66 of 66 authored/ })).toBeVisible();
  // Room creation now saves and captures the current exam release in one
  // operation. Use that user-facing path instead of the retired publish step.
  await adminPage.getByRole("button", { name: "Create room", exact: true }).first().click();
  const roomSetup = adminPage.getByRole("dialog", { name: "Create room" });
  await expect(roomSetup).toBeVisible();
  await roomSetup.getByLabel("Room name").fill(linkName);
  await roomSetup.getByText("More options", { exact: true }).click();
  await roomSetup.getByRole("button", { name: /Name \+ email only/i }).click();
  await roomSetup.getByRole("button", { name: /^Open now/ }).click();
  await roomSetup.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(roomSetup).toBeHidden({ timeout: 30_000 });

  await adminPage.goto("/sat/sessions");
  await expect(adminPage.getByRole("heading", { name: "Rooms" })).toBeVisible({ timeout: 30_000 });
  const sessionRow = adminPage
    .locator("button")
    .filter({ hasText: examTitle })
    .filter({ hasText: linkName })
    .first();
  await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  await sessionRow.click();
  const scheduleId = new URL(adminPage.url()).pathname.split("/").filter(Boolean).at(-1);
  if (!scheduleId) throw new Error("SAT room route did not include a schedule id.");
  await expect(adminPage).toHaveURL(new RegExp(`/sat/sessions/${scheduleId}$`));
  await expect(adminPage.getByRole("heading", { level: 1, name: linkName })).toBeVisible();
  // Resume scenarios use the proctor-start lifecycle. E2E can enable the
  // access-code rollout, which otherwise changes the server default.
  await executeUpdate("UPDATE exam_schedules SET sat_start_mode = 'proctor' WHERE id = ?", [
    scheduleId,
  ]);
  if (options.deliveryPolicy) {
    await executeUpdate("UPDATE exam_schedules SET sat_delivery_policy = ? WHERE id = ?", [
      JSON.stringify(options.deliveryPolicy),
      scheduleId,
    ]);
  }
  await adminPage.getByRole("button", { name: "Share student link", exact: true }).click();
  const shareDialog = adminPage.getByRole("dialog", { name: `Share ${linkName} with students` });
  await expect(shareDialog).toBeVisible();
  const joinHref = await shareDialog.getByText(/\/join\//).textContent();
  if (!joinHref) throw new Error("SAT student join URL was not created.");
  await shareDialog.getByRole("button", { name: "Close share sheet" }).click();

  const studentContext = await browser.newContext(options.studentContext);
  studentContext.setDefaultTimeout(30_000);
  await stubScreenDetails(studentContext);
  const studentPage = await studentContext.newPage();
  await studentPage.goto(joinHref);
  try {
    await expect(
      studentPage.getByRole("heading", { name: "Exam Check-in", exact: true })
    ).toBeVisible({
      timeout: 30_000,
    });
  } catch (error) {
    const pageText = await studentPage
      .locator("body")
      .innerText()
      .catch(() => "Unable to read page text.");
    throw new Error(
      `Student Link page did not load at ${studentPage.url()}: ${pageText.slice(0, 1_000)}`,
      { cause: error }
    );
  }
  await studentPage.getByLabel("Full name").fill(studentName);
  await studentPage.getByLabel("Email").fill(studentEmail);
  await studentPage.getByRole("button", { name: /Continue/i }).click();
  await expect(studentPage).toHaveURL(/\/student\/[0-9a-f-]+\/[^/]+$/i, { timeout: 30_000 });

  const studentRouteParts = new URL(studentPage.url()).pathname.split("/").filter(Boolean);
  const studentScheduleId = studentRouteParts[1];
  const candidateId = decodeURIComponent(studentRouteParts[2] ?? "");
  if (!studentScheduleId) throw new Error("SAT student route did not include a schedule id.");
  if (!candidateId) throw new Error("SAT student route did not include a candidate id.");
  if (options.timingModel) {
    await executeUpdate("UPDATE exam_schedules SET sat_timing_model = ? WHERE id = ?", [
      options.timingModel,
      studentScheduleId,
    ]);
  }
  if (options.startRuntime !== false) {
    await adminPage.getByRole("button", { name: "Review and start exam" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Start exam" })
      .click();

    await studentPage.reload({ waitUntil: "domcontentloaded" });
    await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
    await expect(studentPage.locator('input[type="radio"]').first()).toBeVisible({
      timeout: 30_000,
    });
  }

  return {
    studentContext,
    studentPage,
    scheduleId: studentScheduleId,
    candidateId,
    joinHref,
    examTitle,
    linkName,
    studentName,
    studentEmail,
  };
}
