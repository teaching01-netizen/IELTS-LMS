import { createContext, useContext } from 'react';
import { LayoutGrid } from 'lucide-react';
import { SatMenu, type SatMenuItem } from './Menu';

/**
 * The SAT workspace destinations for the signed-in role, provided by SatRoot.
 * Full-bleed pages (the test workspace) hide the sidebar, so their header reads
 * this to offer the same Exams / Rooms / Responses switcher. Outside SatRoot
 * it is null and no switcher renders.
 */
export const SatWorkspaceNavContext = createContext<SatMenuItem[] | null>(null);

export function SatWorkspaceSwitcher() {
  const items = useContext(SatWorkspaceNavContext);
  if (!items?.length) return null;
  return <SatMenu compact label="Digital SAT workspace" icon={LayoutGrid} align="start" width={220} items={items} />;
}
