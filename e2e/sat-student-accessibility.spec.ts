import { expect, test, type Page } from "@playwright/test";

async function openSatHarness(
  page: Page,
  options: { mode?: "reading" | "math"; paused?: boolean; tool?: "calculator" | "reference" } = {}
) {
  const params = new URLSearchParams();
  if (options.mode === "math") params.set("mode", "math");
  if (options.paused) params.set("paused", "1");
  if (options.tool) params.set("tool", options.tool);
  await page.goto(`/__dev/sat-accessibility${params.size ? `?${params.toString()}` : ""}`);
  await expect(page.getByTestId("sat-exam-shell")).toBeVisible();
}

async function expectVisibleButtonsAtLeast44(page: Page) {
  const failures = await page.locator(".sat-ui button:not([disabled])").evaluateAll((buttons) =>
    buttons.flatMap((button) => {
      const element = button as HTMLElement;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === "hidden")
        return [];
      return rect.width + 0.01 >= 44 && rect.height + 0.01 >= 44
        ? []
        : [
            {
              name: element.getAttribute("aria-label") || element.textContent?.trim() || "button",
              width: rect.width,
              height: rect.height,
            },
          ];
    })
  );
  expect(failures).toEqual([]);
}

async function expectButtonsDoNotOverlap(page: Page, scopeSelector: string) {
  const overlaps = await page.locator(`${scopeSelector} button`).evaluateAll((buttons) => {
    const visible = buttons
      .map((button) => ({
        name: button.getAttribute("aria-label") || button.textContent?.trim() || "button",
        rect: (button as HTMLElement).getBoundingClientRect(),
        style: getComputedStyle(button),
      }))
      .filter(
        ({ rect, style }) => rect.width > 0 && rect.height > 0 && style.visibility !== "hidden"
      );
    const failures: string[] = [];
    for (let left = 0; left < visible.length; left += 1) {
      for (let right = left + 1; right < visible.length; right += 1) {
        const a = visible[left]!;
        const b = visible[right]!;
        const overlapWidth =
          Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const overlapHeight =
          Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (overlapWidth > 1 && overlapHeight > 1) failures.push(`${a.name} overlaps ${b.name}`);
      }
    }
    return failures;
  });
  expect(overlaps).toEqual([]);
}

