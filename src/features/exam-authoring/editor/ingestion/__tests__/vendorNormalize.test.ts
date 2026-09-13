import { describe, expect, it } from "vitest";
import { detectVendor, stripVendorChrome } from "../adapters/vendorNormalize";

describe("detectVendor", () => {
  it("detects Word via MsoNormal", () => {
    expect(detectVendor('<p class="MsoNormal">hi</p>').vendor).toBe("word");
  });
  it("detects Google Docs via docs-internal-guid", () => {
    expect(detectVendor('<b id="docs-internal-guid">x</b>').vendor).toBe("gdocs");
  });
  it("returns none for plain html", () => {
    expect(detectVendor("<p>plain</p>").vendor).toBe("none");
  });
});

describe("stripVendorChrome", () => {
  it("unwraps o:p and strips mso classes/styles", () => {
    const out = stripVendorChrome('<p class="MsoNormal" style="mso-margin:1pt">Hi<o:p></o:p></p>', {
      vendor: "word",
      evidence: ["mso-marker"],
    });
    expect(out.html).toContain("Hi");
    expect(out.html).not.toContain("o:p");
    expect(out.html).not.toContain("MsoNormal");
    expect(out.transformations.some((t) => t.startsWith("vendor.word-chrome-removed"))).toBe(true);
  });
  it("unwraps docs-internal-guid host and cN classes", () => {
    const out = stripVendorChrome('<b id="docs-internal-guid"><span class="c1">Text</span></b>', {
      vendor: "gdocs",
      evidence: ["docs-internal-guid"],
    });
    expect(out.html).toContain("Text");
    expect(out.html).not.toContain("docs-internal-guid");
  });
  it("is a no-op for vendor none", () => {
    const out = stripVendorChrome("<p>x</p>", { vendor: "none", evidence: [] });
    expect(out.html).toBe("<p>x</p>");
    expect(out.transformations).toEqual([]);
  });
});
