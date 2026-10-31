import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import {
  advanceToSatMathBase,
  findSatMathSprQuestions,
  openSatQuestion,
  openSatReview,
  readStoredSatAnswer,
} from "./support/satSprSession";
import { createRunningSatSession } from "./support/satStudentSession";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * SAT Math SPR edge-case contract, against the real API, worker, and MySQL.
 *
 * The unit suites pin the pure validators; this spec proves the student-visible
 * contract end to end:
 *   - 5/6-character rule stays validation-only (an over-budget paste is never
 *     silently truncated into a different, valid number)
 *   - lookalike glyphs normalize before the durable write
 *   - malformed drafts are preserved, flagged on blur, and stored verbatim
 *   - switching between SPR questions never carries the previous error
 *   - review distinguishes answered / unanswered / needs fixing
 *   - review, reload, correction and clearing all round-trip through the server
 */
test("SAT Math SPR edge cases survive validation, navigation, review and reload", async ({
  page,
  browser,
}) => {
  test.setTimeout(360_000);
  const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
    browser,
    page,
    { label: "spr-edge-cases" }
  );

  try {
    await advanceToSatMathBase(studentPage, scheduleId);
    const questions = await findSatMathSprQuestions(scheduleId);
    expect(questions.length, "the sample Math base module needs at least two SPRs").toBeGreaterThanOrEqual(2);
    const first = questions[0]!;
    const second = questions[1]!;
    expect(first.policy).toBe("strict_v1");
    expect(second.policy).toBe("strict_v1");

    const firstNumber = first.questionNumber;
    const secondNumber = second.questionNumber;
    const stored = (questionId: string) =>
      readStoredSatAnswer(scheduleId, candidateId, questionId);

    await openSatQuestion(studentPage, firstNumber);
    const firstInput = studentPage.getByRole("textbox", { name: "Enter your answer" });
    await expect(firstInput).toBeVisible();

    // Input contract: the field is deliberately bounded far above the legal
    // 5/6 characters so a huge paste cannot reach the outbox, but the legal
    // rule itself is validation-only.
    await expect(firstInput).toHaveAttribute("maxlength", "64");
    await expect(firstInput).toHaveAttribute("inputmode", "text");
    await expect(firstInput).toHaveAttribute("autocomplete", "off");
    await expect(firstInput).toHaveAttribute("spellcheck", "false");

    // Glyph normalization happens before the durable write.
    await firstInput.fill("\u221212.5");
    await expect(firstInput).toHaveValue("-12.5");
    await expect.poll(() => stored(first.id), { timeout: 20_000 }).toBe("-12.5");
    await firstInput.press("Tab");
    await expect(firstInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(studentPage.getByRole("alert")).toHaveCount(0);

    await firstInput.fill("\uFF11\uFF12\uFF0E\uFF15");
    await expect(firstInput).toHaveValue("12.5");
    await expect.poll(() => stored(first.id), { timeout: 20_000 }).toBe("12.5");
    await firstInput.press("Tab");
    await expect(firstInput).not.toHaveAttribute("aria-invalid", "true");

    // A huge paste is bounded, but an over-budget numeric entry is NOT
    // truncated: -123456 must stay seven characters and fail validation.
    await firstInput.fill("1".repeat(100));
    await expect(firstInput).toHaveValue("1".repeat(64));
    await firstInput.press("Tab");
    await expect(firstInput).toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => stored(first.id), { timeout: 20_000 }).toBe("1".repeat(64));

    await firstInput.fill("-123456");
    await expect(firstInput).toHaveValue("-123456");
    await firstInput.press("Tab");
    await expect(firstInput).toHaveAttribute("aria-invalid", "true");
    await expect(firstInput).toHaveValue("-123456");
    await expect.poll(() => stored(first.id), { timeout: 20_000 }).toBe("-123456");

    // Every malformed shape is preserved verbatim, announced on blur, and
    // persisted. None of these may become an answered review item.
    for (const value of ["12%", "1/0", "5.", "1e3", "1/2.3", "123456", "1 1/2"]) {
      await firstInput.fill(value);
      await firstInput.press("Tab");
      await expect(firstInput).toHaveValue(value);
      await expect(firstInput).toHaveAttribute("aria-invalid", "true");
      await expect(studentPage.getByRole("alert")).toBeVisible();
      await expect.poll(() => stored(first.id), { timeout: 20_000 }).toBe(value);
    }

    // Navigator marks the saved malformed answer as needing fixing.
    await studentPage.getByRole("button", { name: /Open question navigator/ }).click();
    const navigator = studentPage.getByRole("dialog", { name: /Questions/ });
    await expect(navigator).toBeVisible();
    const invalidNavigatorItem = navigator.getByRole("button", {
      name: new RegExp(`^Question ${firstNumber}, answer needs fixing`),
    });
    await expect(invalidNavigatorItem).toBeVisible();
    await expect(invalidNavigatorItem).toHaveAttribute("data-sat-navigator-invalid", "true");

    // Jumping to a second SPR must not paint the first question's error.
    await navigator
      .getByRole("button", { name: new RegExp(`^Question ${secondNumber}(?:,|$)`) })
      .click();
    await expect(navigator).toBeHidden();
    const secondInput = studentPage.getByRole("textbox", { name: "Enter your answer" });
    await expect(secondInput).toBeVisible();
    await expect(secondInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(studentPage.getByRole("alert")).toHaveCount(0);

    // Valid shapes are answered (no error) and persist exactly.
    for (const value of ["12", ".5", "3/4", "-12.5", ".3003"]) {
      await secondInput.fill(value);
      await secondInput.press("Tab");
      await expect(secondInput).toHaveValue(value);
      await expect(secondInput).not.toHaveAttribute("aria-invalid", "true");
      await expect(studentPage.getByRole("alert")).toHaveCount(0);
      await expect.poll(() => stored(second.id), { timeout: 20_000 }).toBe(value);
    }
    await secondInput.fill(second.accepted);
    await secondInput.press("Tab");
    await expect(secondInput).not.toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => stored(second.id), { timeout: 20_000 }).toBe(second.accepted);

    // Review: q2 is answered; q1 is not answered and not merely "unanswered".
    await openSatReview(studentPage);
    await expect(studentPage.getByRole("heading", { name: "Review your answers" })).toBeVisible();
    await expect(studentPage.getByText("1 answered", { exact: true })).toBeVisible();
    await expect(studentPage.getByText(/^1 needs fixing$/)).toBeVisible();
    await expect(
      studentPage.getByText(/not in a valid SAT format/i)
    ).toBeVisible();
    await expect(
      studentPage.getByRole("button", { name: `Question ${firstNumber}, answer needs fixing` })
    ).toBeVisible();
    await expect(
      studentPage.getByRole("button", {
        name: new RegExp(`^Question ${secondNumber}, answered`),
      })
    ).toBeVisible();
    await expect(studentPage.getByText(/^\d+ unanswered$/)).toBeVisible();

    // Return to the invalid question from review; the saved text is intact.
    await studentPage
      .getByRole("button", { name: `Question ${firstNumber}, answer needs fixing` })
      .click();
    await expect(firstInput).toHaveValue("1 1/2", { timeout: 45_000 });
    // Validation is deliberately blur-time only on a restored draft; focusing
    // and leaving the field is what announces the stored malformed answer.
    await firstInput.focus();
    await firstInput.press("Tab");
    await expect(firstInput).toHaveAttribute("aria-invalid", "true");

    // Correct it; both SPRs are now answered and nothing needs fixing.
    await firstInput.fill(first.accepted);
    await firstInput.press("Tab");
    await expect(firstInput).not.toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => stored(first.id), { timeout: 20_000 }).toBe(first.accepted);
    await openSatReview(studentPage);
    await expect(studentPage.getByText("2 answered", { exact: true })).toBeVisible();
    await expect(studentPage.getByText(/^\d+ needs? fixing$/)).toHaveCount(0);
    await expect(studentPage.getByText(/not in a valid SAT format/i)).toHaveCount(0);

    // Reload restores both saved answers.
    await studentPage.reload({ waitUntil: "domcontentloaded" });
    await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
    await expect(studentPage.getByRole("textbox", { name: "Enter your answer" })).toHaveValue(
      first.accepted,
      { timeout: 45_000 }
    );
    await openSatQuestion(studentPage, secondNumber);
    await expect(studentPage.getByRole("textbox", { name: "Enter your answer" })).toHaveValue(
      second.accepted,
      { timeout: 45_000 }
    );

    // Clearing an answer returns it to unanswered, not to "needs fixing".
    await openSatQuestion(studentPage, firstNumber);
    await studentPage.getByRole("textbox", { name: "Enter your answer" }).fill("");
    await studentPage.getByRole("textbox", { name: "Enter your answer" }).press("Tab");
    await expect(studentPage.getByRole("textbox", { name: "Enter your answer" })).toHaveValue("");
    await expect
      .poll(() => stored(first.id), { timeout: 20_000 })
      .toBeUndefined();
    await openSatReview(studentPage);
    await expect(studentPage.getByText("1 answered", { exact: true })).toBeVisible();
    await expect(studentPage.getByText(/^\d+ needs? fixing$/)).toHaveCount(0);
    await expect(
      studentPage.getByRole("button", { name: `Question ${firstNumber}, unanswered` })
    ).toBeVisible();
  } finally {
    await studentContext.close();
  }
});
