import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { createRunningSatSession } from './support/satStudentSession';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * The Bluebook cross-out shape, at the widths a student actually uses.
 *
 * The unit suites pin the state contract (no answer change, question-scoped
 * arm, persisted crossing out). What they cannot see is the SHAPE: the applied
 * choice wears ONE continuous strike across the row — it crosses the letter
 * marker and the answer content on the same center line — the row keeps its
 * normal answer card, and the control in the row's right gutter flips from the
 * choice's letter glyph to the word "Undo". Geometry is measured from the
 * rendered page, so a per-node `line-through` regression, a missing Undo, or a
 * control that pushes the card around would fail here.
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet landscape', width: 1024, height: 768 },
];

async function waitForSatSaved(page: Page) {
  await expect(page.getByTestId('sat-exam-shell')).toHaveAttribute('data-sat-save-state', 'idle', {
    timeout: 30_000,
  });
}

/** Where the row's cut control sits relative to the answer card it belongs to. */
async function measureCutControl(page: Page, letter: string) {
  return page.evaluate((targetLetter) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === `Eliminate option ${targetLetter}`,
    );
    const gutter = button?.parentElement;
    const card = gutter?.parentElement?.querySelector('label');
    if (!button || !card) throw new Error(`Option ${targetLetter} has no cut control beside an answer card.`);
    const buttonBox = button.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    return {
      controlLeft: buttonBox.left,
      controlCenterY: buttonBox.top + buttonBox.height / 2,
      controlWidth: buttonBox.width,
      controlHeight: buttonBox.height,
      cardRight: cardBox.right,
      cardCenterY: cardBox.top + cardBox.height / 2,
    };
  }, letter);
}

