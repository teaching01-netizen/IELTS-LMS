import { expect, test, type Page } from '@playwright/test';
import {
  BUILDER_STORAGE_STATE_PATH,
  readBackendE2EManifest,
} from './support/backendE2e';

test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

async function waitForAuthSession(page: Page) {
  const sessionResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/auth/session') && response.request().method() === 'GET',
  );
  await sessionResponse;
}

async function readExamSnapshot(
  page: Page,
  examId: string,
) {
  return page.evaluate(async (seedExamId) => {
    const [examResponse, versionsResponse, validationResponse] = await Promise.all([
      fetch(`/api/v1/exams/${seedExamId}`, { credentials: 'include' }),
      fetch(`/api/v1/exams/${seedExamId}/versions`, { credentials: 'include' }),
      fetch(`/api/v1/exams/${seedExamId}/validation`, { credentials: 'include' }),
    ]);

    const examPayload = await examResponse.json();
    const versionsPayload = await versionsResponse.json();
    const validationPayload = await validationResponse.json();

    return {
      exam: examPayload.data,
      versions: versionsPayload.data,
      validation: validationPayload.data,
    };
  }, examId);
}

test.describe('Backend-backed builder workflow', () => {
  test('loads seeded draft, saves a backend revision, validates, and publishes', async ({
    page,
  }) => {
    const manifest = readBackendE2EManifest();
    const editedPrompt = 'Builder prompt updated through backend E2E';

    const authSessionResponse = waitForAuthSession(page);
    await page.goto(`/builder/${manifest.builder.examId}/builder`);
    await authSessionResponse;
    await expect(page.getByLabel('Exam title')).toBeVisible();

    const initialSnapshot = await readExamSnapshot(page, manifest.builder.examId);
    expect(initialSnapshot.exam.id).toBe(manifest.builder.examId);
    expect(initialSnapshot.exam.revision).toBe(manifest.builder.initialRevision);
    expect(initialSnapshot.versions).toHaveLength(manifest.builder.initialVersionCount);

    await page.getByPlaceholder('Enter the question prompt...').fill(editedPrompt);
    await expect(page.getByPlaceholder('Enter the question prompt...')).toHaveValue(editedPrompt);
    await page.getByPlaceholder('Enter the question prompt...').press('Tab');

    await page.getByLabel('Save draft').click();

    await expect
      .poll(async () => {
        const snapshot = await readExamSnapshot(page, manifest.builder.examId);
        return {
          latestPrompt:
            snapshot.versions[0]?.contentSnapshot?.reading?.passages?.[0]?.blocks?.[0]?.questions?.[0]
              ?.prompt ?? null,
          revision: snapshot.exam.revision,
          versionCount: snapshot.versions.length,
        };
      })
      .toMatchObject({
        latestPrompt: editedPrompt,
      });

    const savedSnapshot = await readExamSnapshot(page, manifest.builder.examId);
    expect(savedSnapshot.exam.revision).toBeGreaterThan(manifest.builder.initialRevision);
    expect(savedSnapshot.versions.length).toBeGreaterThan(
      manifest.builder.initialVersionCount,
    );
    expect(
      savedSnapshot.versions[0]?.contentSnapshot?.reading?.passages?.[0]?.blocks?.[0]?.questions?.[0]
        ?.prompt,
    ).toBe(editedPrompt);
    expect(savedSnapshot.validation.canPublish).toBe(true);

    await page.goto(`/builder/${manifest.builder.examId}/review`);
    await expect(
      page.getByRole('heading', { name: 'Review & Publish' }),
    ).toBeVisible();
    await expect(page.locator('p').filter({ hasText: 'Technical Validation Passed' }).first()).toBeVisible();

    const scheduleButton = page.getByRole('button', { name: 'Toggle schedule options' });
    await scheduleButton.click();

    const scheduledInput = page.getByLabel('Scheduled time');
    await scheduledInput.fill('2026-05-01T09:00');

    await page.getByLabel('Publish notes').fill('Published by backend-backed E2E');
    await page.getByRole('button', { name: 'Publish & Schedule' }).click();
    await expect(page.getByRole('dialog', { name: 'Publish Exam' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Publish' }).click();
    await expect
      .poll(async () => {
        const snapshot = await readExamSnapshot(page, manifest.builder.examId);
        return {
          status: snapshot.exam.status,
          publishedVersionId: snapshot.exam.currentPublishedVersionId ?? null,
        };
      })
      .toMatchObject({
        status: 'published',
      });

    await page.reload();

    const publishedSnapshot = await readExamSnapshot(page, manifest.builder.examId);
    expect(publishedSnapshot.exam.status).toBe('published');
    expect(publishedSnapshot.exam.currentPublishedVersionId).toBeTruthy();
    const publishedVersion = publishedSnapshot.versions.find(
      (version: { id: string }) => version.id === publishedSnapshot.exam.currentPublishedVersionId,
    );
    expect(
      publishedVersion?.contentSnapshot?.reading?.passages?.[0]?.blocks?.[0]?.questions?.[0]?.prompt,
    ).toBe(editedPrompt);
    expect(
      publishedSnapshot.versions.some(
        (version: { id: string; isPublished: boolean }) =>
          version.id === publishedSnapshot.exam.currentPublishedVersionId &&
          version.isPublished,
      ),
    ).toBe(true);
  });

  test('configures security settings and severity thresholds', async ({ page }) => {
    const manifest = readBackendE2EManifest();

    await page.goto(`/builder/${manifest.builder.examId}/builder`);
    await expect(page.getByLabel('Exam title')).toBeVisible();

    // Navigate to security settings
    await page.getByRole('tab', { name: 'Security' }).click();

    // Configure tab switching detection
    const tabSwitchCheckbox = page.getByLabel('Detect Tab Switching');
    await tabSwitchCheckbox.check();
    await expect(tabSwitchCheckbox).toBeChecked();

    // Configure secondary screen detection
    const secondaryScreenCheckbox = page.getByLabel('Detect Secondary Screen');
    await secondaryScreenCheckbox.check();
    await expect(secondaryScreenCheckbox).toBeChecked();

    // Configure severity thresholds
    await page.getByRole('tab', { name: 'Severity' }).click();

    const lowThresholdInput = page.getByLabel('Low Severity Threshold');
    await lowThresholdInput.fill('5');
    await expect(lowThresholdInput).toHaveValue('5');

    const mediumThresholdInput = page.getByLabel('Medium Severity Threshold');
    await mediumThresholdInput.fill('3');
    await expect(mediumThresholdInput).toHaveValue('3');

    const highThresholdInput = page.getByLabel('High Severity Threshold');
    await highThresholdInput.fill('2');
    await expect(highThresholdInput).toHaveValue('2');

    // Save changes
    await page.getByLabel('Save draft').click();
    await expect(page.getByText('Draft saved successfully')).toBeVisible();
  });

  test('clones exam for new version and archives old versions', async ({ page }) => {
    const manifest = readBackendE2EManifest();

    await page.goto(`/builder/${manifest.builder.examId}/review`);
    await expect(page.getByRole('heading', { name: 'Review & Publish' })).toBeVisible();

    // Clone exam
    await page.getByRole('button', { name: 'Clone Exam' }).click();
    await expect(page.getByRole('dialog', { name: 'Clone Exam' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Clone' }).click();

    // Verify new version created
    await expect(page.getByText('Exam cloned successfully')).toBeVisible();

    const snapshot = await readExamSnapshot(page, manifest.builder.examId);
    expect(snapshot.versions.length).toBeGreaterThan(1);

    // Archive old version if needed
    if (snapshot.versions.length > 2) {
      await page.getByRole('button', { name: 'Manage Versions' }).click();
      const oldVersionButton = page.locator('[data-version-id]').first();
      await oldVersionButton.getByRole('button', { name: 'Archive' }).click();
      await expect(page.getByText('Version archived successfully')).toBeVisible();
    }
  });

  test('verifies audit logs for builder actions', async ({ page }) => {
    const manifest = readBackendE2EManifest();

    await page.goto(`/builder/${manifest.builder.examId}/builder`);
    await expect(page.getByLabel('Exam title')).toBeVisible();

    // Make a change to trigger audit log
    const editedTitle = 'E2E Test Exam - Updated Title';
    await page.getByLabel('Exam title').fill(editedTitle);
    await page.getByLabel('Save draft').click();

    // Navigate to audit logs
    await page.goto(`/builder/${manifest.builder.examId}/audit`);
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();

    // Verify audit log entry exists
    await expect(page.getByText('Draft saved')).toBeVisible();
  });
});
