import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_ALIGN_OPTIONS,
  IMAGE_SIZE_FRACTIONS,
  IMAGE_SIZE_OPTIONS,
  downloadImageOriginal,
  imageAlignFromAttrs,
  imageContentStyle,
  imageFigureStyle,
  imageSizeFromAttrs,
} from "../imageObjectActions";

afterEach(() => vi.restoreAllMocks());

describe("image alignment and size as document data", () => {
  it("accepts only the values the surfaces offer", () => {
    expect(imageAlignFromAttrs({ align: "left" })).toBe("left");
    expect(imageAlignFromAttrs({ align: "middle" })).toBeNull();
    expect(imageAlignFromAttrs({})).toBeNull();
    expect(imageSizeFromAttrs({ size: "medium" })).toBe("medium");
    expect(imageSizeFromAttrs({ size: "huge" })).toBeNull();
    expect(IMAGE_ALIGN_OPTIONS.map((option) => option.label)).toEqual(["Align left", "Align center", "Align right"]);
    expect(IMAGE_SIZE_OPTIONS.map((option) => option.label)).toEqual(["Small", "Medium", "Large"]);
  });

  it("leaves untouched visuals exactly as they were", () => {
    expect(imageFigureStyle({})).toEqual({});
    expect(imageFigureStyle({ align: "left" })).toEqual({});
    expect(imageContentStyle({})).toEqual({ marginInline: "auto" });
    expect(imageContentStyle({ align: "center" })).toEqual({ marginInline: "auto" });
  });

  it("expresses size as a fraction of the reading column so it survives every pane", () => {
    expect(imageFigureStyle({ size: "small" })).toEqual({ maxWidth: IMAGE_SIZE_FRACTIONS.small, marginInline: "auto" });
    expect(imageFigureStyle({ size: "large", align: "right" })).toEqual({ maxWidth: "100%", marginInline: "auto 0" });
    expect(imageContentStyle({ align: "right" })).toEqual({ marginInline: "auto 0" });
    expect(imageContentStyle({ align: "left" })).toEqual({ marginInline: "0 auto" });
  });
});

describe("download original", () => {
  it("uses a direct source without asking the media service", async () => {
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.href);
    });
    const resolve = vi.fn(async () => ({ downloadUrl: null }));
    await downloadImageOriginal({ src: "https://cdn.example.test/graph.png" }, resolve);
    expect(clicks).toEqual(["https://cdn.example.test/graph.png"]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("resolves a managed asset through the injected resolver", async () => {
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.href);
    });
    const resolve = vi.fn(async (assetId: string) => ({
      downloadUrl: `/api/v1/media/${assetId}/content`,
    }));
    await downloadImageOriginal({ assetId: "asset-1" }, resolve);
    expect(resolve).toHaveBeenCalledWith("asset-1");
    // The anchor resolves relative URLs against the document base, as a browser
    // anchor would.
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toContain("/api/v1/media/asset-1/content");
  });

  it("does nothing, and never throws, when there is no original to hand over", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await downloadImageOriginal({}, vi.fn(async () => ({ downloadUrl: null })));
    await downloadImageOriginal({ assetId: "asset-1" }, vi.fn(async () => {
      throw new Error("offline");
    }));
    expect(click).not.toHaveBeenCalled();
  });
});
