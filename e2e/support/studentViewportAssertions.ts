import { expect, type Page } from '@playwright/test';
import { scanStudentTouchTargets } from './studentUi';

export interface StudentRect {
  readonly x: number;
  readonly y: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface StudentVisualViewportMetrics {
  readonly width: number;
  readonly height: number;
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly scale: number;
  readonly source: 'visualViewport' | 'innerHeight';
}

export interface StudentViewportDiagnostics {
  readonly viewport: StudentVisualViewportMetrics;
  readonly shell: StudentRect;
  readonly header: StudentRect;
  readonly main: StudentRect;
  readonly footer: StudentRect;
  readonly documentScrollWidth: number;
  readonly documentClientWidth: number;
  readonly documentScrollHeight: number;
  readonly documentClientHeight: number;
  readonly shellScrollWidth: number;
  readonly shellClientWidth: number;
  readonly windowScrollX: number;
  readonly windowScrollY: number;
  readonly documentScrollTop: number;
  readonly bodyScrollTop: number;
  readonly layoutMode: string | null;
  readonly orientation: 'portrait' | 'landscape';
  readonly capabilities: {
    readonly hasTouch: boolean;
    readonly primaryPointer: string;
    readonly hasHover: boolean;
  };
}

const GEOMETRY_TOLERANCE_PX = 1;

function formatPixels(value: number): string {
  return `${value.toFixed(2)}px`;
}

function assertAtMost(actual: number, expected: number, message: string): void {
  expect(
    actual,
    `${message}; actual ${formatPixels(actual)}, allowed ${formatPixels(expected)}`,
  ).toBeLessThanOrEqual(expected + GEOMETRY_TOLERANCE_PX);
}

function assertAtLeast(actual: number, expected: number, message: string): void {
  expect(
    actual,
    `${message}; actual ${formatPixels(actual)}, required ${formatPixels(expected)}`,
  ).toBeGreaterThanOrEqual(expected - GEOMETRY_TOLERANCE_PX);
}

async function measureSelector(page: Page, selector: string): Promise<StudentRect> {
  const rect = await page.locator(selector).first().evaluate((element, selectorName) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) {
      throw new Error(`Selector ${selectorName} has an empty layout rectangle`);
    }
    return {
      x: box.x,
      y: box.y,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      left: box.left,
      width: box.width,
      height: box.height,
    } satisfies StudentRect;
  }, selector);
  return rect;
}

export async function measureVisualViewport(page: Page): Promise<StudentVisualViewportMetrics> {
  return page.evaluate(() => {
    const visualViewport = window.visualViewport;
    if (visualViewport) {
      return {
        width: visualViewport.width,
        height: visualViewport.height,
        offsetLeft: visualViewport.offsetLeft,
        offsetTop: visualViewport.offsetTop,
        scale: visualViewport.scale,
        source: 'visualViewport',
      } satisfies StudentVisualViewportMetrics;
    }

    return {
      width: window.innerWidth,
      height: window.innerHeight,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1,
      source: 'innerHeight',
    } satisfies StudentVisualViewportMetrics;
  });
}
export async function waitForStudentViewportHeight(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const [viewport, shell] = await Promise.all([
          measureVisualViewport(page),
          measureShellGeometry(page),
        ]);
        return Math.abs(shell.height - viewport.height) <= GEOMETRY_TOLERANCE_PX;
      },
      {
        timeout: 5_000,
        message: 'Student shell height did not settle to the visual viewport height',
      },
    )
    .toBe(true);
}

export async function measureShellGeometry(page: Page): Promise<StudentRect> {
  return measureSelector(page, '[data-testid="student-exam-shell"]');
}

export async function measureHeaderGeometry(page: Page): Promise<StudentRect> {
  return measureSelector(page, '[data-testid="student-exam-shell"] [role="banner"]');
}

export async function measureMainGeometry(page: Page): Promise<StudentRect> {
  return measureSelector(page, '[data-testid="student-exam-shell"] .student-exam-main');
}

export async function measureFooterGeometry(page: Page): Promise<StudentRect> {
  return measureSelector(page, '[data-testid="student-exam-shell"] .student-exam-footer');
}

export async function measureStudentViewportDiagnostics(page: Page): Promise<StudentViewportDiagnostics> {
  const [viewport, shell, header, main, footer, pageMetrics] = await Promise.all([
    measureVisualViewport(page),
    measureShellGeometry(page),
    measureHeaderGeometry(page),
    measureMainGeometry(page),
    measureFooterGeometry(page),
    page.evaluate(() => ({
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      shellScrollWidth: document.querySelector<HTMLElement>('[data-testid="student-exam-shell"]')?.scrollWidth ?? 0,
      shellClientWidth: document.querySelector<HTMLElement>('[data-testid="student-exam-shell"]')?.clientWidth ?? 0,
      windowScrollX: window.scrollX,
      windowScrollY: window.scrollY,
      documentScrollTop: document.documentElement.scrollTop,
      bodyScrollTop: document.body.scrollTop,
      layoutMode: document.querySelector<HTMLElement>('[data-testid="student-exam-shell"]')?.dataset.studentLayoutMode ?? null,
      orientation: window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait',
      capabilities: {
        hasTouch: navigator.maxTouchPoints > 0,
        primaryPointer: window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
        hasHover: window.matchMedia('(hover: hover)').matches,
      },
    })),
  ]);

  return { viewport, shell, header, main, footer, ...pageMetrics };
}

