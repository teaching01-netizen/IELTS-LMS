import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { stubScreenDetails } from './support/studentUi';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

async function selectFirstStimulusText(page: Page) {
  await page.locator('[data-sat-annotation-region="stimulus"]').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && (node.nodeValue ?? '').trim().length < 4) node = walker.nextNode();
    if (!node) throw new Error('No selectable SAT stimulus text was rendered.');

    const textNode = node as Text;
    const value = textNode.data.trim();
    const start = textNode.data.indexOf(value);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + Math.min(value.length, 12));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    textNode.parentElement?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
}

async function waitForSatSaved(page: Page) {
  await expect(page.getByTestId('sat-footer-save-indicator')).toHaveAttribute(
    'data-sat-save-state',
    'idle',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('sat-footer-save-indicator')).toContainText('Saved');
}

async function createLiveSatSession(page: Page, browser: Browser) {
  const stamp = Date.now().toString(36);
  const examTitle = `SAT durability recovery ${stamp}`;
  const linkName = `SAT durability link ${stamp}`;
  const studentName = `SAT durability candidate ${stamp}`;
  const studentEmail = `sat-durability-${stamp}@example.com`;

  await page.goto('/sat/exams');
  await expect(page.getByRole('heading', { name: 'Exam Library' })).toBeVisible();
  await page.getByRole('button', { name: 'New SAT' }).first().click();
  await page.getByLabel('SAT exam name').fill(examTitle);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i, { timeout: 30_000 });

  await page.getByRole('button', { name: 'More authoring actions' }).click();
  await page.getByRole('menuitem', { name: /Load sample exam/ }).click();
  await expect(page.getByRole('dialog', { name: 'Load sample SAT' })).toBeVisible();
  await page.getByRole('button', { name: 'Load 147 questions' }).click();
  await expect(page.getByText('147 of 147 questions authored')).toBeVisible({ timeout: 90_000 });

  await page.getByRole('button', { name: 'Release' }).click();
  await expect(page).toHaveURL(/\/release$/);
  await page.getByRole('button', { name: 'Publish' }).click();
  const publishDialog = page.getByRole('dialog');
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole('button', { name: 'Publish' }).click();

  await expect(page).toHaveURL(/\/access$/);
  await page.getByRole('button', { name: 'New Link' }).click();
  await page.getByLabel('Student Link name').fill(linkName);
  await page.getByRole('button', { name: /Name \+ email only/i }).click();
  await page.getByRole('button', { name: /Anytime/i }).click();
  await page.getByRole('button', { name: 'Create Link' }).click();
  await expect(page.getByText(linkName).first()).toBeVisible({ timeout: 20_000 });
  const joinHref = await page.getByRole('link', { name: 'Open student page' }).getAttribute('href');
  if (!joinHref) throw new Error('SAT student join URL was not created.');

  const studentContext = await browser.newContext();
  await stubScreenDetails(studentContext);
  const studentPage = await studentContext.newPage();
  await studentPage.goto(joinHref);
  await expect(studentPage.getByRole('heading', { name: linkName })).toBeVisible();
  await studentPage.getByLabel('Full name').fill(studentName);
  await studentPage.getByLabel('Email').fill(studentEmail);
  await studentPage.getByRole('button', { name: /Continue/i }).click();
  await expect(studentPage).toHaveURL(/\/student\/[0-9a-f-]+\/[^/]+$/i, { timeout: 30_000 });

  const scheduleId = new URL(studentPage.url()).pathname.split('/').filter(Boolean)[1];
  if (!scheduleId) throw new Error('SAT student route did not include a schedule id.');

  await page.goto('/sat/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  const sessionRow = page
    .locator('button')
    .filter({ hasText: examTitle })
    .filter({ hasText: linkName })
    .first();
  await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  await sessionRow.click();
  await expect(page).toHaveURL(new RegExp(`/sat/sessions/${scheduleId}$`));
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Session started.')).toBeVisible({ timeout: 20_000 });

  await studentPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
  await expect(studentPage.locator('input[type="radio"]').first()).toBeVisible({ timeout: 30_000 });

  return { studentContext, studentPage };
}

test.describe('SAT answer durability recovery', () => {
  test.describe.configure({ timeout: 240_000 });

  test('preserves answer, elimination, and annotation metadata through delayed recovery', async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage } = await createLiveSatSession(page, browser);
    try {
      const radios = studentPage.locator('input[type="radio"]');
      await radios.first().check();

      await studentPage.getByRole('button', { name: 'Turn on cross-out mode' }).click();
      await studentPage.getByRole('button', { name: 'Eliminate option B' }).click();

      await studentPage.getByRole('button', { name: 'Highlight', exact: true }).click();
      await selectFirstStimulusText(studentPage);
      await expect(studentPage.locator('[data-sat-highlight="true"]')).toHaveCount(1);

      await studentPage.getByRole('button', { name: 'Question note' }).click();
      await studentPage.getByRole('textbox', { name: 'Note for this question' }).fill('Keep this evidence.');
      await studentPage.getByRole('button', { name: 'Save and close' }).click();
      await waitForSatSaved(studentPage);

      let delayedRecovery = false;
      await studentPage.route('**/v2/student/attempts/*/responses', async (route) => {
        if (route.request().method() === 'GET' && !delayedRecovery) {
          delayedRecovery = true;
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        await route.continue();
      });

      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(radios.first()).toBeChecked({ timeout: 30_000 });

      await studentPage.getByRole('button', { name: 'Turn on cross-out mode' }).click();
      await expect(studentPage.getByRole('button', { name: 'Restore option B' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(studentPage.locator('[data-sat-highlight="true"]')).toHaveCount(1);

      await studentPage.getByRole('button', { name: 'Question note' }).click();
      await expect(studentPage.getByRole('textbox', { name: 'Note for this question' })).toHaveValue(
        'Keep this evidence.',
      );
      await studentPage.getByRole('button', { name: 'Save and close' }).click();
      await radios.nth(2).check();
      await waitForSatSaved(studentPage);

      // The current Phase 1 scaffold stops at the first real module submit;
      // sat-product-workspace.spec.ts already owns the full branch/result
      // journey. Phase 2 will join these two legs once the SAT fixture is
      // shared instead of authoring a 147-question exam per acceptance test.
      await studentPage.getByRole('button', { name: /Review answers/ }).click();
      await expect(studentPage.getByRole('heading', { name: 'Review your answers' })).toBeVisible();
      await studentPage.getByRole('button', { name: 'Submit module' }).click();
      await expect(studentPage.getByTestId('sat-submit-confirm')).toBeVisible();
      await studentPage.getByRole('button', { name: 'Submit anyway' }).click();
      await expect(studentPage.getByTestId('sat-exam-shell')).not.toBeVisible({ timeout: 30_000 });
    } finally {
      await studentContext.close();
    }
  });
});
