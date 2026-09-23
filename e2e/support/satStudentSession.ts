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
  // Keep stale authoring selectors from consuming the entire test timeout.
  adminPage.setDefaultTimeout(30_000);
  const suffix = Date.now().toString(36);
  const label = options.label.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const examTitle = `SAT ${label} ${suffix}`;
  const linkName = `SAT ${label} link ${suffix}`;
  const studentName = `SAT ${label} candidate ${suffix}`;
  const studentEmail = `sat-${label}-${suffix}@example.com`;

  await adminPage.goto('/sat/exams');
  await expect(adminPage.getByRole('heading', { name: 'Exam Library' })).toBeVisible();
  const createSatButton = adminPage.getByRole('button', { name: 'Create SAT' }).first();
  await expect(createSatButton).toBeVisible({ timeout: 30_000 });
  await createSatButton.click();
  await adminPage.getByLabel('SAT exam name').fill(examTitle);
  await adminPage.getByRole('button', { name: 'Create' }).click();
  await expect(adminPage).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i, { timeout: 30_000 });

  await adminPage.getByRole('button', { name: 'More authoring actions' }).click();
  await adminPage.getByRole('menuitem', { name: /Load sample exam/ }).click();
  await expect(adminPage.getByRole('dialog', { name: 'Load sample SAT' })).toBeVisible();
  await adminPage.getByRole('button', { name: 'Load 147 questions' }).click();
  await expect(adminPage.getByText('147 of 147 authored')).toBeVisible({ timeout: 90_000 });
  // The count is optimistic room state. Release reads the committed exam
  // projection, so wait for this writer's co-edit acknowledgement before
  // crossing the route durability barrier.
  await expect(adminPage.getByText('Saved', { exact: true }).last()).toBeVisible({ timeout: 90_000 });

  await adminPage.getByRole('button', { name: 'Release' }).click();
  try {
    await expect(adminPage).toHaveURL(/\/release$/, { timeout: 15_000 });
  } catch (error) {
    const details = await adminPage.evaluate(() => ({
      url: window.location.href,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim() ?? ''),
      statuses: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent?.trim() ?? ''),
    }));
    throw new Error(`Could not open SAT release page after the room save barrier: ${JSON.stringify(details)}`, { cause: error });
  }
  await adminPage.getByRole('button', { name: 'Publish' }).click();
  const publishDialog = adminPage.getByRole('dialog');
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole('button', { name: 'Publish Full SAT', exact: true }).click();

  await expect(adminPage).toHaveURL(/\/access$/);
  const newStudentLinkButton = adminPage.getByRole('button', { name: 'New Student Link' }).first();
  await expect(newStudentLinkButton).toBeVisible();
  await newStudentLinkButton.click();
  await adminPage.getByLabel('Student Link name').fill(linkName);
  await adminPage.getByRole('button', { name: /Name \+ email only/i }).click();
  await adminPage.getByRole('button', { name: /Anytime/i }).click();
  await adminPage.getByRole('button', { name: 'Create Link' }).click();
  await expect(adminPage.getByText(linkName).first()).toBeVisible({ timeout: 20_000 });
  const joinHref = await adminPage.getByRole('link', { name: 'Open student page' }).getAttribute('href');
  if (!joinHref) throw new Error('SAT student join URL was not created.');

  const studentContext = await browser.newContext(options.studentContext);
  studentContext.setDefaultTimeout(30_000);
  await stubScreenDetails(studentContext);
  const studentPage = await studentContext.newPage();
  await studentPage.goto(joinHref);
  try {
    await expect(studentPage.getByRole('heading', { name: linkName })).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    const pageText = await studentPage.locator('body').innerText().catch(() => 'Unable to read page text.');
    throw new Error(`Student Link page did not load at ${studentPage.url()}: ${pageText.slice(0, 1_000)}`, { cause: error });
  }
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

  return { studentContext, studentPage, scheduleId, candidateId, joinHref };
}
