import { describe, expect, it } from 'vitest';
import {
  SAT_DISPLAY_PANEL_GAP_PX,
  SAT_DISPLAY_PANEL_WIDTH_PX,
  SAT_NOTES_SEAT_GUTTER_PX,
  SAT_READING_BASE_READABLE_PANE_PX,
  SAT_READING_LAYOUT_HYSTERESIS_PX,
  SAT_READING_NOTES_COLUMN_SEAT_TRACK,
  SAT_READING_NOTES_PAIR_SEAT_TRACK,
  SAT_READING_SPLIT_DIVIDER_PX,
  SAT_READING_SPLIT_HANDLE_PX,
  SAT_READING_SPLIT_HANDLE_REACH_PX,
  resolveSatReadingLayout,
  satNotesSeatGutter,
  satReadingMinPaneWidth,
  satReadingNotesSeatWidth,
  type SatReadingLayoutInput,
  type SatReadingPresentation,
} from './satReadingLayout';
import {
  SAT_NOTES_CHROME_PADDING_PX,
  SAT_NOTES_COLUMN_TRACK,
  SAT_NOTES_MIN_PX,
  SAT_NOTES_PAIR_TRACK,
} from './satNotesUi';

/**
 * The whole combinatorial burden of "when does the exam reflow" lives here, in
 * cheap arithmetic: a browser test should never have to prove the threshold
 * cases, because a browser test proving them is a browser test that will be
 * skipped. The e2e legs then only have to check that the real panes do what this
 * function says.
 *
 * Expectations are written as the arithmetic they came from (three panes, a
 * 320px panel) rather than as magic numbers, so a change of constant reads as a
 * change of formula.
 */
function resolve(
  base: Partial<SatReadingLayoutInput> = {},
  overrides: Partial<SatReadingLayoutInput> = {},
) {
  return resolveSatReadingLayout({
    workspaceWidth: 1024,
    workspaceHeight: 768,
    hasStimulus: true,
    textScale: 1,
    splitRatio: 0.5,
    ...base,
    ...overrides,
  });
}

/** The two panes' usable width: the workspace minus its 2px divider. */
const usable = (width: number) => width - 2;
/** The width at which two equal panes first clear `budget`. */
const splitWidth = (budget: number) => budget * 2 + 2;
/**
 * The width at which the passage, the notes pane, and the question first all
 * clear `budget`: the two panes, the notes seat — the panel at its floor here,
 * plus the clearance the divider handle beside it needs — and the two hard
 * dividers that hold the three of them apart.
 */
const threePaneWidth = (budget: number) =>
  budget * 2 +
  (SAT_NOTES_MIN_PX + SAT_NOTES_SEAT_GUTTER_PX) +
  SAT_READING_SPLIT_DIVIDER_PX * 2;

const phone = { workspaceWidth: 390, workspaceHeight: 844 };
const tablet = { workspaceWidth: 1024, workspaceHeight: 768 };
const desktop = { workspaceWidth: 1440, workspaceHeight: 900 };

describe('satReadingMinPaneWidth', () => {
  it('scales the pane budget with the student’s text size', () => {
    expect(satReadingMinPaneWidth(1)).toBe(SAT_READING_BASE_READABLE_PANE_PX);
    expect(satReadingMinPaneWidth(1.15)).toBeCloseTo(360 * 1.15);
    expect(satReadingMinPaneWidth(1.3)).toBeCloseTo(360 * 1.3);
    expect(satReadingMinPaneWidth(1.5)).toBeCloseTo(360 * 1.5);
    expect(satReadingMinPaneWidth(1.75)).toBeCloseTo(360 * 1.75);
    expect(satReadingMinPaneWidth(2)).toBeCloseTo(360 * 2);
  });

  it('rests at the base budget for input that cannot describe a text size', () => {
    expect(satReadingMinPaneWidth(Number.NaN)).toBe(SAT_READING_BASE_READABLE_PANE_PX);
    expect(satReadingMinPaneWidth(0)).toBe(SAT_READING_BASE_READABLE_PANE_PX);
  });
});

