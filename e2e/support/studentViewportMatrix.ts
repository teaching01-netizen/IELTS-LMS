export type StudentViewportCase = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly expectedLayoutMode: 'compact' | 'medium' | 'wide';
  readonly category: 'phone' | 'tablet' | 'boundary' | 'desktop';
};

export const STUDENT_VIEWPORT_MATRIX = [
  {
    name: 'phone portrait',
    width: 390,
    height: 844,
    expectedLayoutMode: 'compact',
    category: 'phone',
  },
  {
    name: 'phone landscape',
    width: 844,
    height: 390,
    expectedLayoutMode: 'medium',
    category: 'phone',
  },
  {
    name: 'compact regression',
    width: 360,
    height: 800,
    expectedLayoutMode: 'compact',
    category: 'phone',
  },
  {
    name: 'small tablet portrait',
    width: 768,
    height: 1024,
    expectedLayoutMode: 'medium',
    category: 'tablet',
  },
  {
    name: 'small tablet landscape',
    width: 1024,
    height: 768,
    expectedLayoutMode: 'medium',
    category: 'tablet',
  },
  {
    name: 'large tablet portrait',
    width: 834,
    height: 1194,
    expectedLayoutMode: 'medium',
    category: 'tablet',
  },
  {
    name: 'large tablet landscape',
    width: 1194,
    height: 834,
    expectedLayoutMode: 'medium',
    category: 'tablet',
  },
  {
    name: 'medium boundary',
    width: 1199,
    height: 900,
    expectedLayoutMode: 'medium',
    category: 'boundary',
  },
  {
    name: 'wide boundary',
    width: 1200,
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
