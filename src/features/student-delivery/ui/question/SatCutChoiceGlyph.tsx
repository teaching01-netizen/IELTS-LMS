/**
 * The Bluebook cross-out (eliminator) glyph, in the two shapes the exam uses.
 *
 * They are drawn here on purpose rather than borrowed from an icon set: both
 * affordances are typographic, and a generic "crossed-out list" icon reads as a
 * different tool.
 *
 * - `header`: the letters ABC with a diagonal strike, inside a box. This is the
 *   control that ARMS the eliminator in the question header. The letters carry
 *   the ink (`currentColor`) and the strike is `bg-current`, so callers describe
 *   a state with a color pair and the whole glyph follows it.
 * - `choice`: one answer choice's own cut control — the option letter inside a
 *   circle, flanked by two short dashes (`— Ⓐ —`). Bluebook names the choice it
 *   crosses out, so the letter is part of the glyph rather than a generic mark.
 *
 * Geometry lives in the caller's `className`: the header toggle wears the 36px
 * box inside its 44px hit target. The choice glyph is deliberately small (the
 * visible ink is ~40x18px) and relies on the caller's 44px hit target for touch.
 */

export type SatCutChoiceGlyphVariant = "header" | "choice";

export type SatCutChoiceGlyphSize = "md" | "sm";

export interface SatCutChoiceGlyphProps {
  /** Which affordance to draw. Defaults to the header eliminator toggle. */
  variant?: SatCutChoiceGlyphVariant | undefined;
  /** Box size for the `header` variant: `md` (36px) or `sm` (28px). */
  size?: SatCutChoiceGlyphSize | undefined;
  /** Required by `variant="choice"`: the letter the connected control cuts. */
  letter?: string | undefined;
  /** Box ink and surface, e.g. outline vs. filled-accent when armed. */
  className?: string | undefined;
}

const GLYPH_BOX: Record<SatCutChoiceGlyphSize, string> = {
  md: "h-9 w-9 text-[9px]",
  sm: "h-7 w-7 text-[8px]",
};

/** One short dash of the `— Ⓐ —` choice glyph, on the letter's center line. */
const CHOICE_DASH = "h-[1.5px] w-2 shrink-0 rounded-full bg-current";

export function SatCutChoiceGlyph(props: SatCutChoiceGlyphProps) {
  const { variant = "header", size = "md", letter, className } = props;

  if (variant === "choice") {
    return (
      <span
        // Decorative: the control that owns this glyph is named by its label.
        aria-hidden="true"
        data-sat-eliminator-glyph="choice"
        data-sat-eliminator-glyph-letter={letter}
        className={`inline-flex shrink-0 items-center gap-[3px] ${className ?? ""}`}
      >
        <span className={CHOICE_DASH} />
        {/* The circle is the letter's marker, so the strike reads as crossing
            out THAT choice — the same letter the answer row shows. */}
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-current text-[11px] font-semibold leading-none">
          {letter}
        </span>
        <span className={CHOICE_DASH} />
      </span>
    );
  }

  return (
    <span
      // Decorative: the control that owns this glyph is named by its label.
      aria-hidden="true"
      data-sat-eliminator-glyph="header"
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