describe('resolveSatReadingLayout presentation', () => {
  it('says "single" for a question with no passage, whatever the width', () => {
    const decision = resolve(phone, { hasStimulus: false });
    expect(decision.presentation).toBe('single');
    expect(decision.reason).toBe('single-question');
    expect(decision.passageWidth).toBeNull();
    // No divider either, so the question owns the whole workspace.
    expect(decision.questionWidth).toBe(390);
  });

  it('splits a tablet at 100% text', () => {
    const decision = resolve(tablet);
    expect(decision.presentation).toBe('split');
    expect(decision.reason).toBe('readable-split');
    expect(decision.passageWidth).toBeCloseTo(usable(1024) * 0.5);
    expect(decision.questionWidth).toBeCloseTo(usable(1024) * 0.5);
    expect(decision.splitFits).toBe(true);
  });

  it('stacks the same tablet at 200% text, without asking what device it is', () => {
    // 511px of pane at a 720px budget: the type would have to shrink to fit, and
    // shrinking the type is the one thing a text-size control may never do.
    const decision = resolve(tablet, { textScale: 2 });
    expect(decision.presentation).toBe('stacked');
    expect(decision.reason).toBe('insufficient-pane-width');
    expect(decision.minReadablePaneWidth).toBe(720);
  });

  it('stacks a phone at every text size', () => {
    for (const textScale of [1, 1.15, 1.3, 1.5, 1.75, 2] as const) {
      expect(resolve(phone, { textScale }).presentation, `textScale ${textScale}`).toBe('stacked');
    }
  });

  it('splits a wide desktop at 150%, where both pane budgets are still met', () => {
    const decision = resolve(desktop, { textScale: 1.5 });
    expect(decision.presentation).toBe('split');
    expect(decision.passageWidth).toBeCloseTo(usable(1440) * 0.5);
    expect(decision.minReadablePaneWidth).toBeCloseTo(540);
  });

  it('stacks a wide desktop at 200%, and splits again on a wider one', () => {
    expect(resolve(desktop, { textScale: 2 }).presentation).toBe('stacked');
    expect(resolve({ workspaceWidth: 2560, workspaceHeight: 1440 }, { textScale: 2 }).presentation).toBe('split');
  });

  it('lets the saved split ratio decide, because it is part of readability', () => {
    // 1298px between the panes at 150% text: an even split gives each pane 649px
    // against a 540px budget, while 62% leaves the question 493px — under it, so
    // the panes stack rather than squeezing the type.
    const wide = { workspaceWidth: 1300, workspaceHeight: 800, textScale: 1.5 } as const;
    const even = resolve({ ...wide, splitRatio: 0.5 });
    const pushed = resolve({ ...wide, splitRatio: 0.62 });
    expect(even.presentation).toBe('split');
    expect(pushed.presentation).toBe('stacked');
    // The ratio itself is never rewritten: it is only read.
    expect(pushed.passageWidth).toBeCloseTo(usable(1300) * 0.62);
    expect(pushed.questionWidth).toBeCloseTo(usable(1300) * 0.38);
  });

  it('decides on the narrowest pane, not on an average', () => {
    const ratio = 0.62;
    const fits = resolve({ workspaceWidth: 1160, workspaceHeight: 800, splitRatio: ratio });
    const narrow = resolve({ workspaceWidth: 940, workspaceHeight: 800, splitRatio: ratio });
    expect(fits.passageWidth).toBeCloseTo(usable(1160) * ratio);
    expect(fits.questionWidth).toBeCloseTo(usable(1160) * (1 - ratio));
    expect(fits.presentation).toBe('split');
    // The passage pane is still comfortable here; the question pane is what
    // stacks the layout, which is why the decision is made on the narrower one.
    expect(narrow.passageWidth).toBeCloseTo(usable(940) * ratio);
    expect(narrow.passageWidth).toBeGreaterThan(narrow.minReadablePaneWidth);
    expect(narrow.questionWidth).toBeLessThan(narrow.minReadablePaneWidth);
    expect(narrow.presentation).toBe('stacked');
  });

  it('treats a ratio outside the stored range as the nearest one it can honor', () => {
    // The control clamps to 38–62%; a stored value beyond them can never produce
    // a pane narrower than the floor, and a broken one rests at an even split.
    expect(resolve({ splitRatio: 0 }).passageWidth).toBeCloseTo(usable(1024) * 0.38);
    expect(resolve({ splitRatio: 5 }).passageWidth).toBeCloseTo(usable(1024) * 0.62);
    expect(resolve({ splitRatio: Number.NaN }).passageWidth).toBeCloseTo(usable(1024) * 0.5);
  });

  it('resolves an empty or unmeasurable workspace to stacked, never to a broken split', () => {
    expect(resolve({ workspaceWidth: 0, workspaceHeight: 0 }).presentation).toBe('stacked');
    expect(resolve({ workspaceWidth: Number.NaN, workspaceHeight: Number.NaN }).presentation).toBe('stacked');
  });
});

