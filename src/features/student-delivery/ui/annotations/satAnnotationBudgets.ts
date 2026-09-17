/**
 * The numbers that decide where the floating annotation surface sits, and where
 * they come from.
 *
 * They live here, with the reader that loads them, because they are ONE piece of
 * vocabulary: the placement engine takes them as input, CSS declares them, and
 * nobody should have to open a second file to find out which value wins. The
 * reader is table-driven for the same reason — adding a budget means adding one
 * row, not editing a list of twelve hand-written lookups that can silently drift
 * from the defaults beside them.
 *
 * Defaults matter twice: they are what the engine uses in a renderer with no
 * style resolution (jsdom, a headless pass) and what a malformed or missing
 * token falls back to in a browser.
 */
export interface SatAnnotationBudgets {
  /** Smallest distance the surface keeps from any visible edge. */
  edge: number;
  /**
   * Height the native selection menu needs. On a coarse pointer this answers one
   * question — does the menu fit above the selection? — because iOS puts it there
   * when it does and flips it below when it does not, and it is painted OVER our
   * surface. So this decides WHICH LANE the menu will take, and therefore which
   * lane is left for us, rather than how far from the selection our own lane has
   * to start. Zero under a mouse, where no menu exists and no lane is given up.
   */
  nativeUiZone: number;
  /** Breathing room between the selection and the surface. */
  gap: number;
  /** Extra room demanded on touch, so "comfortable" is not "just fits". */
  comfort: number;
  /** The same idea for a mouse, where just-fits is merely tight. */
  comfortFine: number;
  /** Keeps the caret away from the surface's rounded corners. */
  caretInset: number;
  /** Extra room a side must offer to justify moving to it. */
  switchMargin: number;
  /** A move larger than this settles; anything smaller is applied directly. */
  stableDelta: number;
}

export const SAT_ANNOTATION_BUDGET_DEFAULTS: SatAnnotationBudgets = {
  edge: 12,
  nativeUiZone: 80,
  gap: 12,
  comfort: 24,
  comfortFine: 12,
  caretInset: 20,
  switchMargin: 24,
  stableDelta: 8,
};

/** Which CSS custom property carries which budget. */
const BUDGET_TOKENS: ReadonlyArray<readonly [keyof SatAnnotationBudgets, string]> = [
  ['edge', '--sat-annotation-edge'],
  ['nativeUiZone', '--sat-annotation-native-ui-zone'],
  ['gap', '--sat-annotation-gap'],
  ['comfort', '--sat-annotation-comfort'],
  ['comfortFine', '--sat-annotation-comfort-fine'],
  ['caretInset', '--sat-annotation-caret-inset'],
  ['switchMargin', '--sat-annotation-switch-margin'],
  ['stableDelta', '--sat-annotation-stable-delta'],
];

function rootStyle(): CSSStyleDeclaration | null {
  try {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
    return getComputedStyle(document.documentElement);
  } catch {
    return null;
  }
}

/**
 * The budget for this environment: the token sheet first, the compiled-in
 * defaults only where a token is missing or unreadable. One style resolution
 * serves every number, so placement stays one measurement, not twelve.
 */
export function readSatAnnotationBudgets(): SatAnnotationBudgets {
  const style = rootStyle();
  const budgets: SatAnnotationBudgets = { ...SAT_ANNOTATION_BUDGET_DEFAULTS };
  if (!style) return budgets;
  for (const [key, token] of BUDGET_TOKENS) {
    const parsed = Number.parseFloat(style.getPropertyValue(token));
    if (Number.isFinite(parsed) && parsed >= 0) budgets[key] = parsed;
  }
  return budgets;
}

/** A duration token, in seconds, for the handful of places that need one. */
export function readSatAnnotationSeconds(variable: string, fallbackSeconds: number): number {
  const raw = rootStyle()?.getPropertyValue(variable) ?? '';
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackSeconds;
  return parsed / 1000;
}

/**
 * Resolve a budget for this input. A coarse pointer is the only difference
 * between the two worlds: it introduces the native selection menu, whose lane is
 * reserved for the browser (see `placeSatAnnotationSurface`), and it asks for a
 * comfort buffer rather than a mouse's tighter one.
 */
export function resolveSatAnnotationBudgets(
  touch: boolean,
  overrides: Partial<SatAnnotationBudgets> | undefined = {},
): SatAnnotationBudgets {
  const merged: SatAnnotationBudgets = { ...SAT_ANNOTATION_BUDGET_DEFAULTS, ...overrides };
  return {
    ...merged,
    nativeUiZone: touch ? merged.nativeUiZone : 0,
    comfort: touch ? merged.comfort : merged.comfortFine,
  };
}
