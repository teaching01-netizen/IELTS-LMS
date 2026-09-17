import { createContext, useContext, type ReactNode } from 'react';
import type { SatNotesPlacement } from '../../domain/satNotesUi';

/**
 * Carries the Notes column from its owner (the shell's surface host, which owns
 * every piece of annotation state) into the layout that has room for it (the
 * passage/question workspace, which is owned by the route).
 *
 * The alternative was threading notes state through the question renderer into
 * the workspace, which would make a layout component a co-owner of exam state
 * just to place a pane. Here the host decides what the column is *and* where it
 * goes; the workspace only renders the placement it is given, so the column can
 * never become a fixed overlay again.
 */
export interface SatNotesSurface {
  /** Whether the Notes column is part of the layout right now. */
  open: boolean;
  /** Where it goes at the current width — the single placement decision. */
  placement: SatNotesPlacement;
  /** The column content, composed by the host. */
  column: ReactNode;
  /**
   * The handle a hidden column leaves behind, composed by the host.
   *
   * Null whenever there is nothing to leave behind — the pane is open, notes are
   * unavailable, or the width has no side for a handle to stand on. The layout
   * renders it in the column's own track, so it never has to decide when a handle
   * belongs on screen (`satNotesRailVisible` already answered).
   */
  rail: ReactNode;
  /**
   * The one-time teaching line, rendered at the top of the passage so the
   * instruction sits where the gesture belongs.
   */
  passageHint: ReactNode;
}

const CLOSED: SatNotesSurface = { open: false, placement: 'none', column: null, rail: null, passageHint: null };

export const SatNotesSurfaceContext = createContext<SatNotesSurface>(CLOSED);

export function useSatNotesSurface(): SatNotesSurface {
  return useContext(SatNotesSurfaceContext);
}
