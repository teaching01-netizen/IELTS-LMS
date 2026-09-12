export type StudentLayoutModeE2E = 'phone' | 'compact' | 'standard' | 'wide';

export type StudentViewportCase = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly expectedLayoutMode: StudentLayoutModeE2E;
  readonly category: 'phone' | 'tablet' | 'boundary' | 'desktop';
};

/**
 * P2.2 — the viewport matrix follows the four-mode geometry contract in
 * plans/ielts-act-ux-production/design-contract.md:
 *   phone <600px; compact 600-899; standard 900-1179 (shell height >=600);
 *   wide >=1180 (shell height >=650); split additionally requires pane-fit.
 * Height thresholds refer to the OUTER stable shell, so the expected modes
 * below assume typical browser chrome deductions on small landscape devices.
 */
export const STUDENT_VIEWPORT_MATRIX = [
  {
    name: 'phone portrait',
    width: 390,
    height: 844,
    expectedLayoutMode: 'phone',
    category: 'phone',
  },
  {
    name: 'phone landscape',
    width: 844,
    height: 390,
    expectedLayoutMode: 'compact',
    category: 'phone',
  },
  {
    name: 'compact regression',
    width: 360,
    height: 800,
    expectedLayoutMode: 'phone',
    category: 'phone',
  },
  {
    name: 'small tablet portrait',
    width: 768,
    height: 1024,
    expectedLayoutMode: 'compact',
    category: 'tablet',
  },
  {
    name: 'small tablet landscape',
    width: 1024,
    height: 768,
    expectedLayoutMode: 'standard',
    category: 'tablet',
  },
  {
    name: 'large tablet portrait',
    width: 834,
    height: 1194,
    expectedLayoutMode: 'compact',
    category: 'tablet',
  },
  {
    name: 'large tablet landscape',
    width: 1194,
    height: 834,
    expectedLayoutMode: 'wide',
    category: 'tablet',
  },
  {
    name: 'standard boundary',
    width: 899,
    height: 900,
    expectedLayoutMode: 'compact',
    category: 'boundary',
  },
  {
    name: 'standard lower boundary',
    width: 900,
    height: 900,
    expectedLayoutMode: 'standard',
    category: 'boundary',
  },
  {
    name: 'wide boundary',
    width: 1180,
    height: 900,
    expectedLayoutMode: 'wide',
    category: 'boundary',
  },
  {
    name: 'desktop',
    width: 1440,
    height: 900,
    expectedLayoutMode: 'wide',
    category: 'desktop',
  },
] as const satisfies readonly StudentViewportCase[];

export const STUDENT_PR_CRITICAL_VIEWPORTS = STUDENT_VIEWPORT_MATRIX.filter(
  ({ name }) =>
    name === 'phone portrait' ||
    name === 'small tablet portrait' ||
    name === 'small tablet landscape' ||
    name === 'large tablet landscape' ||
    name === 'desktop',
);

export const STUDENT_NAVIGATOR_VIEWPORTS = STUDENT_VIEWPORT_MATRIX.filter(
  ({ name }) =>
    name === 'phone portrait' ||
    name === 'small tablet portrait' ||
    name === 'small tablet landscape',
);
