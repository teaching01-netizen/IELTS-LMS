import { useEffect, type ReactNode } from 'react';
import {
  SatReadingLayoutProvider,
  useSatReadingLayout,
  type SatReadingLayoutProviderProps,
} from '../SatReadingLayoutContext';
import {
  createSatReadingPreferences,
  type SatReadingPreferences,
} from '../../../domain/satReadingPreferences';

/**
 * The reading layout, with the measurement handed in.
 *
 * jsdom has no layout engine: every element reports a 0×0 box, so a test that
 * wants "this workspace is 390px wide" has to say so. The viewport values
 * mirror the real devices these numbers came from, but nothing in the product
 * reads them by name — the policy only ever sees a width.
 */
export const SAT_TEST_BOX = {
  phone: { width: 390, height: 844 },
  smallTablet: { width: 900, height: 700 },
  tablet: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
} as const;

/**
 * Stands in for the workspace that registers itself in production.
 *
 * The two things the layout needs from it are the box it occupies and whether
 * the question has a passage beside it; a real workspace would supply both. Here
 * the box comes from the injected measurement, and the answer to "is there a
 * passage" is the only thing left to state.
 */
function SatReadingWorkspaceStub({ hasStimulus }: { hasStimulus: boolean }) {
  const { registerWorkspace } = useSatReadingLayout();
  useEffect(() => {
    const element = document.createElement('div');
    registerWorkspace(element, hasStimulus);
    return () => registerWorkspace(null, false);
  }, [hasStimulus, registerWorkspace]);
  return null;
}

export interface SatReadingLayoutHarnessProps {
  box: { width: number; height: number };
  preferences?: SatReadingPreferences;
  measure?: SatReadingLayoutProviderProps['measure'];
  /** True when the question on screen has a passage beside it (the default). */
  hasStimulus?: boolean;
  children: ReactNode;
}

export function SatReadingLayoutHarness({
  box,
  preferences,
  measure,
  hasStimulus = true,
  children,
}: SatReadingLayoutHarnessProps) {
  return (
    <SatReadingLayoutProvider
      preferences={preferences ?? createSatReadingPreferences()}
      measure={measure ?? (() => box)}
    >
      <SatReadingWorkspaceStub hasStimulus={hasStimulus} />
      {children}
    </SatReadingLayoutProvider>
  );
}
