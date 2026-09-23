import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { stubScreenDetails } from './studentUi';

export interface RunningSatSessionOptions {
  /** Short label used to keep generated session and candidate identifiers unique. */
  label: string;
  /** Optional browser profile for the student page; the admin page remains the caller's page. */
  studentContext?: BrowserContextOptions;
  /** Leave the published session waiting so a test can control proctor start. */
  startRuntime?: boolean;
}

/** Create one published SAT session, optionally leaving it for a later proctor start. */
export async function createRunningSatSession(
  browser: Browser,
  adminPage: Page,
  options: RunningSatSessionOptions,
) {
  const suffix = Date.now().toString(36);
  const label = options.label.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const examTitle = `SAT ${label} ${suffix}`;
  const linkName = `SAT ${label} link ${suffix}`;
  const studentName = `SAT ${label} candidate ${suffix}`;
  const studentEmail = `sat-${label}-${suffix}@example.com`;

  await adminPage.goto('/sat/exams');
  await expect(adminPage.getByRole('heading', { name: 'Exam Library' })).toBeVisible();
  await adminPage.getByRole('button', { name: 'New SAT' }).first().click();
  await adminPage.getByLabel('SAT exam name').fill(examTitle);
  await adminPage.getByRole('button', { name: 'Create' }).click();
  await expect(adminPage).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i, { timeout: 30_000 });

  await adminPage.getByRole('button', { name: 'More authoring actions' }).click();
  await adminPage.getByRole('menuitem', { name: /Load sample exam/ }).click();
  await expect(adminPage.getByRole('dialog', { name: 'Load sample SAT' })).toBeVisible();
  await adminPage.getByRole('button', { name: 'Load 147 questions' }).click();
  await expect(adminPage.getByText('147 of 147 questions authored')).toBeVisible({ timeout: 90_000 });

  await adminPage.getByRole('button', { name: 'Release' }).click();
  await expect(adminPage).toHaveURL(/\/release$/);
  await adminPage.getByRole('button', { name: 'Publish' }).click();
  const publishDialog = adminPage.getByRole('dialog');
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole('button', { name: 'Publish' }).click();

  await expect(adminPage).toHaveURL(/\/access$/);
  await adminPage.getByRole('button', { name: 'New Link' }).click();
  await adminPage.getByLabel('Student Link name').fill(linkName);
  await adminPage.getByRole('button', { name: /Name \+ email only/i }).click();
  await adminPage.getByRole('button', { name: /Anytime/i }).click();
  await adminPage.getByRole('button', { name: 'Create Link' }).click();
  await expect(adminPage.getByText(linkName).first()).toBeVisible({ timeout: 20_000 });
  const joinHref = await adminPage.getByRole('link', { name: 'Open student page' }).getAttribute('href');
  if (!joinHref) throw new Error('SAT student join URL was not created.');

  const studentContext = await browser.newContext(options.studentContext);
  await stubScreenDetails(studentContext);
  const studentPage = await studentContext.newPage();
  await studentPage.goto(joinHref);
  await expect(studentPage.getByRole('heading', { name: linkName })).toBeVisible();
  await studentPage.getByLabel('Full name').fill(studentName);
  await studentPage.getByLabel('Email').fill(studentEmail);
  await studentPage.getByRole('button', { name: /Continue/i }).click();
  await expect(studentPage).toHaveURL(/\/student\/[0-9a-f-]+\/[^/]+$/i, { timeout: 30_000 });

  const studentRouteParts = new URL(studentPage.url()).pathname.split('/').filter(Boolean);
  const scheduleId = studentRouteParts[1];
  const candidateId = decodeURIComponent(studentRouteParts[2] ?? '');
  if (!scheduleId) throw new Error('SAT student route did not include a schedule id.');
  if (!candidateId) throw new Error('SAT student route did not include a candidate id.');

  await adminPage.goto('/sat/sessions');
  await expect(adminPage.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  const sessionRow = adminPage
    .locator('button')
    .filter({ hasText: examTitle })
    .filter({ hasText: linkName })
    .first();
  await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  await sessionRow.click();
  await expect(adminPage).toHaveURL(new RegExp(`/sat/sessions/${scheduleId}$`));
  if (options.startRuntime !== false) {
    await adminPage.getByRole('button', { name: 'Start' }).click();
    await expect(adminPage.getByText('Session started.')).toBeVisible({ timeout: 20_000 });

    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
    await expect(studentPage.locator('input[type="radio"]').first()).toBeVisible({ timeout: 30_000 });
  }

  return { studentContext, studentPage, scheduleId, candidateId };
}
