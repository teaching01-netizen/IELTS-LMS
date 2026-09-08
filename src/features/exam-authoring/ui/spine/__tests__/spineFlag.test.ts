import { describe, expect, it, vi, beforeEach } from "vitest";
import { SPINE_STORAGE_KEY, isSpineEnabled } from "../spineFlag";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("isSpineEnabled", () => {
  it("is off by default with no param and no stored preference", () => {
    expect(isSpineEnabled(params(""))).toBe(false);
  });

  it("turns on with ?spine=1", () => {
    expect(isSpineEnabled(params("spine=1"))).toBe(true);
  });

  it("lets an explicit ?spine=0 param override a stored opt-in", () => {
    window.localStorage.setItem(SPINE_STORAGE_KEY, "1");
    expect(isSpineEnabled(params("spine=0"))).toBe(false);
  });

  it("lets an explicit ?spine=1 param override a stored opt-out", () => {
    window.localStorage.setItem(SPINE_STORAGE_KEY, "0");
    expect(isSpineEnabled(params("spine=1"))).toBe(true);
  });

  it("reads a stored opt-in when no param is present", () => {
    window.localStorage.setItem(SPINE_STORAGE_KEY, "1");
    expect(isSpineEnabled(params(""))).toBe(true);
  });

  it("reads a stored opt-out over the default-on rollout default", () => {
    window.localStorage.setItem(SPINE_STORAGE_KEY, "0");
    expect(isSpineEnabled(params(""), true)).toBe(false);
  });

  it("defaults on when the rollout default is on and nothing is stored", () => {
    expect(isSpineEnabled(params(""), true)).toBe(true);
  });

  it("treats unrelated param values as absent", () => {
    expect(isSpineEnabled(params("spine=yes"))).toBe(false);
    expect(isSpineEnabled(params("spine=yes"), true)).toBe(true);
  });

  it("survives denied storage without throwing", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      expect(isSpineEnabled(params(""))).toBe(false);
      expect(isSpineEnabled(params("spine=1"))).toBe(true);
    } finally {
      getItem.mockRestore();
    }
  });
});