test.describe("SAT student accessibility and layout", () => {
  test("regular iPad geometry preserves 44px controls and visible radio focus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1194, height: 834 });
    await openSatHarness(page);
    await expectVisibleButtonsAtLeast44(page);

    const firstRadio = page.getByRole("radio", { name: /Option A.*Tree cover can affect heat/i });
    const inputId = await firstRadio.getAttribute("id");
    expect(inputId).toBeTruthy();
    await firstRadio.focus();
    const answerSurface = page.locator(`label[for="${inputId}"]`);
    await expect(answerSurface).toBeVisible();
    await expect
      .poll(async () => answerSurface.evaluate((element) => getComputedStyle(element).outlineWidth))
      .not.toBe("0px");

    await page.keyboard.press("ArrowDown");
    await expect(page.locator('input[type="radio"]').nth(1)).toBeChecked();
  });

  test("directions and notes use accessible popup semantics and return focus", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSatHarness(page);

    const directions = page.getByRole("button", { name: "Directions" });
    await directions.click();
    await expect(directions).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("dialog", { name: "Directions" })).toBeVisible();
    await page.mouse.click(1000, 740);
    await expect(page.getByRole("dialog", { name: "Directions" })).toHaveCount(0);

    const notes = page.getByRole("button", { name: "Notes" });
    await notes.click();
    const notesDialog = page.getByRole("dialog", { name: "Notes" });
    await expect(notesDialog).toBeVisible();
    const noteField = page.getByRole("textbox", { name: "Note for this question" });
    await expect(noteField).toBeFocused();
    await noteField.fill("Recheck this question");
    await page.keyboard.press("Escape");
    await expect(notesDialog).toHaveCount(0);
    await expect(notes).toBeFocused();

    await notes.click();
    await expect(noteField).toHaveValue("Recheck this question");
    await page.getByRole("button", { name: "Close notes and save changes" }).click();
  });

  test("regular SAT navigator is anchored above the footer without hiding the exam", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 982, height: 736 });
    await openSatHarness(page);

    const trigger = page.getByRole("button", { name: /open question navigator/i });
    await trigger.click();
    const navigator = page.getByRole("dialog", {
      name: /Section 1: Reading and Writing Questions/i,
    });
    await expect(navigator).toHaveAttribute("data-sat-navigator-presentation", "anchored");
    await expect(navigator).not.toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".sat-dialog-backdrop")).toHaveCount(0);
    await expect(
      page.getByText(/Several researchers examined how urban tree cover/i)
    ).toBeVisible();

    const navBox = await navigator.boundingBox();
    const footerBox = await page.locator(".sat-exam-footer").boundingBox();
    expect(navBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(footerBox!.y + 2);
    expect(navBox!.y).toBeGreaterThan(90);

    const firstRadio = page.getByRole("radio", { name: /Option A.*Tree cover can affect heat/i });
    const inputId = await firstRadio.getAttribute("id");
    expect(inputId).toBeTruthy();
    await page.locator(`label[for="${inputId}"]`).click();
    await expect(navigator).toHaveCount(0);
    await expect(firstRadio).toBeChecked();
  });

  test("landscape iPad keeps calculator as a floating utility window", async ({ page }) => {
    await page.setViewportSize({ width: 982, height: 736 });
    await openSatHarness(page, { mode: "math" });
    await page.getByRole("button", { name: "Calculator" }).click();
    const tool = page.locator("[data-sat-tool-window]");
    await expect(tool).toHaveAttribute("data-sat-tool-presentation", "floating");
    const box = await tool.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThan(982);
    expect(box!.height).toBeLessThan(736);
    await expectVisibleButtonsAtLeast44(page);
  });

  test("Calculator is fully prewarmed before first open and reveals the same ready Desmos frames", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSatHarness(page, { mode: "math" });

    const desmos = page.locator('[data-sat-trusted-tool="desmos"]');
    await expect(desmos).toHaveAttribute("data-desmos-both-modes-ready", "true", {
      timeout: 20_000,
    });
    const scientific = page.getByTitle(
      "Desmos scientific calculator, College Board testing version"
    );
    const graphing = page.getByTitle("Desmos graphing calculator, College Board testing version");
    await expect(scientific).toHaveCount(1);
    await expect(graphing).toHaveCount(1);
    await scientific.evaluate((element) => element.setAttribute("data-prewarm-node", "scientific"));
    await graphing.evaluate((element) => element.setAttribute("data-prewarm-node", "graphing"));
    await expect(page.locator("[data-desmos-loading]")).toHaveCount(0);

    await page.getByRole("button", { name: "Calculator" }).click();
    const calculator = page.getByRole("dialog", { name: "Calculator" });
    await expect(calculator).toBeVisible();
    await expect(desmos).toBeVisible();
    await expect(desmos).toHaveAttribute("data-desmos-ready", "true");
    await expect(scientific).toHaveAttribute("data-prewarm-node", "scientific");
    await expect(calculator.locator("[data-desmos-loading]")).toHaveCount(0);

    await page.getByRole("button", { name: "Graphing" }).click();
    await expect(desmos).toHaveAttribute("data-desmos-ready", "true");
    await expect(graphing).toHaveAttribute("data-prewarm-node", "graphing");
    await expect(calculator.locator("[data-desmos-loading]")).toHaveCount(0);
  });

  test("narrow iPad windows keep floating tools until compact width is genuinely required", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await openSatHarness(page, { mode: "math" });
    await page.getByRole("button", { name: "Calculator" }).click();
    const calculator = page.getByRole("dialog", { name: "Calculator" });
    await expect(calculator).toHaveAttribute("data-sat-tool-presentation", "floating");
    await page.getByRole("button", { name: "Close Calculator" }).click();

    await page.setViewportSize({ width: 639, height: 900 });
    await page.getByRole("button", { name: "Calculator" }).click();
    await expect(calculator).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
  });

  test("floating calculator resizes directly from its border and corners", async ({ page }) => {
    await page.setViewportSize({ width: 1194, height: 834 });
    await openSatHarness(page, { mode: "math" });
    await page.getByRole("button", { name: "Calculator" }).click();

    const tool = page.locator("[data-sat-tool-window]");
    await expect(tool).toHaveAttribute("data-sat-tool-resizable", "true");
    const before = await tool.boundingBox();
    expect(before).not.toBeNull();

    const southeast = page.locator('[data-sat-resize-handle="se"]');
    const firstHandle = await southeast.boundingBox();
    expect(firstHandle).not.toBeNull();
    await page.mouse.move(
      firstHandle!.x + firstHandle!.width / 2,
      firstHandle!.y + firstHandle!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(firstHandle!.x - 110, firstHandle!.y - 90, { steps: 6 });
    await page.mouse.up();

    const smaller = await tool.boundingBox();
    expect(smaller).not.toBeNull();
    expect(smaller!.width).toBeLessThan(before!.width - 70);
    expect(smaller!.height).toBeLessThan(before!.height - 60);

    const secondHandle = await southeast.boundingBox();
    expect(secondHandle).not.toBeNull();
    await page.mouse.move(
      secondHandle!.x + secondHandle!.width / 2,
      secondHandle!.y + secondHandle!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(secondHandle!.x + 90, secondHandle!.y + 70, { steps: 6 });
    await page.mouse.up();

    const larger = await tool.boundingBox();
    expect(larger).not.toBeNull();
    expect(larger!.width).toBeGreaterThan(smaller!.width + 60);
    expect(larger!.height).toBeGreaterThan(smaller!.height + 45);
    expect(larger!.x + larger!.width).toBeLessThanOrEqual(1194 - 15);
    expect(larger!.y + larger!.height).toBeLessThanOrEqual(834 - 15);
  });

  test("dark title bar resize grip resizes Calculator and Reference Sheet on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1194, height: 834 });
    await openSatHarness(page, { mode: "math" });

    const resizeFromTitleBar = async (toolName: "Calculator" | "Reference Sheet") => {
      const dialog = page.getByRole("dialog", { name: toolName });
      const grip = dialog.locator("[data-sat-titlebar-resize-handle]");
      await expect(grip).toBeVisible();
      const before = await dialog.boundingBox();
      const gripBox = await grip.boundingBox();
      expect(before).not.toBeNull();
      expect(gripBox).not.toBeNull();

      await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        gripBox!.x + gripBox!.width / 2,
        gripBox!.y + gripBox!.height / 2 + 90,
        { steps: 6 }
      );
      await page.mouse.up();

      const after = await dialog.boundingBox();
      expect(after).not.toBeNull();
      expect(after!.y).toBeGreaterThan(before!.y + 55);
      expect(after!.height).toBeLessThan(before!.height - 55);
      expect(after!.y + after!.height).toBeCloseTo(before!.y + before!.height, 0);
    };

    await page.getByRole("button", { name: "Calculator" }).click();
    await page.getByRole("button", { name: "Graphing" }).click();
    await resizeFromTitleBar("Calculator");
    await expect(
      page.getByTitle("Desmos graphing calculator, College Board testing version")
    ).toBeVisible();
    await page.getByRole("button", { name: "Close Calculator" }).click();

    await page.getByRole("button", { name: "Reference" }).click();
    await resizeFromTitleBar("Reference Sheet");
    await page.getByRole("button", { name: "Close Reference Sheet" }).click();
  });

  test("compact geometry uses resizable modal sheets before full-screen promotion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSatHarness(page, { mode: "math" });

    await page.getByRole("button", { name: "Directions" }).click();
    await expect(page.getByRole("dialog", { name: "Directions" })).toHaveAttribute(
      "aria-modal",
      "true"
    );
    await page.getByRole("button", { name: "Close directions" }).click();

    await page.getByRole("button", { name: "Calculator" }).click();
    const calculator = page.getByRole("dialog", { name: "Calculator" });
    await expect(calculator).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    await expect(calculator).toHaveAttribute("data-sat-tool-detent", "large");
    await expect(calculator).toHaveAttribute("data-sat-tool-resizable", "true");
    const sheetBox = await calculator.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.height).toBeLessThan(844);
    expect(sheetBox!.y).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Expand Calculator to full screen" }).click();
    await expect(calculator).toHaveAttribute("data-sat-tool-presentation", "compact-fullscreen");
    await page.getByRole("button", { name: "Restore Calculator size" }).click();
    await expect(calculator).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    await page.getByRole("button", { name: "Close Calculator" }).click();

    await page.getByRole("button", { name: "Reference" }).click();
    const reference = page.getByRole("dialog", { name: "Reference Sheet" });
    await expect(reference).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    await expect(reference).toHaveAttribute("data-sat-tool-resizable", "true");
    await page.getByRole("button", { name: "Close Reference Sheet" }).click();

    const questionPrompt = page.getByText("If 3x + 5 = 20, what is the value of x?");
    const promptBeforeNavigator = await questionPrompt.boundingBox();
    expect(promptBeforeNavigator).not.toBeNull();

    await page.getByRole("button", { name: /open question navigator/i }).click();
    const compactNavigator = page.getByRole("dialog", { name: /Section 2: Math Questions/i });
    await expect(compactNavigator).toHaveAttribute("data-sat-navigator-presentation", "compact");
    await expect(compactNavigator).not.toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".sat-dialog-backdrop")).toHaveCount(0);
    await expect(page.locator('[data-sat-navigator-anchor="footer"]')).toBeVisible();
    await expect(questionPrompt).toBeVisible();
    const promptAfterNavigator = await questionPrompt.boundingBox();
    expect(promptAfterNavigator).toEqual(promptBeforeNavigator);

    const navigatorBox = await compactNavigator.boundingBox();
    const footerBox = await page.locator(".sat-exam-footer").boundingBox();
    expect(navigatorBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(navigatorBox!.y).toBeGreaterThan(0);
    await expect
      .poll(
        async () => {
          const currentNavigatorBox = await compactNavigator.boundingBox();
          const currentFooterBox = await page.locator(".sat-exam-footer").boundingBox();
          if (!currentNavigatorBox || !currentFooterBox) return Number.POSITIVE_INFINITY;
          return currentNavigatorBox.y + currentNavigatorBox.height - (currentFooterBox.y + 2);
        },
        { timeout: 1_000 },
      )
      .toBeLessThanOrEqual(0);
    await expectVisibleButtonsAtLeast44(page);
  });

  test("proctor pause removes the cross-origin calculator from keyboard interaction", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSatHarness(page, { mode: "math", paused: true, tool: "calculator" });

    const paused = page.getByRole("alertdialog", { name: "Your timer is paused" });
    await expect(paused).toBeVisible();
    await expect(paused).toBeFocused();
    const frame = page.getByTitle("Desmos scientific calculator, College Board testing version");
    await expect(frame).toHaveAttribute("tabindex", "-1");
    await expect(frame).toHaveAttribute("inert", "");
    const tool = page.locator("[data-sat-tool-window]");
    await expect(tool).toHaveAttribute("inert", "");
    await expect(tool).toHaveAttribute("data-sat-tool-interaction-disabled", "true");
    await expect(tool.locator("[data-sat-tool-close]")).toBeDisabled();

    await page.keyboard.press("Tab");
    await expect(paused).toBeFocused();
    await expect(page.getByTestId("sat-exam-shell")).toHaveAttribute("inert", "");
  });

  test("SAT chrome uses system UI typography and preserves safe-area bounds", async ({ page }) => {
    await page.setViewportSize({ width: 1194, height: 834 });
    await openSatHarness(page, { mode: "math" });
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--student-safe-left", "24px");
      document.documentElement.style.setProperty("--student-safe-right", "18px");
      document.documentElement.style.setProperty("--student-safe-top", "12px");
      document.documentElement.style.setProperty("--student-safe-bottom", "10px");
    });

    const shellFamily = await page
      .getByTestId("sat-exam-shell")
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(shellFamily).not.toMatch(/Inter|JetBrains/i);
    const timer = page.getByText("27:14");
    const timerFamily = await timer.evaluate((element) => getComputedStyle(element).fontFamily);
    expect(timerFamily).not.toMatch(/JetBrains/i);

    await page.getByRole("button", { name: "Calculator" }).click();
    const box = await page.locator("[data-sat-tool-window]").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(40);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1194 - 18 - 15);
  });

  test("forced colors and reduced motion retain semantic state without animation dependence", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "forced-colors emulation is asserted in Chromium"
    );
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSatHarness(page, { mode: "math" });

    const accent = await page
      .getByTestId("sat-exam-shell")
      .evaluate((element) => getComputedStyle(element).getPropertyValue("--sat-accent").trim());
    expect(accent).toBeTruthy();
    await page.getByRole("button", { name: "Calculator" }).click();
    const spinner = page.locator('[role="status"] .animate-spin').first();
    if (await spinner.count()) {
      const duration = await spinner.evaluate(
        (element) => getComputedStyle(element).animationDuration
      );
      const parsedDuration = Number.parseFloat(duration);
      const seconds = Number.isFinite(parsedDuration)
        ? duration.endsWith("ms")
          ? parsedDuration / 1000
          : parsedDuration
        : 0;
      expect(seconds).toBeLessThanOrEqual(0.0001);
    }
  });

  test("mobile and iPad orientation matrix stays contained and touch-safe", async ({ page }) => {
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 639, height: 900 },
      { width: 640, height: 900 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await openSatHarness(page, { mode: "math" });
      const geometry = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
      await expectButtonsDoNotOverlap(page, ".sat-exam-topbar");
      await expectButtonsDoNotOverlap(page, ".sat-exam-footer");
      await expectVisibleButtonsAtLeast44(page);
    }
  });

  test("320px mobile chrome keeps every essential control reachable without overlap", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openSatHarness(page, { mode: "math" });

    const geometry = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
    await expectButtonsDoNotOverlap(page, ".sat-exam-topbar");
    await expectButtonsDoNotOverlap(page, ".sat-exam-footer");
    await expectVisibleButtonsAtLeast44(page);
    await expect(page.getByText("Accessibility Candidate")).toBeHidden();
    await expect(page.getByRole("button", { name: "Calculator" })).toBeVisible();
    await expect(page.getByRole("button", { name: /open question navigator/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  });

  test("actual 200 percent SAT text enlargement reflows without horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSatHarness(page, { mode: "math" });
    await page.addStyleTag({
      content: `.sat-ui {
        --sat-type-body: 2.125rem;
        --sat-type-control-primary: 1.875rem;
        --sat-type-control-secondary: 1.75rem;
        --sat-type-metadata: 1.625rem;
        --sat-type-timer: 2.5rem;
        --sat-type-input: 2.25rem;
        --sat-type-reference: 2rem;
      }`,
    });

    const bodySize = await page
      .locator(".sat-type-body")
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(bodySize).toBeGreaterThanOrEqual(33);
    const geometry = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
    await expectButtonsDoNotOverlap(page, ".sat-exam-topbar");
    await expectButtonsDoNotOverlap(page, ".sat-exam-footer");
    await expectVisibleButtonsAtLeast44(page);
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  });

  test("Reading preferences apply live, preserve answers, persist across reload, and reset cleanly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSatHarness(page, { mode: "math" });

    const firstRadio = page.getByRole("radio", { name: /Option A.*3/i });
    const inputId = await firstRadio.getAttribute("id");
    expect(inputId).toBeTruthy();
    await page.locator(`label[for="${inputId}"]`).click();
    await expect(firstRadio).toBeChecked();

    await page.getByRole("button", { name: "Reference" }).click();
    const referenceDialog = page.getByRole("dialog", { name: "Reference Sheet" });
    const referenceFormula = referenceDialog.locator(".sat-type-reference").first();
    const referenceDiagramLabel = referenceDialog.locator("svg text").first();
    const referenceBaseline = {
      formulaSize: await referenceFormula.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize)
      ),
      labelSize: await referenceDiagramLabel.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize)
      ),
    };
    await page.getByRole("button", { name: "Close Reference Sheet" }).click();

    await page.getByRole("button", { name: "Reading" }).click();
    const reading = page.getByRole("dialog", { name: "Reading" });
    await expect(reading).toContainText("Changes only how the exam looks.");
    for (let step = 0; step < 5; step += 1) {
      await reading.getByRole("button", { name: "Increase text size" }).click();
    }
    await reading.getByRole("button", { name: "Relaxed" }).click();
    await expect(reading).toContainText("200%");
    await reading.getByRole("button", { name: "Close reading options" }).click();

    const prompt = page.getByText("If 3x + 5 = 20, what is the value of x?");
    const typography = await prompt.evaluate((element) => {
      const style = getComputedStyle(element.closest(".sat-type-body") ?? element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    });
    expect(typography.fontSize).toBeGreaterThanOrEqual(33);
    expect(typography.lineHeight / typography.fontSize).toBeGreaterThanOrEqual(1.8);
    await expect(firstRadio).toBeChecked();

    await page.getByRole("button", { name: "Notes" }).click();
    const noteField = page.getByRole("textbox", { name: "Note for this question" });
    const noteSize = await noteField.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    expect(noteSize).toBeGreaterThanOrEqual(29);
    await page.getByRole("button", { name: "Close notes and save changes" }).click();

    await page.getByRole("button", { name: "Reference" }).click();
    const referenceAfterReading = {
      formulaSize: await referenceFormula.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize)
      ),
      labelSize: await referenceDiagramLabel.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize)
      ),
    };
    expect(referenceAfterReading.formulaSize).toBeCloseTo(referenceBaseline.formulaSize, 4);
    expect(referenceAfterReading.labelSize).toBeCloseTo(referenceBaseline.labelSize, 4);
    await page.getByRole("button", { name: "Close Reference Sheet" }).click();

    await page.reload();
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible();
    const persistedSize = await page
      .locator(".sat-reading-surface .sat-type-body")
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(persistedSize).toBeGreaterThanOrEqual(33);

    await page.getByRole("button", { name: "Reading" }).click();
    const persistedReading = page.getByRole("dialog", { name: "Reading" });
    await expect(persistedReading).toContainText("200%");
    await persistedReading.getByRole("button", { name: "Reset" }).click();
    await persistedReading.getByRole("button", { name: "Close reading options" }).click();
    const resetSize = await page
      .locator(".sat-reading-surface .sat-type-body")
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(resetSize).toBeLessThan(18);
  });

  test("Reading text at 200 percent stays contained across phone and iPad geometry", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openSatHarness(page);
    await page.getByRole("button", { name: "Reading" }).click();
    const reading = page.getByRole("dialog", { name: "Reading" });
    for (let step = 0; step < 5; step += 1) {
      await reading.getByRole("button", { name: "Increase text size" }).click();
    }
    await reading.getByRole("button", { name: "Close reading options" }).click();

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
      await expectButtonsDoNotOverlap(page, ".sat-exam-topbar");
      await expectButtonsDoNotOverlap(page, ".sat-exam-footer");
      await expectVisibleButtonsAtLeast44(page);
      const size = await page
        .locator(".sat-reading-surface .sat-type-body")
        .first()
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(size).toBeGreaterThanOrEqual(33);
    }

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: /open question navigator/i }).click();
    await expect(
      page.getByRole("dialog", { name: /Reading and Writing Questions/i })
    ).toBeVisible();
    const navGeometry = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(navGeometry.scrollWidth).toBeLessThanOrEqual(navGeometry.innerWidth + 1);
  });

  test("passage and question balance supports keyboard and pointer direct manipulation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSatHarness(page);
    const divider = page.getByRole("slider", { name: "Passage and question width" });
    await expect(divider).toHaveAttribute("aria-valuenow", "50");
    await divider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(divider).toHaveAttribute("aria-valuenow", "55");

    await page.reload();
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible();
    const persistedDivider = page.getByRole("slider", { name: "Passage and question width" });
    await expect(persistedDivider).toHaveAttribute("aria-valuenow", "55");

    const workspace = page.locator("[data-sat-reading-split]");
    const workspaceBox = await workspace.boundingBox();
    const dividerBox = await persistedDivider.boundingBox();
    expect(workspaceBox).not.toBeNull();
    expect(dividerBox).not.toBeNull();
    await page.mouse.move(
      dividerBox!.x + dividerBox!.width / 2,
      dividerBox!.y + dividerBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      workspaceBox!.x + workspaceBox!.width * 0.6,
      dividerBox!.y + dividerBox!.height / 2,
      { steps: 5 }
    );
    await page.mouse.up();
    await expect(persistedDivider).toHaveAttribute("aria-valuenow", "60");

    await persistedDivider.focus();
    await page.keyboard.press("Home");
    await expect(persistedDivider).toHaveAttribute("aria-valuenow", "38");
  });

  test("real touch can adjust passage and question balance", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "touch-chromium",
      "raw touch input is asserted in the touch-enabled Chromium project"
    );
    await page.setViewportSize({ width: 768, height: 1024 });
    await openSatHarness(page);
    const divider = page.getByRole("slider", { name: "Passage and question width" });
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();
    const cdp = await context.newCDPSession(page);
    const x = Math.round(dividerBox!.x + dividerBox!.width / 2);
    const y = Math.round(dividerBox!.y + Math.min(120, dividerBox!.height / 2));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 70, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(divider).toHaveAttribute("aria-valuenow", /5[5-9]|6[0-2]/);
  });

  test("short landscape geometry promotes tools directly to full screen", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openSatHarness(page, { mode: "math" });
    await page.getByRole("button", { name: "Calculator" }).click();

    const tool = page.locator("[data-sat-tool-window]");
    await expect(tool).toHaveAttribute("data-sat-tool-presentation", "compact-fullscreen");
    await expect(tool).toHaveAttribute("data-sat-tool-detent", "full");
    await expect(tool).not.toHaveAttribute("data-sat-tool-resizable");
  });

  test("real touch drag snaps calculator and reference sheets between compact detents", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "touch-chromium",
      "raw touch input is asserted in the touch-enabled Chromium project"
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await openSatHarness(page, { mode: "math" });
    const cdp = await context.newCDPSession(page);

    const dragSheetDown = async (
      toolName: "Calculator" | "Reference Sheet",
      finish: "end" | "cancel" = "end"
    ) => {
      const handle = page
        .getByRole("dialog", { name: toolName })
        .locator("[data-sat-titlebar-resize-handle][data-sat-compact-resize-handle]");
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      const x = Math.round(box!.x + Math.min(48, box!.width / 2));
      const y = Math.round(box!.y + box!.height / 2);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + 165 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: finish === "cancel" ? "touchCancel" : "touchEnd",
        touchPoints: [],
      });
    };

    await page.getByRole("button", { name: "Calculator" }).click();
    const calculator = page.getByRole("dialog", { name: "Calculator" });
    const calculatorBefore = await calculator.boundingBox();
    await dragSheetDown("Calculator", "cancel");
    await expect(calculator).toHaveAttribute("data-sat-tool-detent", "medium");
    const calculatorAfter = await calculator.boundingBox();
    expect(calculatorBefore).not.toBeNull();
    expect(calculatorAfter).not.toBeNull();
    expect(calculatorAfter!.height).toBeLessThan(calculatorBefore!.height - 80);
    await page.getByRole("button", { name: "Close Calculator" }).click();

    await page.getByRole("button", { name: "Reference" }).click();
    const reference = page.getByRole("dialog", { name: "Reference Sheet" });
    const referenceBefore = await reference.boundingBox();
    await dragSheetDown("Reference Sheet");
    await expect(reference).toHaveAttribute("data-sat-tool-detent", "medium");
    const referenceAfter = await reference.boundingBox();
    expect(referenceBefore).not.toBeNull();
    expect(referenceAfter).not.toBeNull();
    expect(referenceAfter!.height).toBeLessThan(referenceBefore!.height - 80);
  });

  test("effective 200 percent layout remains contained and usable", async ({ page }) => {
    await page.setViewportSize({ width: 597, height: 417 });
    await openSatHarness(page, { mode: "math" });
    const geometry = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
    await expect(page.getByRole("button", { name: /open question navigator/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  });

  test("College Board Desmos embed navigates as a real browser frame", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSatHarness(page, { mode: "math" });
    await page.getByRole("button", { name: "Calculator" }).click();
    await page.getByRole("button", { name: "Graphing" }).click();

    const frameElement = page.getByTitle(
      "Desmos graphing calculator, College Board testing version"
    );
    await expect(frameElement).toHaveAttribute(
      "src",
      "https://www.desmos.com/testing/collegeboard/graphing?embed"
    );
    await expect
      .poll(
        () =>
          page
            .frames()
            .some((frame) => frame.url().includes("desmos.com/testing/collegeboard/graphing")),
        { timeout: 20_000 }
      )
      .toBe(true);
  });
  test("SAT frequent controls use non-scaling press feedback and question changes stay visually still", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSatHarness(page, { mode: "math" });

    const next = page.getByRole("button", { name: "Next" });
    const idle = await next.evaluate((element) => {
      const style = getComputedStyle(element);
      return { transform: style.transform, transitionProperty: style.transitionProperty };
    });
    expect(idle.transform).toBe("none");
    expect(idle.transitionProperty).not.toMatch(/transform|scale/);

    const box = await next.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    const pressed = await next.evaluate((element) => ({
      transform: getComputedStyle(element).transform,
      boxShadow: getComputedStyle(element).boxShadow,
    }));
    expect(pressed.transform).toBe("none");
    expect(pressed.boxShadow).not.toBe("none");
    await page.mouse.up();

    const questionSurface = page.locator('[data-sat-question-presentation="instant"]');
    await expect(questionSurface).toHaveCount(1);
    await expect(page.locator("[data-sat-question-transition]")).toHaveCount(0);
    await expect(page.getByLabel("Question 2", { exact: true })).toBeVisible();
    expect(await questionSurface.evaluate((element) => getComputedStyle(element).transform)).toBe(
      "none"
    );

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Question 1", { exact: true })).toBeVisible();
    await expect(page.locator("[data-sat-question-transition]")).toHaveCount(0);

    await page.getByRole("button", { name: /open question navigator/i }).click();
    await page.getByRole("button", { name: /Question 3, unanswered/i }).click();
    await expect(page.getByLabel("Question 3", { exact: true })).toBeVisible();
    await expect(page.locator("[data-sat-question-transition]")).toHaveCount(0);
  });

  test("Reduce Motion preserves semantic updates with the same instant question replacement", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSatHarness(page, { mode: "math" });

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByLabel("Question 2", { exact: true })).toBeVisible();
    await expect(page.locator("[data-sat-question-transition]")).toHaveCount(0);
    const surface = page.locator('[data-sat-question-presentation="instant"]');
    expect(await surface.evaluate((element) => getComputedStyle(element).transform)).toBe("none");

    await page.getByRole("button", { name: "Directions" }).click();
    const directions = page.getByRole("dialog", { name: "Directions" });
    const animationSeconds = await directions.evaluate((element) => {
      const value = getComputedStyle(element).animationDuration;
      const parsed = Number.parseFloat(value);
      return value.endsWith("ms") ? parsed / 1000 : parsed;
    });
    expect(animationSeconds).toBeLessThanOrEqual(0.0001);
  });
});
