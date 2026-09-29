import { describe, expect, it } from 'vitest';
import {
  SAT_NOTES_COLUMN_TRACK,
  SAT_NOTES_PAIR_TRACK,
  SAT_NOTES_RAIL_PX,
  SAT_NOTES_RAIL_TRACK,
  satNotesColumnWidth,
  SAT_QUESTION_NOTE_EDITOR,
  idleSatNotesUi,
  satNotesColumnOpen,
  satNotesPlacement,
  satAnnotationHasNote,
  satNotesCount,
  satNotesRailVisible,
  satNotesUiFromSurface,
  selectionSatNotesUi,
} from '../satNotesUi';
import type { SatExclusiveSurface } from '../satInteractionState';
import {
  SAT_READING_SPLIT_DIVIDER_PX,
  SAT_READING_SPLIT_HANDLE_PX,
} from '../satReadingLayout';

const returnFocus = { kind: 'top-bar', id: 'sat-notes-button' } as never;

/**
 * One state owns "is the column open, which card is active, which field is
 * open". These cases pin the translation from the interaction machine so no
 * component has to answer that question a second time — the duplication that
 * let the Add-note close path drop focus.
 */
describe('satNotesUiFromSurface', () => {
  it('opens the column on a marked span, with that card active and its field open', () => {
    const state = satNotesUiFromSurface(
      { kind: 'annotation-note-editor', annotationId: 'mark-1', returnFocus },
      null,
      false,
    );
    expect(state).toEqual({ kind: 'notes', editorId: 'mark-1', activeId: 'mark-1' });
    expect(satNotesColumnOpen(state)).toBe(true);
  });

  it('treats writing about the question as an editor state, not a flag', () => {
    const state = satNotesUiFromSurface({ kind: 'question-note-editor', returnFocus }, null, false);
    expect(state).toEqual({
      kind: 'notes',
      editorId: SAT_QUESTION_NOTE_EDITOR,
      activeId: null,
    });
  });

  it('opens the column with no field when the student asked for notes', () => {
    // The top-bar entry is a request for the column, not for a field: nothing
    // should be focused for typing that the student did not ask to type in.
    const state = satNotesUiFromSurface({ kind: 'question-notes', returnFocus }, 'mark-2', false);
    expect(state).toEqual({ kind: 'notes', editorId: null, activeId: 'mark-2' });
  });

  it('rings the mark being edited without opening anything', () => {
    // The edit dock's own presentation state only ever highlights a card; it can
    // never make the column appear.
    expect(satNotesUiFromSurface({ kind: 'none' }, 'mark-3', false)).toEqual({ kind: 'idle' });
    expect(satNotesColumnOpen(satNotesUiFromSurface({ kind: 'none' }, 'mark-3', false))).toBe(false);
  });

  it('reports a live selection, so the toolbar owns the surface instead', () => {
    expect(satNotesUiFromSurface({ kind: 'none' }, null, true)).toEqual(selectionSatNotesUi());
    expect(satNotesUiFromSurface({ kind: 'none' }, null, false)).toEqual(idleSatNotesUi());
  });

  it.each<SatExclusiveSurface['kind']>(['navigator', 'directions', 'reading-settings', 'more-menu'])(
    'keeps the column closed while %s is open',
    (kind) => {
      expect(satNotesUiFromSurface({ kind, returnFocus } as SatExclusiveSurface, 'mark-3', false)).toEqual({
        kind: 'idle',
      });
    },
  );
});

/**
 * One rule for where the column goes, so the component that renders it and the
 * component that places it can never disagree.
 */
describe('satNotesPlacement', () => {
  it('is closed when the column is closed, whatever the layout says', () => {
    expect(satNotesPlacement({ open: false, readingPresentation: 'split', threeColumnFits: true, sideColumnFits: true })).toBe('none');
    expect(satNotesPlacement({ open: false, readingPresentation: 'stacked', threeColumnFits: false, sideColumnFits: false })).toBe('none');
  });

  it('takes a column of its own when passage, notes, and question all fit', () => {
    expect(satNotesPlacement({ open: true, readingPresentation: 'split', threeColumnFits: true, sideColumnFits: true })).toBe('column');
  });

  it('takes the question’s place rather than squeezing three panes', () => {
    expect(satNotesPlacement({ open: true, readingPresentation: 'split', threeColumnFits: false, sideColumnFits: false })).toBe('pair');
  });

  it('stacks when the panes are already stacked', () => {
    expect(satNotesPlacement({ open: true, readingPresentation: 'stacked', threeColumnFits: false, sideColumnFits: false })).toBe('row');
    // Stacked wins over a stale capability flag: one pane at a time cannot hold
    // a column beside it.
    expect(satNotesPlacement({ open: true, readingPresentation: 'stacked', threeColumnFits: true, sideColumnFits: true })).toBe('row');
  });

  it('sits beside a question that has no passage, when the two fit together', () => {
    // No stimulus: the question is the only reading pane, so the column's own
    // room is the whole question — not the three-pane arrangement.
    expect(satNotesPlacement({ open: true, readingPresentation: 'single', threeColumnFits: false, sideColumnFits: true })).toBe('column');
    expect(satNotesPlacement({ open: true, readingPresentation: 'single', threeColumnFits: false, sideColumnFits: false })).toBe('row');
  });

  it('keeps the track inside the 280–340px band a note column needs', () => {
    for (const track of [SAT_NOTES_COLUMN_TRACK, SAT_NOTES_PAIR_TRACK]) {
      const [min, , max] = track.replace(/^clamp\(|\)$/g, '').split(', ');
      expect(Number(min?.replace('px', ''))).toBe(280);
      expect(Number(max?.replace('px', ''))).toBe(340);
    }
  });

  it('measures the column with the same numbers its CSS track is built from', () => {
    // A CSS clamp and a layout calculation that disagree about what "20%"
    // means is how the policy clears room for a column the grid then refuses to
    // fit. Both are read from one set of constants, and this pins that they
    // still describe the same band.
    expect(satNotesColumnWidth(600)).toBe(280);
    expect(satNotesColumnWidth(1600)).toBeCloseTo(320);
    expect(satNotesColumnWidth(4000)).toBe(340);
    expect(SAT_NOTES_COLUMN_TRACK).toBe('clamp(280px, 20%, 340px)');
    expect(SAT_NOTES_PAIR_TRACK).toBe('clamp(280px, 32%, 340px)');
  });
});

