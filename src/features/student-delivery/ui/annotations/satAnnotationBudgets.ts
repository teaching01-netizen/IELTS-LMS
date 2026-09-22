import {
  resolveSelectionMenuBudgets,
  SELECTION_MENU_BUDGET_DEFAULTS,
  type SelectionMenuBudgets,
} from '@shared/ui/selection-v2/engine/selectionPlacement';

/**
 * SAT's numbers for the shared placement rule, and where they come from.
 *
 * The rule is one function for every product (`placeSelectionMenu`); what a
 * product owns is the budget it is evaluated against. They live here, with the
 * reader that loads them, because they are ONE piece of vocabulary: the engine
 * takes them as input, CSS declares them as `--sat-annotation-*` tokens, and
 * nobody should have to open a second file to find out which value wins. The
 * reader is table-driven for the same reason — adding a budget means adding one
 * row, not editing a list of hand-written lookups that can silently drift from
 * the defaults beside them.
 *
 * The defaults are the shared ones: SAT asks for nothing unusual, and the two
 * tables used to be identical copies of each other. What SAT does own is the
 * token names, so a retheme can move the toolbar without touching the engine.
 */

/** SAT's budgets are the shared budgets; this name is what SAT's CSS tokens fill. */
export type SatAnnotationBudgets = SelectionMenuBudgets;

export const SAT_ANNOTATION_BUDGET_DEFAULTS: SatAnnotationBudgets = SELECTION_MENU_BUDGET_DEFAULTS;

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
 * serves every number, so placement stays one measurement, not eight.
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
 * SAT's budget, resolved by the shared rule's own resolver: a coarse pointer
 * reserves the native menu's lane and asks for the roomier comfort buffer, and
 * nothing else distinguishes the two worlds.
 */
export function resolveSatAnnotationBudgets(
  touch: boolean,
  overrides: Partial<SatAnnotationBudgets> | undefined = {},
): SatAnnotationBudgets {
  return resolveSelectionMenuBudgets(touch, { ...SAT_ANNOTATION_BUDGET_DEFAULTS, ...overrides });
}