describe('resolveSatReadingLayout thresholds and hysteresis', () => {
  it('splits on the exact budget and stacks below it', () => {
    const width = splitWidth(SAT_READING_BASE_READABLE_PANE_PX);
    expect(resolve({ workspaceWidth: width }).presentation).toBe('split');
    expect(resolve({ workspaceWidth: width - 1 }).presentation).toBe('stacked');
  });

  it('keeps a split layout through a small shortfall, so it cannot flicker at a pixel', () => {
    const previous: SatReadingPresentation = 'split';
    const lastSplitWidth = splitWidth(
      SAT_READING_BASE_READABLE_PANE_PX - SAT_READING_LAYOUT_HYSTERESIS_PX,
    );
    expect(resolve({ workspaceWidth: lastSplitWidth, previousPresentation: previous }).presentation).toBe('split');
    expect(resolve({ workspaceWidth: lastSplitWidth - 1, previousPresentation: previous }).presentation).toBe('stacked');
  });

  it('makes a stacked layout earn a comfortable margin before splitting again', () => {
    const previous: SatReadingPresentation = 'stacked';
    const firstSplitWidth = splitWidth(
      SAT_READING_BASE_READABLE_PANE_PX + SAT_READING_LAYOUT_HYSTERESIS_PX,
    );
    // Exactly at the budget is not enough to return: a browser that moves the
    // width by a pixel or two would otherwise flip the exam back and forth.
    expect(resolve({ workspaceWidth: splitWidth(SAT_READING_BASE_READABLE_PANE_PX), previousPresentation: previous }).presentation).toBe('stacked');
    expect(resolve({ workspaceWidth: firstSplitWidth - 1, previousPresentation: previous }).presentation).toBe('stacked');
    expect(resolve({ workspaceWidth: firstSplitWidth, previousPresentation: previous }).presentation).toBe('split');
  });

  it('ignores hysteresis for a question that has no passage to place', () => {
    expect(resolve(phone, { hasStimulus: false, previousPresentation: 'split' }).presentation).toBe('single');
    expect(resolve(tablet, { hasStimulus: false, previousPresentation: 'stacked' }).presentation).toBe('single');
  });
});