/**
 * The handle a hidden column leaves behind is one decision too: it exists where
 * the pane would have stood, and nowhere it could not. These cases pin that, so
 * "hiding notes is reversible" stays visible instead of becoming a rule each
 * layout re-derives from its own viewport.
 */
describe('satNotesRailVisible', () => {
  it('stands where a hidden column stood, so hiding it is visibly reversible', () => {
    expect(satNotesRailVisible({ open: false, readingPresentation: 'split', available: true, hasNotes: true })).toBe(true);
  });

  it('retires while the column itself is on screen', () => {
    expect(satNotesRailVisible({ open: true, readingPresentation: 'split', available: true, hasNotes: true })).toBe(false);
  });

  it('never appears without the surface it belongs to', () => {
    // Math: no notes, so no handle advertising a pane that cannot open.
    expect(satNotesRailVisible({ open: false, readingPresentation: 'split', available: false, hasNotes: true })).toBe(false);
  });

  it('stays out of the stacked layout, where there is no edge to hold', () => {
    // Stacked panes: the column takes no side of the layout, and the reading
    // height a handle would cost is the same space the passage needs.
    expect(satNotesRailVisible({ open: false, readingPresentation: 'stacked', available: true, hasNotes: true })).toBe(false);
  });

  it('waits for a note before it promises anything to come back to', () => {
    // Nothing written yet: no pane, no handle, nothing notes-shaped in the middle
    // of the exam — the labeled top-bar entry is the way in, and a highlight on
    // its own never summons the section.
    expect(satNotesRailVisible({ open: false, readingPresentation: 'split', available: true, hasNotes: false })).toBe(false);
  });

  it('counts written notes only, so the heading and the handle agree', () => {
    // A card open for a first note is not a note yet. Both the summary and the
    // handle read this one number, which is what keeps them from disagreeing.
    expect(satNotesCount([{ note: '  ' }, { note: undefined }], '   ')).toBe(0);
    expect(satNotesCount([{ note: 'Check the evidence' }], '')).toBe(1);
    expect(satNotesCount([{ note: 'One' }, { note: 'Two' }], 'About the question')).toBe(3);
  });

  it('answers "has a note" once, for everything that has to agree about it', () => {
    // The heading's count, the handle, and the margin dots all ask this same
    // question; a second definition is how the passage ends up dotting a mark the
    // pane does not count.
    expect(satAnnotationHasNote({ note: 'Check the evidence' })).toBe(true);
    expect(satAnnotationHasNote({ note: '   ' })).toBe(false);
    expect(satAnnotationHasNote({})).toBe(false);
  });

  it('is a tab beside the pane it replaces, never a second pane', () => {
    expect(SAT_NOTES_RAIL_TRACK).toBe(`${SAT_NOTES_RAIL_PX}px`);
    expect(SAT_NOTES_RAIL_PX).toBeLessThan(80);
  });

  it('places the collapsed tab clear of the divider handle that splits it', () => {
    // The handle is a 44px target centred on a 2px divider, so 21px of it lands
    // in whatever sits flush beside that divider. At the 36px this tab used to
    // be, its own CENTRE was inside that 21px: the divider's grab zone sat on top
    // of the control that reopens the pane, and a tap meant for Notes started a
    // drag instead. Both readings below are the reason for the number, so a
    // future "make the tab thinner" has to argue with a test, not a student.
    const handleReachFromDivider = (SAT_READING_SPLIT_HANDLE_PX - SAT_READING_SPLIT_DIVIDER_PX) / 2;
    const railCentreFromDivider = SAT_READING_SPLIT_DIVIDER_PX / 2 + SAT_NOTES_RAIL_PX / 2;
    expect(railCentreFromDivider).toBeGreaterThan(handleReachFromDivider);
    // And it is a control a finger can hit at all: 36px was under the 44px floor
    // every other exam button is held to.
    expect(SAT_NOTES_RAIL_PX).toBeGreaterThanOrEqual(44);
  });
});
