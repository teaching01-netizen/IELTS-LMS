import type { CSSProperties } from "react";

/**
 * How an image is presented, in one place.
 *
 * The authoring editor and the student surface both render the same structured
 * content, so a rule that lives twice can disagree — and did: alignment was
 * applied to the editor's image but to a full-width wrapper for students, which
 * made "Align left" a no-op on the surface that actually matters. Everything
 * that decides where a visual sits now comes from here.
 *
 * The vocabulary is the document's, not the UI's: `align` and `size` are the
 * attributes the shared image node stores, and `null` (or anything unrecognised)
 * means "as it was before these choices existed" — centred at the column's
 * natural width — so content authored earlier renders unchanged.
 *
 * The two choices are deliberately orthogonal:
 *
 *   size   → how wide the visual's box is, and where that box sits in the column
 *   align  → where the visual sits inside its box, at any width
 *
 * which is why alignment works on its own, without a size.
 */

export type SatImageAlign = "left" | "center" | "right";
export type SatImageSize = "small" | "medium" | "large";

/** The document's vocabulary, shared with the image node's attribute validation. */
export const SAT_IMAGE_ALIGN_VALUES: readonly SatImageAlign[] = ["left", "center", "right"];
export const SAT_IMAGE_SIZE_VALUES: readonly SatImageSize[] = ["small", "medium", "large"];

export const IMAGE_ALIGN_OPTIONS: readonly { value: SatImageAlign; label: string }[] = [
  { value: "left", label: "Align left" },
  { value: "center", label: "Align center" },
  { value: "right", label: "Align right" },
];

/**
 * Sizes are fractions of the reading column, not pixels: the same question is
 * authored on a laptop, reviewed in a sheet, and answered on a tablet at a
 * split pane, and only a relative width survives all three.
 */
export const IMAGE_SIZE_OPTIONS: readonly { value: SatImageSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

export const IMAGE_SIZE_FRACTIONS: Record<SatImageSize, string> = {
  small: "40%",
  medium: "70%",
  large: "100%",
};

export interface ImageObjectAttrs {
  [key: string]: unknown;
}

export function imageAlignFromAttrs(attrs: ImageObjectAttrs): SatImageAlign | null {
  const value = attrs["align"];
  return SAT_IMAGE_ALIGN_VALUES.find((candidate) => candidate === value) ?? null;
}

export function imageSizeFromAttrs(attrs: ImageObjectAttrs): SatImageSize | null {
  const value = attrs["size"];
  return SAT_IMAGE_SIZE_VALUES.find((candidate) => candidate === value) ?? null;
}

export interface SatImagePresentation {
  /** The visual's box: its width when sized, and where the box sits. */
  figure: CSSProperties;
  /** The visual inside that box. Empty for the default, so untouched content keeps its shape. */
  content: CSSProperties;
}

/**
 * Where a visual sits inside its box.
 *
 * Both surfaces align the image element itself with auto margins: the editor's
 * image is a block in a block, the student's is a flex item in a centred row,
 * and auto margins position either one. Centring is left to the existing
 * layout, so an author who never chose an alignment gets a document with no
 * inline style at all.
 */
function contentStyle(align: SatImageAlign | null): CSSProperties {
  if (align === "left") return { marginInline: "0 auto" };
  if (align === "right") return { marginInline: "auto 0" };
  return {};
}

/** A sized visual also moves its box, so the whole block reads as left/centre/right. */
function figureStyle(size: SatImageSize | null, align: SatImageAlign | null): CSSProperties {
  if (!size) return {};
  const marginInline = align === "left" ? "0 auto" : align === "right" ? "auto 0" : "auto";
  return { maxWidth: IMAGE_SIZE_FRACTIONS[size], marginInline };
}

export function satImagePresentation(attrs: ImageObjectAttrs): SatImagePresentation {
  const align = imageAlignFromAttrs(attrs);
  const size = imageSizeFromAttrs(attrs);
  return { figure: figureStyle(size, align), content: contentStyle(align) };
}
