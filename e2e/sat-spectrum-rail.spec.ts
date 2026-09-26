import { expect, test, type Page } from '@playwright/test';

/**
 * The Bluebook spectrum rail — the pixel gate for the exam chrome's bottom edge.
 *
 * The rail replaced a flat divider under the top bar and under the question
 * header, so what regression looks like here is geometric: a rail that stopped
 * spanning its host, one that floated above the host's edge instead of closing
 * it, one whose accents were replaced by a fallback fill, or a host whose
 * surface drifted back to the old chrome tints. The unit suites pin the state
 * contract (marking, eliminator, answers) and they never paint anything; this
 * suite pins what a student sees, in the marked/unmarked and eliminator
 * on/off states, at the desktop viewport the reference was taken at.
 *
 * Runs against the dev-only `/__dev/sat-accessibility` harness, which renders
 * the real shell with no backend (see playwright.sat-spectrum.config.ts).
 */

const VIEWPORT = { width: 1440, height: 900 };

interface RailReading {
  hostBackground: string;
  hostBox: { left: number; top: number; right: number; bottom: number };
  railBox: { left: number; top: number; right: number; bottom: number; height: number };
  railCount: number;
  railAriaHidden: string | null;
  railHasTabIndex: boolean;
  railPosition: string;
  railPointerEvents: string;
  railRadius: string;
  railIsLastChild: boolean;
  railBackgroundImage: string;
  railBackgroundColor: string;
  railUnobstructedByControls: boolean;
  dark: string;
  blue: string;
  yellow: string;
}

/**
 * Both hosts, measured from the rendered page: the top bar is the banner, and
 * the question header is whatever host the second rail hangs off.
 */
async function readRails(page: Page) {
  return page.evaluate(() => {
    const rails = Array.from(document.querySelectorAll<HTMLElement>('[data-sat-color-rail="true"]'));
    const topbarHost = document.querySelector<HTMLElement>('header[role="banner"]');
    const questionHeaderHost =
      rails
        .map((rail) => rail.parentElement)
        .find((host) => host !== null && host !== topbarHost) ?? null;

    const read = (host: HTMLElement, readsTokensFrom: HTMLElement) => {
      const rail = host.querySelector<HTMLElement>('[data-sat-color-rail="true"]');
      if (!rail) throw new Error('A rail host rendered without its rail.');
      const hostBox = host.getBoundingClientRect();
      const railBox = rail.getBoundingClientRect();
      const railStyle = getComputedStyle(rail);
      // Custom properties only resolve inside the .sat-ui scope they are
      // declared in, so the probe that turns a token into rgb() has to live in
      // the host rather than in the document.
      const tokenToRgb = (token: string) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = `var(${token})`;
        // The probe reads the token itself, never the forced-colors repaint that
        // an ordinary element would get — the rail opts out of that repaint too.
        probe.style.setProperty('forced-color-adjust', 'none');
        readsTokensFrom.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      };
      return {
        hostBackground: getComputedStyle(host).backgroundColor,
        hostBox: { left: hostBox.left, top: hostBox.top, right: hostBox.right, bottom: hostBox.bottom },
        railBox: {
          left: railBox.left,
          top: railBox.top,
          right: railBox.right,
          bottom: railBox.bottom,
          height: railBox.height,
        },
        railCount: host.querySelectorAll('[data-sat-color-rail="true"]').length,
        railAriaHidden: rail.getAttribute('aria-hidden'),
        railHasTabIndex: rail.hasAttribute('tabindex'),
        railPosition: railStyle.position,
        railPointerEvents: railStyle.pointerEvents,
        railRadius: railStyle.borderTopLeftRadius,
        railIsLastChild: host.lastElementChild === rail,
        railBackgroundImage: railStyle.backgroundImage,
        railBackgroundColor: railStyle.backgroundColor,
        // The rail crosses the review control and the ABC eliminator, so no
        // control in its band may paint over it. A control above the band is
        // free; one that reaches into it must paint first — which is true for
        // an unpositioned control, and for a positioned one with z-index auto/0
        // that precedes the rail in the DOM (the rail is the host's last child).
        railUnobstructedByControls: Array.from(host.querySelectorAll<HTMLElement>('button')).every(
          (control) => {
            const box = control.getBoundingClientRect();
            if (box.height === 0 || box.bottom <= railBox.top) return true;
            const zIndex = getComputedStyle(control).zIndex;
            const stackingLevel = zIndex === 'auto' ? 0 : Number(zIndex);
            if (stackingLevel > 0) return false;
            return rail.compareDocumentPosition(control) !== 0 &&
              (rail.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
          },
        ),
        dark: tokenToRgb('--sat-rail-dark'),
        blue: tokenToRgb('--sat-rail-blue'),
        yellow: tokenToRgb('--sat-rail-yellow'),
      };
    };

    if (!topbarHost || !questionHeaderHost) {
      throw new Error('The harness did not render both spectrum-rail hosts.');
    }
    return {
      topbar: read(topbarHost, topbarHost),
      questionHeader: read(questionHeaderHost, questionHeaderHost),
    };
  });
}

