import { describe, expect, it } from "vitest";
import {
  IMAGE_ALIGN_OPTIONS,
  IMAGE_SIZE_FRACTIONS,
  IMAGE_SIZE_OPTIONS,
  SAT_IMAGE_ALIGN_VALUES,
  SAT_IMAGE_SIZE_VALUES,
  imageAlignFromAttrs,
  imageSizeFromAttrs,
  satImagePresentation,
} from "../../api/satImagePresentation";

describe("how an image is presented", () => {
  it("accepts only the values the surfaces offer", () => {
    expect(imageAlignFromAttrs({ align: "left" })).toBe("left");
    expect(imageAlignFromAttrs({ align: "middle" })).toBeNull();
    expect(imageAlignFromAttrs({})).toBeNull();
    expect(imageSizeFromAttrs({ size: "medium" })).toBe("medium");
    expect(imageSizeFromAttrs({ size: "huge" })).toBeNull();
    expect(SAT_IMAGE_ALIGN_VALUES).toEqual(["left", "center", "right"]);
    expect(SAT_IMAGE_SIZE_VALUES).toEqual(["small", "medium", "large"]);
    expect(IMAGE_ALIGN_OPTIONS.map((option) => option.label)).toEqual([
      "Align left",
      "Align center",
      "Align right",
    ]);
    expect(IMAGE_SIZE_OPTIONS.map((option) => option.label)).toEqual(["Small", "Medium", "Large"]);
  });

  it("leaves untouched visuals exactly as they were", () => {
    // No size, no alignment: no inline styles at all, so the document carries
    // no trace of choices the author never made.
    expect(satImagePresentation({})).toEqual({ figure: {}, content: {} });
    expect(satImagePresentation({ align: "center" })).toEqual({ figure: {}, content: {} });
    expect(satImagePresentation({ align: "unknown", size: "huge" })).toEqual({
      figure: {},
      content: {},
    });
  });

  it("moves the visual inside its box when the author only chooses an alignment", () => {
    // The bug this rule exists to prevent: alignment used to land on a
    // full-width box, where it could not move anything.
    expect(satImagePresentation({ align: "left" }).content).toEqual({ marginInline: "0 auto" });
    expect(satImagePresentation({ align: "right" }).content).toEqual({ marginInline: "auto 0" });
    expect(satImagePresentation({ align: "left" }).figure).toEqual({});
  });

  it("expresses size as a fraction of the reading column so it survives every pane", () => {
    expect(satImagePresentation({ size: "small" }).figure).toEqual({
      maxWidth: IMAGE_SIZE_FRACTIONS.small,
      marginInline: "auto",
    });
    expect(satImagePresentation({ size: "large", align: "right" }).figure).toEqual({
      maxWidth: "100%",
      marginInline: "auto 0",
    });
    // A sized visual also moves its box, so the whole block reads as aligned.
    expect(satImagePresentation({ size: "medium", align: "left" }).figure).toEqual({
      maxWidth: "70%",
      marginInline: "0 auto",
    });
  });
});