export async function expectStudentShellInsideViewport(page: Page): Promise<StudentViewportDiagnostics> {
  const diagnostics = await measureStudentViewportDiagnostics(page);
  const { viewport, shell, header, footer } = diagnostics;
  const visibleTop = viewport.offsetTop;
  const visibleBottom = viewport.offsetTop + viewport.height;
  const visibleLeft = viewport.offsetLeft;
  const visibleRight = viewport.offsetLeft + viewport.width;

  assertAtLeast(shell.top, visibleTop, 'Student shell starts above the visual viewport');
  assertAtMost(shell.bottom, visibleBottom, 'Student shell extends below the visual viewport');
  assertAtLeast(shell.left, visibleLeft, 'Student shell starts left of the visual viewport');
  assertAtMost(shell.right, visibleRight, 'Student shell extends right of the visual viewport');
  assertAtLeast(header.top, shell.top, 'Student header starts above the shell');
  assertAtMost(header.bottom, shell.bottom, 'Student header extends below the shell');
  assertAtLeast(footer.top, shell.top, 'Student footer starts above the shell');
  assertAtMost(footer.bottom, shell.bottom, 'Student footer extends below the shell');

  expect(diagnostics, 'Student shell viewport diagnostics').toMatchObject({
    viewport: expect.any(Object),
    shell: expect.any(Object),
    header: expect.any(Object),
    main: expect.any(Object),
    footer: expect.any(Object),
  });

  return diagnostics;
}

export async function expectExamRegionsDoNotOverlap(
  page: Page,
  diagnostics?: StudentViewportDiagnostics,
): Promise<StudentViewportDiagnostics> {
  const measured = diagnostics ?? (await measureStudentViewportDiagnostics(page));
  const { header, main, footer } = measured;

  assertAtLeast(main.top, header.bottom, 'Student workspace overlaps the header');
  assertAtMost(main.bottom, footer.top, 'Student workspace overlaps the footer');
  assertAtLeast(main.height, 1, 'Student workspace has no usable height');
  assertAtLeast(footer.height, 1, 'Student footer has no usable height');
  return measured;
}

export async function expectNoDocumentOverflow(
  page: Page,
  diagnostics?: StudentViewportDiagnostics,
): Promise<StudentViewportDiagnostics> {
  const measured = diagnostics ?? (await measureStudentViewportDiagnostics(page));
  assertAtMost(
    measured.documentScrollWidth,
    measured.documentClientWidth,
    'Document has horizontal overflow',
  );
  assertAtMost(measured.shellScrollWidth, measured.shellClientWidth, 'Student shell has horizontal overflow');
  return measured;
}
export async function expectExamScrollOwners(page: Page): Promise<void> {
  const owners = await page.locator('[data-student-zoom-scroll]').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const htmlElement = element as HTMLElement;
      if (htmlElement.getClientRects().length === 0) {
        return [];
      }

      const style = window.getComputedStyle(htmlElement);
      return [{
        label: htmlElement.getAttribute('data-testid') ?? htmlElement.className,
        overflowY: style.overflowY,
      }];
    }),
  );

  expect(owners.length, 'Active exam has no visible child scroll owner').toBeGreaterThan(0);
  expect(
    owners.filter(({ overflowY }) => overflowY !== 'auto' && overflowY !== 'scroll'),
    'Visible exam scroll owners must own vertical scrolling',
  ).toEqual([]);
}


export async function expectDocumentIsNotExamScrollOwner(
  page: Page,
  diagnostics?: StudentViewportDiagnostics,
): Promise<StudentViewportDiagnostics> {
  const measured = diagnostics ?? (await measureStudentViewportDiagnostics(page));
  expect(measured.windowScrollY, 'window.scrollY must remain zero').toBe(0);
  expect(measured.documentScrollTop, 'documentElement.scrollTop must remain zero').toBe(0);
  expect(measured.bodyScrollTop, 'body.scrollTop must remain zero').toBe(0);
  return measured;
}

export async function expectPrimaryTouchTargets(
  page: Page,
  minimumSize = 44,
): Promise<void> {
  const failures = await scanStudentTouchTargets(page, { minimumSize });
  expect(failures, 'Visible interactive exam controls below minimum size').toEqual([]);
}

export async function expectContainedExamLayout(page: Page): Promise<StudentViewportDiagnostics> {
  const diagnostics = await expectStudentShellInsideViewport(page);
  await expectExamRegionsDoNotOverlap(page, diagnostics);
  await expectNoDocumentOverflow(page, diagnostics);
  await expectExamScrollOwners(page);
  await expectDocumentIsNotExamScrollOwner(page, diagnostics);
  return diagnostics;
}

export async function logViewportDiagnosticsOnFailure(
  page: Page,
  assertion: () => Promise<void>,
): Promise<void> {
  try {
    await assertion();
  } catch (error) {
    const diagnostics = await measureStudentViewportDiagnostics(page).catch(() => null);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `Student viewport diagnostics: ${JSON.stringify(diagnostics, null, 2)}`,
      { cause: error },
    );
  }
}

export function assertPositiveMainHeight(
  diagnostics: StudentViewportDiagnostics,
  minimumHeight = 100,
): void {
  assertAtLeast(diagnostics.main.height, minimumHeight, 'Student workspace collapsed below usable height');
}
