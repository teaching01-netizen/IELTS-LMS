/**
 * The Bluebook cross-out (eliminator) glyph.
 *
 * Drawn here on purpose rather than borrowed from an icon set: the reference
 * affordance is typographic — the letters ABC with a diagonal strike through
 * them — and a generic "crossed-out list" icon reads as a different tool. The
 * letters carry the ink (`currentColor`), the strike is `bg-current`, so callers
 * describe a state with a color pair and the whole glyph follows it.
 *
 * Geometry lives in the caller's `className`: the header toggle wears the 36px
 * box inside its 44px hit target, and the per-choice control the 28px one.
 */

export type SatCutChoiceGlyphSize = "md" | "sm";

export interface SatCutChoiceGlyphProps {
  /** Box size: `md` (36px) for the header toggle, `sm` (28px) per answer row. */
  size?: SatCutChoiceGlyphSize | undefined;
  /** Box ink and surface, e.g. outline vs. filled-accent when armed. */
  className?: string | undefined;
}

const GLYPH_BOX: Record<SatCutChoiceGlyphSize, string> = {
  md: "h-9 w-9 text-[9px]",
  sm: "h-7 w-7 text-[8px]",
};

export function SatCutChoiceGlyph({ size = "md", className }: SatCutChoiceGlyphProps) {
  return (
    <span
      // Decorative: the control that owns this glyph is named by its label.
      aria-hidden="true"
      data-sat-eliminator-glyph="true"
      data-sat-eliminator-glyph-size={size}
      // `overflow-hidden` clips the strike to the box, so the slash runs corner
      // to corner at any size instead of needing a per-size length.
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-[6px] border font-semibold leading-none tracking-[-0.03em] ${GLYPH_BOX[size]} ${className ?? ""}`}
    >
      ABC
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-[1.5px] w-[150%] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current" />
    </span>
  );
}