/** The crossed-out row's one strike, the marker it must cross, and the content it spans. */
async function measureStrike(page: Page) {
  return page.evaluate(() => {
    const strike = document.querySelector('[data-sat-elimination-line="true"]');
    const card = strike?.closest('label');
    const marker = card?.querySelector('[aria-hidden="true"].rounded-full');
    const content = card?.querySelector('[id$="-content"]');
    if (!(strike instanceof HTMLElement) || !(marker instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      throw new Error('The crossed-out row did not render its strike, letter marker and content.');
    }
    const strikeBox = strike.getBoundingClientRect();
    const markerBox = marker.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    return {
      strikeCenterY: strikeBox.top + strikeBox.height / 2,
      strikeLeft: strikeBox.left,
      strikeRight: strikeBox.right,
      markerCenterY: markerBox.top + markerBox.height / 2,
      markerLeft: markerBox.left,
      markerBox: { width: markerBox.width, height: markerBox.height },
      contentRight: contentBox.right,
    };
  });
}

test.describe('SAT option eliminator cross-out shape', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const viewport of VIEWPORTS) {
    test(`crosses a choice out and back in the real exam shape at ${viewport.name}`, async ({
      page,
      browser,
    }) => {
      const { studentContext, studentPage } = await createRunningSatSession(browser, page, {
        label: `eliminator-${viewport.name}`,
        studentContext: { viewport: { width: viewport.width, height: viewport.height } },
      });
      try {
        await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
        await studentPage.getByRole('button', { name: 'Turn on cross-out mode' }).click();
        await expect(studentPage.getByRole('button', { name: 'Turn off cross-out mode' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );

        // Armed: the row's control names the choice it cuts — its letter in the
        // strike circle — never the header's ABC toggle.
        const cut = studentPage.getByRole('button', { name: 'Eliminate option B' });
        await expect(cut).toBeVisible();
        await expect(cut.locator('[data-sat-eliminator-glyph="choice"]')).toHaveText('B');
        await expect(cut.locator('[data-sat-eliminator-glyph="header"]')).toHaveCount(0);
        await expect(studentPage.getByRole('button', { name: 'Turn off cross-out mode' }).locator(
          '[data-sat-eliminator-glyph="header"]',
        )).toHaveCount(1);

        // The control sits in the row's own right gutter: outside the card, on
        // its center line, still a 44px touch target.
        const control = await measureCutControl(studentPage, 'B');
        expect(control.controlLeft, 'cut control sits outside the answer card').toBeGreaterThanOrEqual(
          control.cardRight + 1,
        );
        expect(
          Math.abs(control.controlCenterY - control.cardCenterY),
          'cut control is vertically centered on its card',
        ).toBeLessThanOrEqual(2);
        expect(control.controlWidth).toBeGreaterThanOrEqual(44);
        expect(control.controlHeight).toBeGreaterThanOrEqual(44);

        await cut.click();

        // Applied: no glyph, the visible word "Undo" instead, and the choice was
        // never selected by the act of crossing it out.
        const undo = studentPage.getByRole('button', { name: 'Undo option B' });
        await expect(undo).toBeVisible();
        await expect(undo).toHaveText('Undo');
        await expect(undo).toHaveAttribute('data-sat-cut-choice-state', 'cut');
        await expect(undo.locator('[data-sat-eliminator-glyph]')).toHaveCount(0);
        await expect(studentPage.getByRole('radio', { name: /Option B/ })).not.toBeChecked();
        await expect(studentPage.getByRole('radio', { name: /Option B/ })).toHaveAccessibleDescription(
          /eliminated/i,
        );
        await expect(studentPage.locator('input[type="radio"]:checked')).toHaveCount(0);

        // ONE strike across the row, crossing the letter marker and the content.
        await expect(studentPage.locator('[data-sat-elimination-line="true"]')).toHaveCount(1);
        const strike = await measureStrike(studentPage);
        expect(
          Math.abs(strike.strikeCenterY - strike.markerCenterY),
          'the strike crosses the letter marker on its center line',
        ).toBeLessThanOrEqual(1);
        expect(strike.strikeLeft, 'the strike starts at the marker').toBeLessThanOrEqual(strike.markerLeft + 1);
        expect(strike.strikeRight, 'the strike spans the answer content').toBeGreaterThanOrEqual(
          strike.contentRight - 1,
        );
        expect(strike.strikeRight - strike.strikeLeft).toBeGreaterThan(strike.markerBox.width * 2);

        // Navigating away is not an escape hatch: the response owns the state,
        // so the crossing out comes back with the question.
        await waitForSatSaved(studentPage);
        await studentPage.getByRole('button', { name: 'Next question' }).click();
        await expect(studentPage.getByRole('button', { name: 'Undo option B' })).toHaveCount(0);
        await studentPage.getByRole('button', { name: 'Previous question' }).click();
        await expect(studentPage.getByRole('button', { name: 'Undo option B' })).toBeVisible();
        await expect(studentPage.locator('[data-sat-elimination-line="true"]')).toHaveCount(1);
        // The arm is question-scoped; it came back with the question too.
        await expect(studentPage.getByRole('button', { name: 'Turn off cross-out mode' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );

        // And a reload of the same attempt restores both, not just the arm.
        await waitForSatSaved(studentPage);
        await studentPage.reload({ waitUntil: 'domcontentloaded' });
        await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
        await expect(studentPage.getByRole('button', { name: 'Undo option B' })).toBeVisible({ timeout: 30_000 });
        await expect(studentPage.locator('[data-sat-elimination-line="true"]')).toHaveCount(1);
        await expect(studentPage.getByRole('radio', { name: /Option B/ })).toHaveAccessibleDescription(
          /eliminated/i,
        );

        // Undo restores the choice — and still answers nothing.
        await studentPage.getByRole('button', { name: 'Undo option B' }).click();
        await expect(studentPage.locator('[data-sat-elimination-line="true"]')).toHaveCount(0);
        await expect(studentPage.getByRole('button', { name: 'Undo option B' })).toHaveCount(0);
        const restored = studentPage.getByRole('button', { name: 'Eliminate option B' });
        await expect(restored).toBeVisible();
        await expect(restored.locator('[data-sat-eliminator-glyph="choice"]')).toHaveText('B');
        await expect(studentPage.locator('input[type="radio"]:checked')).toHaveCount(0);
        await waitForSatSaved(studentPage);
      } finally {
        await studentContext.close();
      }
    });
  }
});
