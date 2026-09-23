import {
  SELECTION_MENU_BUDGET_DEFAULTS,
  type SelectionMenuBudgets,
} from '@shared/ui/selection-v2/engine/selectionPlacement';

/** SAT CSS token adapter; the shared placement engine owns geometry decisions. */

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
