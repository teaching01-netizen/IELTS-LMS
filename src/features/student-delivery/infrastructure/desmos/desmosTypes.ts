export type DesmosCalculatorMode = 'scientific' | 'graphing';

/**
 * The exam shell is a controlled-locale surface. The embedded calculator
 * MUST follow the exam locale — never the browser (navigator.language).
 *
 * Locale approach: the locale is an explicit query parameter on the Desmos
 * College Board testing embed URL (`?embed&lang=<locale>`), so the exam
 * requests English deterministically. SAT_EXAM_LOCALE is the single frozen
 * exam value; callers pass it through desmosEmbedUrl instead of building
 * URLs by hand.
 *
 * Fallback: if the College Board testing embed ignores the lang parameter
 * (cross-origin upstream behaviour outside our control), the embed keeps
 * the embedded base path + ?embed marker and loads its default UI. That is
 * a locale-agnostic framing — the URL contract below still holds and the
 * failure is documented in the phase verification log, never claimed fixed
 * without browser proof (see plans-sat-tools/phase-03 §6).
 */
export type DesmosLocale = 'en' | 'en-US';
export const SAT_EXAM_LOCALE: DesmosLocale = 'en';

export function desmosEmbedUrl(
  mode: DesmosCalculatorMode,
  locale: DesmosLocale = SAT_EXAM_LOCALE,
): string {
  const base = 'https://www.desmos.com/testing/collegeboard/' + mode;
  return base + '?embed&lang=' + encodeURIComponent(locale);
}
