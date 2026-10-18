import { useEffect, useState } from 'react';

/** WebKit's `-apple-system-body` resolves to 17px at the default iOS/iPadOS text size. */
const APPLE_BODY_DEFAULT_PX = 17;
const SYSTEM_TEXT_SCALE_MAX = 1.6;

/**
 * Reads the iPad/iPhone Text Size (Dynamic Type) setting through WebKit's
 * `-apple-system-body` font. Returns 1 where that font is unsupported, and
 * on devices without touch: macOS Safari resolves it to 13px, which is not
 * a user preference.
 *
 * Only enlargement is honored (1–1.6×). Exam type is already tuned at its
 * 18px default; shrinking it for a smaller system setting would trade
 * legibility for density.
 */
export function readSystemTextScale(targetWindow: Window = window): number {
  const { document: doc, navigator: nav } = targetWindow;
  const css = (targetWindow as Window & { CSS?: typeof CSS }).CSS;
  if (
    !doc?.body ||
    !(nav.maxTouchPoints > 0) ||
    typeof css?.supports !== 'function' ||
    !css.supports('font', '-apple-system-body')
  ) {
    return 1;
  }

  const probe = doc.createElement('span');
  probe.style.font = '-apple-system-body';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.textContent = 'A';
  doc.body.appendChild(probe);
  const px = Number.parseFloat(targetWindow.getComputedStyle(probe).fontSize);
  probe.remove();

  if (!Number.isFinite(px) || px <= 0) {
    return 1;
  }
  const scale = Math.min(SYSTEM_TEXT_SCALE_MAX, Math.max(1, px / APPLE_BODY_DEFAULT_PX));
  return Math.round(scale * 100) / 100;
}

/**
 * Follows the system Text Size while `enabled`, re-reading when the student
 * returns to the exam (the setting is changed from Settings or Control
 * Center, which backgrounds the page).
 */
export function useSystemTextScale(enabled: boolean): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setScale(1);
      return;
    }
    const update = () => setScale(readSystemTextScale(window));
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, [enabled]);

  return scale;
}

/**
 * Applies a text scale to the document root while mounted, so every rem
 * token — exam text, controls and portalled dialogs alike — grows together,
 * the same way browser text zoom does. The previous inline value is
 * restored on exit, so other routes never inherit it.
 */
export function useRootTextScale(scale: number): void {
  useEffect(() => {
    if (scale === 1 || typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = `${scale * 100}%`;
    return () => {
      root.style.fontSize = previous;
    };
  }, [scale]);
}

/** Tracks a media query such as `(prefers-contrast: more)`. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query)?.matches),
  );

  useEffect(() => {
    const list = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
    if (!list) {
      return;
    }
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);

  return matches;
}
