import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadImageOriginal } from "../imageObjectActions";

afterEach(() => vi.restoreAllMocks());

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
