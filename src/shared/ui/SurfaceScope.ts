import { createContext, useContext } from 'react';

/** Carry a workspace's design tokens through React portals. */
export const SurfaceScopeContext = createContext<string | undefined>(undefined);

export function useSurfaceScope(): string | undefined {
  return useContext(SurfaceScopeContext);
}
