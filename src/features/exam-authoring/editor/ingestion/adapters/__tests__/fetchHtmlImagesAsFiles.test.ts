import { describe, expect, it, vi } from "vitest";
import { extractHtmlImageRefs } from "../htmlImageRefs";
import { fetchHtmlImagesAsFiles } from "../fetchHtmlImagesAsFiles";

const PNG_DATA = "iVBORw0KGgo=";

function response(body: BodyInit, mime = "image/png", headers?: Record<string, string>): Response {
  return new Response(body, { status: 200, headers: { "content-type": mime, ...headers } });
}

describe("HTML image references", () => {
  it("extracts unique sources in document order and reports the cap", () => {
    const out = extractHtmlImageRefs(
      '<p><img src="https://cdn.test/a.png" alt=" A "><img src="https://cdn.test/a.png"><img src="blob:test"><img src="https://cdn.test/b.png"><img src="https://cdn.test/c.png"></p>',
      2
    );
    expect(out.refs).toEqual([
      { src: "https://cdn.test/a.png", alt: "A" },
      { src: "blob:test", alt: "" },
    ]);
    expect(out.truncated).toBe(2);
  });
});

describe("fetchHtmlImagesAsFiles", () => {
  it("decodes an accepted data URL locally without calling fetch", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const out = await fetchHtmlImagesAsFiles(
      [{ src: "data:image/png;base64," + PNG_DATA, alt: "diagram" }],
      { fetchFn }
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(out.rejected).toEqual([]);
    expect(out.images).toHaveLength(1);
    expect(out.images[0]?.alt).toBe("diagram");
    expect(out.images[0]?.file.type).toBe("image/png");
  });

  it.each([
    ["http://cdn.test/a.png", "scheme"],
    ["blob:https://app.test/id", "scheme"],
    ["/relative.png", "scheme"],
    ["javascript:alert(1)", "scheme"],
  ] as const)("rejects unsafe source %s before fetch", async (src, reason) => {
    const fetchFn = vi.fn<typeof fetch>();
    const out = await fetchHtmlImagesAsFiles([{ src, alt: "" }], { fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(out.images).toEqual([]);
    expect(out.rejected[0]?.reason).toBe(reason);
  });

  it("classifies malformed data URLs as decode and oversized data URLs as size", async () => {
    const malformed = await fetchHtmlImagesAsFiles([
      { src: "data:image/png;base64,not@@base64", alt: "" },
    ]);
    expect(malformed.rejected[0]?.reason).toBe("decode");

    const oversized = await fetchHtmlImagesAsFiles(
      [{ src: "data:image/png;base64," + "A".repeat(32), alt: "" }],
      { maxBytes: 4 }
    );
    expect(oversized.rejected[0]?.reason).toBe("size");
  });

  it("rejects non-image responses and uses same-origin credentials", async () => {
    let request: RequestInfo | URL | undefined;
    let init: RequestInit | undefined;
    const fetchFn = vi.fn<typeof fetch>(async (input, options) => {
      request = input;
      init = options;
      return response("not an image", "text/html");
    });
    const out = await fetchHtmlImagesAsFiles([{ src: "https://cdn.test/a.png", alt: "" }], {
      fetchFn,
    });
    expect(out.images).toEqual([]);
    expect(out.rejected[0]?.reason).toBe("content-type");
    expect(request).toBe("https://cdn.test/a.png");
    expect(init?.credentials).toBe("same-origin");
  });

  it("keeps a valid image response body after checking its declared MIME", async () => {
    const out = await fetchHtmlImagesAsFiles([{ src: "https://cdn.test/body.png", alt: "" }], {
      fetchFn: vi.fn<typeof fetch>(async () => response("image bytes", "image/png")),
    });
    expect(out.rejected).toEqual([]);
    expect(out.images).toHaveLength(1);
    expect(out.images[0]?.file.type).toBe("image/png");
  });

  it("rejects declared and streamed oversized responses", async () => {
    const declared = await fetchHtmlImagesAsFiles(
      [{ src: "https://cdn.test/declared.png", alt: "" }],
      {
        fetchFn: vi.fn<typeof fetch>(async () =>
          response("x", "image/png", { "content-length": "11" })
        ),
        maxBytes: 10,
      }
    );
    expect(declared.rejected[0]?.reason).toBe("size");

    const streamed = await fetchHtmlImagesAsFiles(
      [{ src: "https://cdn.test/streamed.png", alt: "" }],
      {
        fetchFn: vi.fn<typeof fetch>(async () => response("0123456789x", "image/png")),
        maxBytes: 10,
      }
    );
    expect(streamed.rejected[0]?.reason).toBe("size");
  });

  it("rejects invalid schemes without making a network request", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const result = await fetchHtmlImagesAsFiles(
      [
        { src: "http://cdn.test/insecure.png", alt: "" },
        { src: "blob:unsafe", alt: "" },
        { src: "/relative.png", alt: "" },
      ],
      { fetchFn }
    );
    expect(result.images).toEqual([]);
    expect(result.rejected.map((item) => item.reason)).toEqual(["scheme", "scheme", "scheme"]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps timeout and fetch failures to visible rejection reasons", async () => {
    const timeout = await fetchHtmlImagesAsFiles([{ src: "https://cdn.test/slow.png", alt: "" }], {
      fetchFn: vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
      timeoutMs: 1,
    });
    expect(timeout.rejected[0]?.reason).toBe("timeout");

    const failed = await fetchHtmlImagesAsFiles([{ src: "https://cdn.test/error.png", alt: "" }], {
      fetchFn: vi.fn<typeof fetch>(async () => {
        throw new Error("network down");
      }),
    });
    expect(failed.rejected[0]?.reason).toBe("fetch");
  });
});
