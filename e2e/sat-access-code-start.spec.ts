import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { queryDb } from './support/db';
import { stubScreenDetails } from './support/studentUi';
import { buildCompleteSatSample } from '../src/features/exam-authoring/providers/sat/sampleExam';
import type { AssessmentAuthoringShell } from '../src/features/exam-authoring/contracts/assessment';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

async function createCodeSession(browser: Browser, page: Page) {
  // Authoring has its own E2E suite. Seed through real staff APIs so this
  // scenario exercises admission, Internal and delivery rather than depending
  // on authoring-workspace layout or collaboration navigation.
  // Keep the seeded staff cookie on its localhost origin. The frontend proxy
  // forwards these fixture-setup calls to the configured Go API.
  const origin = `http://localhost:${process.env['PLAYWRIGHT_FRONTEND_PORT'] ?? '3000'}`;
  const sessionResponse = await page.request.get(`${origin}/api/v1/auth/session`);
  expect(sessionResponse.ok()).toBe(true);
  const session = await sessionResponse.json();
  const headers = { 'X-CSRF-Token': session.csrfToken };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`${origin}/api/v1${path}`, { data, headers });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const suffix = Date.now().toString(36);
  const exam = await post('/exams', { slug: `sat-code-${suffix}`, title: `SAT code ${suffix}`, examType: 'Academic', providerKey: 'sat', providerExamType: 'SAT', visibility: 'private' });
  const shell = await post(`/assessment-authoring/exams/${exam.id}/shell`, {});
  await post(`/assessment-authoring/exams/${exam.id}/load-sample`, buildCompleteSatSample(shell as AssessmentAuthoringShell));
  const latestResponse = await page.request.get(`${origin}/api/v1/exams/${exam.id}`);
  expect(latestResponse.ok()).toBe(true);
  const latest = await latestResponse.json();
  await post(`/exams/${exam.id}/publish`, { revision: latest.revision, publishScope: 'full' });
  const link = await post(`/assessment-access/exams/${exam.id}/links`, { name: `Code room ${suffix}`, audienceType: 'anyone', accessMode: 'open', availabilityType: 'anytime' });
  const studentContext = await browser.newContext();
  await stubScreenDetails(studentContext);
  const studentPage = await studentContext.newPage();
  const joinHref = `/join/${link.id}`;
  await studentPage.goto(joinHref);
  await studentPage.getByLabel('Full name').fill('First code candidate');
  await studentPage.getByLabel('Email').fill(`first-${suffix}@example.com`);
  await studentPage.getByRole('button', { name: /Continue/i }).click();
  await expect(studentPage.getByRole('heading', { name: 'Enter your exam start code' })).toBeVisible({ timeout: 45_000 });
  await page.goto(`/sat/sessions/${link.scheduleId}`);
  return { studentContext, studentPage, joinHref, scheduleId: link.scheduleId as string };
}

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });
test('starts candidates independently without staff Start and preserves the original start after reload', async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const fixture = await createCodeSession(browser, page);
  const second = await browser.newContext();
  await stubScreenDetails(second);
  const secondPage = await second.newPage();
  try {
    await secondPage.goto(fixture.joinHref);
    await secondPage.getByLabel('Full name').fill('Second code candidate');
    await secondPage.getByLabel('Email').fill(`second-${Date.now()}@example.com`);
    await secondPage.getByRole('button', { name: /Continue/i }).click();
    await expect(secondPage.getByRole('heading', { name: 'Enter your exam start code' })).toBeVisible();
    await expect(fixture.studentPage.getByRole('heading', { name: 'Enter your exam start code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review and start exam' })).toHaveCount(0);
    const codeControl = page.getByLabel('6-digit exam start code', { exact: true });
    await expect(codeControl).toBeVisible();
    const code = (await codeControl.innerText()).trim();
    await page.screenshot({ path: testInfo.outputPath('staff-code-controls.png'), fullPage: true });
    await fixture.studentPage.screenshot({ path: testInfo.outputPath('student-code-entry.png'), fullPage: true });
    expect(code).toMatch(/^[0-9]{6}$/);
    await fixture.studentPage.getByLabel('6-digit exam start code').fill(code);
    await fixture.studentPage.getByRole('button', { name: 'Enter code and begin exam' }).click();
    await expect(fixture.studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
    await expect(secondPage.getByRole('heading', { name: 'Enter your exam start code' })).toBeVisible();
    await expect(secondPage.getByTestId('sat-exam-shell')).toHaveCount(0);
    const before = await queryDb<{ id: string; started_at: unknown }>('SELECT m.id, m.started_at FROM assessment_module_attempts m JOIN student_attempts a ON a.id = m.attempt_id WHERE a.schedule_id = ? AND m.started_at IS NOT NULL', [fixture.scheduleId]);
    expect(before).toHaveLength(1);
    await page.getByRole('button', { name: 'Rotate code', exact: true }).click();
    await page.getByRole('button', { name: 'Replace code', exact: true }).click();
    await fixture.studentPage.reload();
    await expect(fixture.studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
    const after = await queryDb<{ id: string; started_at: unknown }>('SELECT m.id, m.started_at FROM assessment_module_attempts m JOIN student_attempts a ON a.id = m.attempt_id WHERE a.schedule_id = ? AND m.started_at IS NOT NULL', [fixture.scheduleId]);
    expect(after).toEqual(before);
    const replacement = (await page.getByLabel('6-digit exam start code', { exact: true }).innerText()).trim();
    expect(replacement).not.toBe(code);
    await secondPage.getByLabel('6-digit exam start code').fill(replacement);
    await secondPage.getByRole('button', { name: 'Enter code and begin exam' }).click();
    await expect(secondPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
    await secondPage.screenshot({ path: testInfo.outputPath('independently-started-exam.png'), fullPage: true });
    const starts = await queryDb<{ count: number }>('SELECT COUNT(*) AS count FROM student_attempts WHERE schedule_id = ? AND sat_start_code_accepted_at IS NOT NULL', [fixture.scheduleId]);
    expect(Number(starts[0]?.count)).toBe(2);
  } finally {
    await second.close();
    await fixture.studentContext.close();
  }
});

test('recovers a committed start after losing both the response and the first state read', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const fixture = await createCodeSession(browser, page);
  const student = fixture.studentPage;
  let starts = 0;
  let failRecovery = true;
  const deliveryPattern = `**/assessment-delivery/schedules/${fixture.scheduleId}/**`;
  await student.route(deliveryPattern, async (route) => {
    const request = route.request();
    if (request.url().endsWith('/start-with-code')) {
      starts++;
      // Commit on the real API, then lose only the browser response.
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      await response.dispose();
      await route.abort('failed');
    } else if (failRecovery && request.method() === 'GET') {
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  try {
    const codeControl = page.getByLabel('6-digit exam start code', { exact: true });
    await expect(codeControl).toBeVisible();
    const code = (await codeControl.innerText()).trim();
    await student.getByLabel('6-digit exam start code').fill(code);
    const begin = student.getByRole('button', { name: 'Enter code and begin exam' });
    await begin.click();
    await expect(student.getByRole('alert')).toContainText('We could not confirm your start');
    await expect(begin).toBeEnabled();
    await begin.click();
    await expect(begin).toBeEnabled();
    expect(starts).toBe(1);
    const before = await queryDb<{ id: string; started_at: unknown }>('SELECT m.id, m.started_at FROM assessment_module_attempts m JOIN student_attempts a ON a.id = m.attempt_id WHERE a.schedule_id = ? AND m.started_at IS NOT NULL', [fixture.scheduleId]);
    expect(before).toHaveLength(1);
    failRecovery = false;
    await begin.click();
    await expect(student.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
    expect(starts).toBe(1);
    const after = await queryDb<{ id: string; started_at: unknown }>('SELECT m.id, m.started_at FROM assessment_module_attempts m JOIN student_attempts a ON a.id = m.attempt_id WHERE a.schedule_id = ? AND m.started_at IS NOT NULL', [fixture.scheduleId]);
    expect(after).toEqual(before);
  } finally {
    await fixture.studentContext.close();
  }
});
