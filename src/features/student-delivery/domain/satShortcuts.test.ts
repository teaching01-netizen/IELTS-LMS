import { describe, expect, it } from "vitest";
import { detectSatShortcutPlatform, formatSatShortcut, isSatShortcutEditableTarget, SAT_SHORTCUTS } from "./satShortcuts";

describe("satShortcuts", () => {
  it("lists every Bluebook tool group without duplicate display strings", () => {
    const groups = new Set(SAT_SHORTCUTS.map((s) => s.group));
    expect(groups.has("navigation")).toBe(true);
    expect(groups.has("tools")).toBe(true);
    expect(groups.has("display")).toBe(true);
    const windows = SAT_SHORTCUTS.map((s) => s.windows);
    expect(new Set(windows).size).toBe(windows.length);
  });

  it("formats OS-specific modifiers", () => {
    const calc = SAT_SHORTCUTS.find((s) => s.id === "calculator")!;
    expect(formatSatShortcut(calc, "windows")).toContain("Ctrl");
    expect(formatSatShortcut(calc, "macos")).not.toContain("Ctrl");
  });

  it("detects platforms and editable targets", () => {
    expect(detectSatShortcutPlatform("MacIntel")).toBe("macos");
    expect(detectSatShortcutPlatform("Win32")).toBe("windows");
    expect(detectSatShortcutPlatform("CrOS x86_64")).toBe("chromeos");
    const input = document.createElement("input");
    expect(isSatShortcutEditableTarget(input)).toBe(true);
    expect(isSatShortcutEditableTarget(document.createElement("div"))).toBe(false);
    expect(isSatShortcutEditableTarget(null)).toBe(false);
  });
});
