import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface HighlightSelectionManagerValue {
  activeSurfaceId: string | null;
  claimSurface: (surfaceId: string) => void;
  releaseSurface: (surfaceId: string) => void;
}

const HighlightSelectionManagerContext = createContext<HighlightSelectionManagerValue | null>(null);

export function StudentHighlightSelectionManagerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [activeSurfaceId, setActiveSurfaceId] = useState<string | null>(null);

  const claimSurface = useCallback((surfaceId: string) => {
    setActiveSurfaceId((current) => (current === surfaceId ? current : surfaceId));
  }, []);

  const releaseSurface = useCallback((surfaceId: string) => {
    setActiveSurfaceId((current) => (current === surfaceId ? null : current));
  }, []);

  const value = useMemo(
    () => ({
      activeSurfaceId,
      claimSurface,
      releaseSurface,
    }),
    [activeSurfaceId, claimSurface, releaseSurface],
  );

  return (
    <HighlightSelectionManagerContext.Provider value={value}>
      {children}
    </HighlightSelectionManagerContext.Provider>
  );
}

export function useHighlightSelectionManager() {
  return useContext(HighlightSelectionManagerContext);
}
