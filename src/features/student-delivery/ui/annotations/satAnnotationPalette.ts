import type { SatHighlightColor } from '../../domain/satResponses';
import { defaultSatHighlightColor, SAT_HIGHLIGHT_COLORS } from '../../domain/satResponses';

/**
 * Highlight ink palette (Highlights & Notes).
 *
 * Values are CSS custom-property references with literal fallbacks, so a mark
 * always paints even when the token sheet has not loaded. Yellow reuses the
 * canonical `--sat-highlight-background` / `--sat-highlight-text` pair every
 * stored payload has always rendered with — colors were added without
 * restyling what already existed.
 */
export interface SatHighlightInk {
  color: SatHighlightColor;
  /** Student-facing label ("Yellow"), used on swatches and in announcements. */
  label: string;
  /** Mark background (also the selection preview tint). */
  background: string;
  /** Mark text color, chosen per ink for contrast. */
  foreground: string;
  /** Swatch chip fill. */
  swatch: string;
}

export const satHighlightInks: Record<SatHighlightColor, SatHighlightInk> = {
  yellow: {
    color: 'yellow',
    label: 'Yellow',
    background: 'var(--sat-highlight-background, #FFF2B3)',
    foreground: 'var(--sat-highlight-text, #1d1d1f)',
    swatch: 'var(--sat-swatch-yellow, #F2DE8C)',
  },
  blue: {
    color: 'blue',
    label: 'Blue',
    background: 'var(--sat-highlight-bg-blue, #D6E6FB)',
    foreground: 'var(--sat-highlight-text-blue, #1d1d1f)',
    swatch: 'var(--sat-swatch-blue, #9CC3F2)',
  },
  pink: {
    color: 'pink',
    label: 'Pink',
    background: 'var(--sat-highlight-bg-pink, #FBDBE6)',
    foreground: 'var(--sat-highlight-text-pink, #1d1d1f)',
    swatch: 'var(--sat-swatch-pink, #F0AFC8)',
  },
};

/** Palette in presentation order (Yellow first: it is the default action). */
export const satHighlightInkList: readonly SatHighlightInk[] = SAT_HIGHLIGHT_COLORS.map(
  (color) => satHighlightInks[color],
);

export function satHighlightInk(color: SatHighlightColor | undefined): SatHighlightInk {
  return satHighlightInks[color ?? defaultSatHighlightColor];
}

/** Inline style for a highlight span of the given ink. */
export function satHighlightMarkStyle(color: SatHighlightColor | undefined): {
  backgroundColor: string;
  color: string;
} {
  const ink = satHighlightInk(color);
  return { backgroundColor: ink.background, color: ink.foreground };
}
