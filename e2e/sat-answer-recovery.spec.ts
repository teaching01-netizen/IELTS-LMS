import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { createRunningSatSession } from './support/satStudentSession';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * Arm annotation the way the student does: press the labeled top-bar control.
 *
 * Selection only raises the tools in an armed exam, so every flow that marks
 * text starts here. Idempotent, because the mode stays armed across questions.
 */
async function armHighlights(page: Page) {
  const toggle = page.getByRole('button', { name: /^Highlights & Notes/ });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

async function selectFirstStimulusText(page: Page) {
  await armHighlights(page);
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
  // The exam deliberately draws no save state. The durability contract is
  // still observable on the shell's machine-readable attribute, which is the
  // only remaining answer to "has this question's write landed?"
  await expect(page.getByTestId('sat-exam-shell')).toHaveAttribute(
    'data-sat-save-state',
    'idle',
    { timeout: 30_000 },
  );
}

test.describe('SAT answer durability recovery', () => {
  test.describe.configure({ timeout: 240_000 });

  test('shows the last server-saved answer in staff Results after the student closes the exam', async ({ page, browser }) => {
    const { studentContext, studentPage, examTitle, linkName, studentName } = await createRunningSatSession(browser, page, { label: 'staff-answers' });
    try {
      await studentPage.locator('label.sat-answer-choice').first().click();
      await expect(studentPage.locator('input[type="radio"]').first()).toBeChecked();
      await waitForSatSaved(studentPage);
      await studentContext.close();

      await page.goto('/sat/results');
      await page.getByRole('button', { name: new RegExp(examTitle) }).click();
      await page.getByRole('button', { name: new RegExp(linkName) }).click();
      await page.getByRole('button', { name: new RegExp(studentName) }).click();
      await expect(page).toHaveURL(/\/sat\/results\/attempts\/[0-9a-f-]+$/i);
      await expect(page.getByText('1 server-saved answers')).toBeVisible();
      await expect(page.getByText(/Revision [1-9]\d*/)).toBeVisible();
      await expect(page.getByRole('heading', { name: /Question-level responses/ })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Student raw' })).toBeVisible();
      await expect(page.getByText('Unanswered').first()).toBeVisible();
      const refreshStatus = page.getByRole('status').filter({ hasText: 'Checks automatically every 15 seconds while visible' });
      await expect(refreshStatus).toBeVisible();
      await page.waitForResponse((response) =>
        response.url().includes('/v1/results/sat/attempts/')
        && response.url().endsWith('/answers')
        && response.request().method() === 'GET'
        && response.ok(), { timeout: 25_000 });
      await expect(refreshStatus).toContainText('Last checked');
    } finally {
      await studentContext.close();
    }
  });

  test('preserves answer, elimination, and annotation metadata through delayed recovery', async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage } = await createRunningSatSession(browser, page, { label: 'durability' });
    try {
      const radios = studentPage.locator('input[type="radio"]');
      await radios.first().check();

      await studentPage.getByRole('button', { name: 'Turn on cross-out mode' }).click();
      await studentPage.getByRole('button', { name: 'Eliminate option B' }).click();

      // Highlights & Notes is an armed mode: pressing the labeled control lets a
      // selection raise the tools, and the note rides on the mark it was made
      // from.
      await selectFirstStimulusText(studentPage);
      await studentPage
        .getByRole('toolbar', { name: 'Selected text actions' })
        .getByRole('button', { name: 'Highlight Yellow' })
        .click();
      await expect(studentPage.locator('[data-sat-highlight="true"]')).toHaveCount(1);

      // Writing happens in the Notes pane now: choosing Add note marks the words
      // (the same span, so this stays one highlight), opens the pane on that
      // note's card, and puts the caret in its field. There is no Save and no
      // Done — the draft is committed on the way out.
      await selectFirstStimulusText(studentPage);
      await studentPage
        .getByRole('toolbar', { name: 'Selected text actions' })
        .getByRole('button', { name: 'Add note' })
        .click();
      // The field is named for the words it is about, so the test does not have to
      // guess which note it is typing into.
      const noteField = studentPage.getByRole('textbox', { name: /^Note on / });
      await expect(noteField).toBeFocused();
      await noteField.fill('Keep this evidence.');
      await expect(studentPage.locator('[data-sat-note-status="saved"]')).toBeVisible();
      await expect(studentPage.locator('[data-sat-highlight="true"]')).toHaveCount(1);
      // The passage itself now says where that note lives.
      await expect(studentPage.locator('[data-sat-note-marker]')).toHaveCount(1);
      await studentPage.keyboard.press('Escape');
      await expect(studentPage.getByRole('complementary', { name: 'Notes' })).toHaveCount(0);
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
      await expect(studentPage.getByRole('button', { name: 'Undo option B' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(studentPage.locator('[data-sat-highlight="true"]')).toHaveCount(1);
      // Recovered too: the margin dot is derived from the note, so a dot here is
      // the note having survived, not a stale attribute.
      await expect(studentPage.locator('[data-sat-note-marker]')).toHaveCount(1);

      // The recovered note is the note attached to the recovered mark, and it
      // reads back in the one place a note is written.
      await studentPage.locator('[data-sat-highlight="true"]').first().click();
      await studentPage
        .getByRole('toolbar', { name: 'Edit annotation' })
        .getByRole('button', { name: 'Edit note' })
        .click();
      await expect(studentPage.getByRole('complementary', { name: 'Notes' })).toBeVisible();
      await expect(studentPage.getByRole('textbox', { name: /^Note on / })).toHaveValue('Keep this evidence.');
      await studentPage.keyboard.press('Escape');
      await expect(studentPage.getByRole('complementary', { name: 'Notes' })).toHaveCount(0);
      await radios.nth(2).check();
      await waitForSatSaved(studentPage);

      // Review remains available for navigation and state inspection, while
      // module completion stays owned by the server clock.
      await studentPage.getByRole('button', { name: /Review answers/ }).click();
      await expect(studentPage.getByRole('heading', { name: 'Review your answers' })).toBeVisible();
      await expect(studentPage.getByRole('button', { name: 'Submit module', exact: true })).toHaveCount(0);
      await expect(studentPage.getByRole('button', { name: 'Submit anyway', exact: true })).toHaveCount(0);
      await expect(studentPage.getByTestId('sat-submit-confirm')).toHaveCount(0);
      await studentPage.getByRole('button', { name: /Back to question/ }).click();
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible();
    } finally {
      await studentContext.close();
    }
  });
});