describe('resolveSatReadingLayout notes capability', () => {
  it('fits three panes on a tablet, where the column takes its 280px floor', () => {
    const decision = resolve(tablet);
    expect(decision.threeColumnNotesFit).toBe(true);
    expect(decision.sideNotesFit).toBe(true);
  });

  it('refuses the third column one pixel below the width it needs', () => {
    // The column's own floor is what makes this a real threshold rather than a
    // share of the screen: below it, the note column would take the reading
    // width the passage needs, so the question gives up its place instead.
    const width = threePaneWidth(SAT_READING_BASE_READABLE_PANE_PX);
    const fits = resolve({ workspaceWidth: width });
    const nearly = resolve({ workspaceWidth: width - 1 });
    expect(fits.presentation).toBe('split');
    expect(fits.threeColumnNotesFit).toBe(true);
    expect(nearly.presentation).toBe('split');
    expect(nearly.threeColumnNotesFit).toBe(false);
  });

  it('measures the column with the same band the grid builds it from', () => {
    // At 1600 the column is capped at 320px, and the seat it claims is that band
    // plus the divider handle's clearance — so the two panes share 1267px, 633px
    // each, comfortably above the budget. The reported passage and question
    // widths are the base split's (notes closed), because the width a pane has
    // when the column is closed is what decided the presentation.
    const decision = resolve({ workspaceWidth: 1600, workspaceHeight: 900 });
    expect(decision.passageWidth).toBeCloseTo(usable(1600) * 0.5);
    expect(satReadingNotesSeatWidth(1600, 'split')).toBe(320 + SAT_NOTES_SEAT_GUTTER_PX);
    expect((usable(1600) - (320 + SAT_NOTES_SEAT_GUTTER_PX) - 2) * 0.5).toBeGreaterThan(
      SAT_READING_BASE_READABLE_PANE_PX,
    );
    expect(decision.threeColumnNotesFit).toBe(true);
  });

  it('does not claim a third column for a question that has no passage', () => {
    const decision = resolve({ workspaceWidth: 2000, workspaceHeight: 1000, hasStimulus: false });
    expect(decision.threeColumnNotesFit).toBe(false);
    expect(decision.sideNotesFit).toBe(true);
  });

  it('stacks the notes under the panes when even the question cannot share a row', () => {
    const decision = resolve(phone);
    expect(decision.threeColumnNotesFit).toBe(false);
    expect(decision.sideNotesFit).toBe(false);
  });

  it('raises the bar for the third column with the student’s text size', () => {
    const wide = { workspaceWidth: 1400, workspaceHeight: 900 } as const;
    expect(resolve(wide, { textScale: 1 }).threeColumnNotesFit).toBe(true);
    expect(resolve(wide, { textScale: 2 }).threeColumnNotesFit).toBe(false);
  });
});

/**
 * The divider handle is a 44px target centred on a 2px divider, so it reaches
 * 21px into whatever sits beside that divider — and beside it, when the notes
 * pane is open, sits the notes panel. Every control in that panel has to stand
 * clear of the reach, which is a claim about three numbers in three files: the
 * reach, the panel's own chrome inset, and the gutter the seat adds in front of
 * it. These cases hold all three together.
 */