function expectFlushRail(name: string, rail: RailReading) {
  // Paper, not chrome: the bar and the header are white now.
  expect(rail.hostBackground, `${name} surface is paper`).toBe('rgb(255, 255, 255)');
  // Exactly one rail, and it is decoration: no accessibility tree entry, no
  // tab stop, no pointer target.
  expect(rail.railCount, `${name} draws exactly one rail`).toBe(1);
  expect(rail.railAriaHidden, `${name} rail is decoration`).toBe('true');
  expect(rail.railHasTabIndex, `${name} rail is never focusable`).toBe(false);
  expect(rail.railPointerEvents, `${name} rail never takes a pointer`).toBe('none');
  expect(rail.railRadius, `${name} rail has square ends`).toBe('0px');
  // An overlay, painted last: it cannot reflow the header it closes, and the
  // controls it passes under cannot interrupt it.
  expect(rail.railPosition, `${name} rail is an overlay`).toBe('absolute');
  expect(rail.railIsLastChild, `${name} rail is painted over the row`).toBe(true);
  expect(rail.railUnobstructedByControls, `${name} rail is never cut by a control`).toBe(true);
  // Flush: the rail's bottom edge IS the host's bottom edge, with no gap.
  expect(Math.abs(rail.railBox.bottom - rail.hostBox.bottom), `${name} rail closes the host`).toBeLessThanOrEqual(0.5);
  expect(rail.railBox.top, `${name} rail sits inside the host`).toBeLessThan(rail.hostBox.bottom);
  // Full width: one continuous line, edge to edge, under the review control and
  // across to the ABC eliminator.
  expect(Math.abs(rail.railBox.left - rail.hostBox.left), `${name} rail starts at the host edge`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(rail.railBox.right - rail.hostBox.right), `${name} rail ends at the host edge`).toBeLessThanOrEqual(0.5);
  // The reference band: a rule, never a hairline and never a band.
  expect(rail.railBox.height).toBeGreaterThanOrEqual(2);
  expect(rail.railBox.height).toBeLessThanOrEqual(4);
  // The accents are really painted, from the shared tokens: a fallback fill or
  // a one-colour rule fails here.
  expect(rail.railBackgroundImage, `${name} rail paints the shared blue accent`).toContain(rail.blue);
  expect(rail.railBackgroundImage, `${name} rail paints the shared yellow accent`).toContain(rail.yellow);
  expect(rail.railBackgroundColor, `${name} rail's base fill is the shared charcoal`).toBe(rail.dark);
}

test.use({ viewport: VIEWPORT });

test.beforeEach(async ({ page }) => {
  await page.goto('/__dev/sat-accessibility');
  await expect(page.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 30_000 });
  // Screenshots compare glyph antialiasing too, so the web fonts must have
  // settled before the first capture.
  await page.waitForFunction(() => document.fonts.status === 'loaded');
});

test('closes the top bar and the question header as one flush rule', async ({ page }) => {
  const readings = await readRails(page);
  expectFlushRail('top bar', readings.topbar);
  expectFlushRail('question header', readings.questionHeader);

  // Same rail, two hosts: the accents may land differently across each width,
  // but the material is one definition, so the base fill and height match.
  expect(readings.questionHeader.railBackgroundColor).toBe(readings.topbar.railBackgroundColor);
  expect(readings.questionHeader.railBox.height).toBe(readings.topbar.railBox.height);
});

test('degrades to one system separator in forced colors', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const readings = await readRails(page);
  for (const [name, rail] of [
    ['top bar', readings.topbar],
    ['question header', readings.questionHeader],
  ] as const) {
    // Decorative segments are dropped, never repainted into system colours: the
    // rail is the browser's own separator ink now (Chrome resolves the system
    // keyword to a concrete value, so the check is that no rail colour survived).
    expect(rail.railBackgroundImage, `${name} rail keeps no decorative layers`).toBe('none');
    expect([rail.dark, rail.blue, rail.yellow], `${name} rail wears no rail colour`).not.toContain(
      rail.railBackgroundColor,
    );
    // The header still has a visible bottom edge, still flush with its host.
    expect(rail.railBox.height).toBeGreaterThan(0);
    expect(Math.abs(rail.railBox.bottom - rail.hostBox.bottom), `${name} separator still closes the host`).toBeLessThanOrEqual(0.5);
  }
});

test('locks the chrome pixels at the reference desktop viewport', async ({ page }) => {
  const topbar = page.locator('header[role="banner"]');
  await expect(topbar).toHaveScreenshot('sat-top-header.png', { animations: 'disabled' });

  // The question header carries the rail on its own bottom edge; the locator is
  // its rail's host, so it survives the label flips below.
  const questionHeader = page.locator('[data-sat-color-rail="true"]').nth(1).locator('..');
  await expect(questionHeader).toHaveScreenshot('sat-question-header-unmarked.png', { animations: 'disabled' });

  await page.getByRole('button', { name: 'Mark for Review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Marked for Review', exact: true })).toBeVisible();
  await expect(questionHeader).toHaveScreenshot('sat-question-header-marked.png', { animations: 'disabled' });

  await page.getByRole('button', { name: 'Turn on cross-out mode' }).click();
  await expect(page.getByRole('button', { name: 'Turn off cross-out mode' })).toHaveAttribute('aria-pressed', 'true');
  await expect(questionHeader).toHaveScreenshot('sat-question-header-eliminator-on.png', { animations: 'disabled' });
});
