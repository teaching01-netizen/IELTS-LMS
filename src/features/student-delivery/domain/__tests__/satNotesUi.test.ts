import { describe, expect, it } from 'vitest';
import {
  SAT_NOTES_COLUMN_TRACK,
  SAT_NOTES_PAIR_TRACK,
  SAT_NOTES_RAIL_TRACK,
  SAT_QUESTION_NOTE_EDITOR,
  idleSatNotesUi,
  satNotesColumnOpen,
  satNotesPlacement,
  satNotesCount,
  satNotesRailVisible,
  satNotesUiFromSurface,
  selectionSatNotesUi,
} from '../satNotesUi';
import type { SatExclusiveSurface } from '../satInteractionState';

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
  it('is closed when the column is closed, whatever the width', () => {
    expect(satNotesPlacement({ open: false, compact: false, threeColumn: true })).toBe('none');
    expect(satNotesPlacement({ open: false, compact: true, threeColumn: false })).toBe('none');
  });

  it('takes a column of its own when three panes fit', () => {
    expect(satNotesPlacement({ open: true, compact: false, threeColumn: true })).toBe('column');
  });

  it('takes the question’s place rather than squeezing three panes', () => {
    expect(satNotesPlacement({ open: true, compact: false, threeColumn: false })).toBe('pair');
  });

  it('stacks on phone widths, where even two panes do not fit', () => {
    expect(satNotesPlacement({ open: true, compact: true, threeColumn: false })).toBe('row');
    // Compact wins over a stale wide query: one pane at a time cannot hold a
    // column beside it.
    expect(satNotesPlacement({ open: true, compact: true, threeColumn: true })).toBe('row');
  });

  it('keeps the track inside the 280–340px band a note column needs', () => {
    for (const track of [SAT_NOTES_COLUMN_TRACK, SAT_NOTES_PAIR_TRACK]) {
      const [min, , max] = track.replace(/^clamp\(|\)$/g, '').split(', ');
      expect(Number(min?.replace('px', ''))).toBe(280);
      expect(Number(max?.replace('px', ''))).toBe(340);
    }
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
    expect(satNotesRailVisible({ open: false, compact: false, available: true, hasNotes: true })).toBe(true);
  });

  it('retires while the column itself is on screen', () => {
    expect(satNotesRailVisible({ open: true, compact: false, available: true, hasNotes: true })).toBe(false);
  });

  it('never appears without the surface it belongs to', () => {
    // Math: no notes, so no handle advertising a pane that cannot open.
    expect(satNotesRailVisible({ open: false, compact: false, available: false, hasNotes: true })).toBe(false);
  });

  it('stays out of the stacked layout, where there is no edge to hold', () => {
    // Phone widths: the column takes no side of the layout, and the reading
    // height a handle would cost is the same space the passage needs.
    expect(satNotesRailVisible({ open: false, compact: true, available: true, hasNotes: true })).toBe(false);
  });

  it('waits for a note before it promises anything to come back to', () => {
    // Nothing written yet: no pane, no handle, nothing notes-shaped in the middle
    // of the exam — the labeled top-bar entry is the way in, and a highlight on
    // its own never summons the section.
    expect(satNotesRailVisible({ open: false, compact: false, available: true, hasNotes: false })).toBe(false);
  });

  it('counts written notes only, so the heading and the handle agree', () => {
    // A card open for a first note is not a note yet. Both the summary and the
    // handle read this one number, which is what keeps them from disagreeing.
    expect(satNotesCount([{ note: '  ' }, { note: undefined }], '   ')).toBe(0);
    expect(satNotesCount([{ note: 'Check the evidence' }], '')).toBe(1);
    expect(satNotesCount([{ note: 'One' }, { note: 'Two' }], 'About the question')).toBe(3);
  });

  it('is a tab beside the pane it replaces, never a second pane', () => {
    expect(SAT_NOTES_RAIL_TRACK).toBe('2.25rem');
    expect(Number(SAT_NOTES_RAIL_TRACK.replace('rem', ''))).toBeLessThan(5);
  });
});
