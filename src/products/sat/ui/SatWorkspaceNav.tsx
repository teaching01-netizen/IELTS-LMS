import { createContext, useContext } from 'react';
import { SatMenu, type SatMenuItem } from './Menu';

/**
 * The SAT workspace destinations for the signed-in role, provided by SatRoot.
 * Focused pages (the exam workspace) hide the sidebar, so their header reads
 * this to offer the same Exams / Rooms / Responses destinations behind an
 * explicit "Digital SAT" trigger. Outside SatRoot it is null and nothing renders.
 */
export const SatWorkspaceNavContext = createContext<SatMenuItem[] | null>(null);

export function SatWorkspaceMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-[8px] bg-[var(--sat-staff-text-primary,#1d1d1f)] text-[11px] font-bold tracking-[0.02em] text-[var(--sat-staff-text-inverse,#fff)]"
    >
      SAT
    </span>
  );
}

export function SatWorkspaceSwitcher() {
  const items = useContext(SatWorkspaceNavContext);
  if (!items?.length) return null;
  return (
    <SatMenu
      label="Digital SAT workspace"
      align="start"
      width={232}
      items={items}
      triggerClassName="sat-press sat-press-fill group -ml-1.5 flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--sat-staff-radius-control,10px)] px-1.5 text-left hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] sm:pr-2.5"
      triggerContent={
        <>
          <SatWorkspaceMark />
          <span className="hidden text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)] sm:inline">Digital SAT</span>
        </>
      }
    />
  );
}