describe('the notes seat keeps clear of the divider handle', () => {
  it('derives the reach from the handle rather than restating it', () => {
    expect(SAT_READING_SPLIT_HANDLE_REACH_PX * 2 + SAT_READING_SPLIT_DIVIDER_PX).toBe(
      SAT_READING_SPLIT_HANDLE_PX,
    );
    expect(SAT_READING_SPLIT_HANDLE_PX).toBeGreaterThanOrEqual(44);
  });

  it('owes only what the panel’s own chrome does not already provide', () => {
    // The invariant is on the SUM: the panel puts nothing interactive in its
    // first 12px, so the seat owes 9 — and if either number moves, the sum is
    // what has to keep clearing the handle.
    expect(SAT_NOTES_CHROME_PADDING_PX + SAT_NOTES_SEAT_GUTTER_PX).toBeGreaterThanOrEqual(
      SAT_READING_SPLIT_HANDLE_REACH_PX,
    );
    // Not "9": a gutter that is not the deficit either wastes reading width or
    // leaves the first note control under the grab zone.
    expect(SAT_NOTES_SEAT_GUTTER_PX).toBe(
      SAT_READING_SPLIT_HANDLE_REACH_PX - SAT_NOTES_CHROME_PADDING_PX,
    );
  });

  it('writes the seat into the grid track and the model at the same time', () => {
    // The track string the workspace builds and the width the resolver measured
    // are the same claim, so one of them cannot quietly drop the gutter.
    expect(SAT_READING_NOTES_COLUMN_SEAT_TRACK).toBe(
      `calc(${SAT_NOTES_COLUMN_TRACK} + ${SAT_NOTES_SEAT_GUTTER_PX}px)`,
    );
    expect(SAT_READING_NOTES_PAIR_SEAT_TRACK).toBe(
      `calc(${SAT_NOTES_PAIR_TRACK} + ${SAT_NOTES_SEAT_GUTTER_PX}px)`,
    );
    expect(satReadingNotesSeatWidth(1024, 'split')).toBe(
      satReadingNotesSeatWidth(1024, 'single') + SAT_NOTES_SEAT_GUTTER_PX,
    );
    for (const width of [390, 768, 1024, 1280, 1600, 2560]) {
      // The seat is the panel plus the gutter, never the panel alone: the gutter
      // is room the handle owns, and handing it back to the panes is how the
      // model starts describing a layout the browser did not build.
      expect(satReadingNotesSeatWidth(width, 'split')).toBeGreaterThan(
        satReadingNotesSeatWidth(width, 'single'),
      );
    }
  });

  it('charges the gutter only where a handle stands beside the pane', () => {
    expect(satNotesSeatGutter('split')).toBe(SAT_NOTES_SEAT_GUTTER_PX);
    // A single-pane question has no divider to move; stacked notes are a
    // full-width row under the panes. Neither reserves the handle's clearance.
    expect(satNotesSeatGutter('single')).toBe(0);
    expect(satNotesSeatGutter('stacked')).toBe(0);
  });

  it('decides the third column on the panes that are left after the seat', () => {
    // The gate the gutter moves, stated in the terms it moves them: at the exact
    // three-pane width the panes still clear the budget, one pixel below they do
    // not and the question gives up its place to the notes pane.
    const width = threePaneWidth(SAT_READING_BASE_READABLE_PANE_PX);
    const aside = (w: number) =>
      (usable(w) - satReadingNotesSeatWidth(w, 'split') - SAT_READING_SPLIT_DIVIDER_PX) * 0.5;
    expect(aside(width)).toBeGreaterThanOrEqual(SAT_READING_BASE_READABLE_PANE_PX);
    expect(aside(width - 1)).toBeLessThan(SAT_READING_BASE_READABLE_PANE_PX);
    expect(resolve({ workspaceWidth: width }).threeColumnNotesFit).toBe(true);
    expect(resolve({ workspaceWidth: width - 1 }).threeColumnNotesFit).toBe(false);
  });

  it('still offers the third column on the tablets and desktops in use', () => {
    // The gutter is 9px, not 21: reserving the full reach in front of a panel
    // that already insets its own controls would cost the third column at 1024 —
    // the iPad landscape case — over half a pixel of arithmetic.
    for (const width of [1024, 1280, 1440]) {
      expect(resolve({ workspaceWidth: width }).threeColumnNotesFit, `width ${width}`).toBe(true);
    }
  });
});

describe('resolveSatReadingLayout display capability', () => {
  it('anchors the panel where it would still leave a readable question pane', () => {
    const decision = resolve(desktop);
    expect(decision.displayPresentation).toBe('anchored');
    expect(decision.questionWidth - SAT_DISPLAY_PANEL_WIDTH_PX - SAT_DISPLAY_PANEL_GAP_PX)
      .toBeCloseTo(usable(1440) * 0.5 - 320 - 24);
  });

  it('hands a tablet the sheet instead, where the panel would eat the question', () => {
    // 511px of question, 320px of panel: the student would be reading in a
    // sliver, which is worse than a sheet that takes width and no reading line.
    expect(resolve(tablet).displayPresentation).toBe('compact');
  });

  it('hands the sheet to a stacked layout without measuring anything', () => {
    expect(resolve(phone).displayPresentation).toBe('compact');
    expect(resolve(tablet, { textScale: 2 }).displayPresentation).toBe('compact');
  });

  it('raises the bar with the student’s text size', () => {
    expect(resolve(desktop, { textScale: 1 }).displayPresentation).toBe('anchored');
    expect(resolve(desktop, { textScale: 1.5 }).displayPresentation).toBe('compact');
    expect(resolve({ workspaceWidth: 2560, workspaceHeight: 1440 }, { textScale: 2 }).displayPresentation).toBe('anchored');
  });

  it('anchors beside a question that has no passage, where the panel covers less of it', () => {
    // The same 1024px is the whole workspace for a question with no passage —
    // 680px of it left after the panel — but only half of it when a passage is
    // beside it, which is why that one gets the sheet.
    expect(resolve({ ...tablet, hasStimulus: false }).displayPresentation).toBe('anchored');
    expect(resolve(tablet).displayPresentation).toBe('compact');
  });
});
