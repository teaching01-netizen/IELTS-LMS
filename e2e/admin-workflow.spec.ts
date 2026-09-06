import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH, readBackendE2EManifest } from "./support/backendE2e";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe("Go-backed admin workflow", () => {
  test("creates a cohort schedule and exposes it in the scheduler", async ({ page }) => {
    const { student } = readBackendE2EManifest();
    await page.goto("/admin/scheduling");
    await expect(page.getByRole("heading", { name: "Exam Scheduler" })).toBeVisible();
    await page.getByRole("button", { name: "New Session" }).click();
    await expect(page.getByRole("heading", { name: "Schedule New Session" })).toBeVisible();

    await page.getByLabel("Select exam").selectOption({ value: student.examId });
    await page.getByLabel("Select cohort").selectOption({ label: "Morning Batch B" });
    await page.getByLabel("Proctor display name").fill("Migration E2E Proctor");
    await page.getByLabel("Grading display name").fill("Migration E2E Grader");
    await page.getByRole("button", { name: "Create Schedule" }).click();

    await expect(page.getByText("Morning Batch B").last()).toBeVisible();
  });

  test("loads the grading queue and current results surface", async ({ page }) => {
    await page.goto("/admin/grading");
    await expect(page.getByRole("heading", { name: "Grading Queue" })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Search sessions by exam or cohort" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();

    await page.goto("/admin/results");
    await expect(page.getByRole("heading", { name: "Results & Analytics" })).toBeVisible();
    const provider = page.getByRole("combobox", { name: "Filter by provider" });
    await expect(provider).toHaveValue("all");
    await provider.selectOption("act");
    await expect(provider).toHaveValue("act");
    await page.getByRole("searchbox", { name: "Search results" }).fill("no matching student");
    await expect(page.getByText("No matching results")).toBeVisible();
  });

  test("updates and resets the admin defaults profile", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Global Exam Defaults" })).toBeVisible();

    await page.getByRole("button", { name: "General" }).click();
    const summary = page.getByPlaceholder("Enter default exam summary...");
    await summary.fill("Migration default summary");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(summary).toHaveValue("Migration default summary");

    await page.getByRole("button", { name: "Modules" }).click();
    await expect(page.getByRole("heading", { name: "Module & Content Defaults" })).toBeVisible();

    await page.getByRole("button", { name: "Time & Progression" }).click();
    await expect(page.getByRole("heading", { name: "Module Timers & Rules" })).toBeVisible();

    await page.getByRole("button", { name: "Security" }).click();
    await expect(
      page.getByRole("heading", { name: "Security & Proctoring Defaults" })
    ).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reset Baseline" }).click();
    await page.getByRole("button", { name: "General" }).click();
    await expect(summary).toHaveValue("Standard IELTS Academic Exam");
  });
});
