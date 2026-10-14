import type { ReactNode } from 'react';
import type { SatRoomLayout } from '../useSatRoomLayout';
import type { SatRoomMode } from '../SatSessionContextBar';

/**
 * The live room's shell: header, summary, transient notices, then one
 * workspace holding the student list, the room context column and the
 * selected-student inspector.
 *
 * Pane placement follows `layout`, the width the room measured for itself
 * (useSatRoomLayout), and lives in sat-session-room.css. The panes are always
 * the same mounted elements in the same order; only CSS moves them, so search,
 * selection and focus survive a resize.
 */
export function SatRoomWorkspace({
  layoutRef,
  layout,
  mode,
  header,
  summary,
  notices,
  students,
  context,
  inspector,
}: {
  layoutRef: (node: HTMLElement | null) => void;
  layout: SatRoomLayout;
  mode: SatRoomMode;
  header: ReactNode;
  summary: ReactNode;
  /** Stale-data and action-result banners; omitted when there are none. */
  notices?: ReactNode;
  students: ReactNode;
  context: ReactNode;
  inspector: ReactNode;
}) {
  return (
    <div
      ref={layoutRef}
      className="sat-room sat-product bg-[var(--sat-staff-canvas,#f7f7f8)] text-[var(--sat-staff-text-primary,#1d1d1f)]"
      data-sat-room-mode={mode}
      data-room-layout={layout}
    >
      {header}
      {summary}
      {notices ? <div className="sat-room__notices grid min-w-0 gap-2">{notices}</div> : null}
      <div className="sat-room__body">
        {students}
        {context}
        {inspector}
      </div>
    </div>
  );
}
