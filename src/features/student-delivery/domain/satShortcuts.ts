import type { SatToolActionId } from "./satToolActions";

export type SatShortcutPlatform = "windows" | "macos" | "chromeos" | "ipad" | "other";

export interface SatShortcutDefinition {
  id: string;
  action: SatToolActionId;
  label: string;
  group: "navigation" | "tools" | "display";
  /** Windows/Linux keystroke. */
  windows: string;
  /** macOS keystroke. */
  macos: string;
}

/**
 * Bluebook keyboard shortcuts (Phase 3). One table drives both the modal
 * display and the keydown matcher — display and behavior can never drift.
 *
 * Tool shortcuts converge on the same SatToolActionId as the click path
 * (see satToolActions). Display zoom shortcuts adjust examZoom prefs.
 *
 * Copy exemption: row labels live here (not SAT_COPY) so the matcher and
 * the modal read one table. Group headings, footnote, and modal chrome
 * come from SAT_COPY.shortcuts. No user-visible string exists in two places.
 */
export const SAT_SHORTCUTS: readonly SatShortcutDefinition[] = [
  { id: "next", action: "nextQuestion", label: "Next Question", group: "navigation", windows: "Ctrl + Alt + X", macos: "\u2303\u2325 + X" },
  { id: "prev", action: "previousQuestion", label: "Previous Question", group: "navigation", windows: "Ctrl + Alt + B", macos: "\u2303\u2325 + B" },
  { id: "menu", action: "questionMenu", label: "Question Menu", group: "navigation", windows: "Ctrl + Alt + G", macos: "\u2303\u2325 + G" },
  { id: "mark", action: "toggleMarkForReview", label: "Mark for Review", group: "tools", windows: "Ctrl + Alt + V", macos: "\u2303\u2325 + V" },
  { id: "highlights", action: "toggleHighlights", label: "Highlights & Notes", group: "tools", windows: "Ctrl + H", macos: "\u2318 + H" },
  { id: "lineReader", action: "toggleLineReader", label: "Line Reader", group: "tools", windows: "Ctrl + L", macos: "\u2318 + L" },
  { id: "calculator", action: "toggleCalculator", label: "Calculator", group: "tools", windows: "Ctrl + Alt + C", macos: "\u2303\u2325 + C" },
  { id: "reference", action: "toggleReference", label: "Reference Sheet", group: "tools", windows: "Ctrl + Alt + R", macos: "\u2303\u2325 + R" },
  { id: "eliminator", action: "toggleEliminatorMode", label: "Option Eliminator", group: "tools", windows: "Ctrl + Alt + O", macos: "\u2303\u2325 + O" },
  { id: "zoomIn", action: "zoomIn", label: "Zoom In", group: "display", windows: "Ctrl + +", macos: "\u2318 + +" },
  { id: "zoomOut", action: "zoomOut", label: "Zoom Out", group: "display", windows: "Ctrl + -", macos: "\u2318 + -" },
  { id: "zoomReset", action: "zoomReset", label: "Reset Zoom", group: "display", windows: "Ctrl + 0", macos: "\u2318 + 0" },
];

export function detectSatShortcutPlatform(platform?: string | undefined): SatShortcutPlatform {
  // Pure: no browser-global sniffing (architecture boundary). Callers pass
  // the platform string explicitly (e.g. from a hook); unknown -> "other"
  // which renders the Windows/Linux keystroke column.
  const value = (platform ?? "").toLowerCase();
  if (/mac|iphone|ipad/.test(value)) return value.includes("ipad") || value.includes("iphone") ? "ipad" : "macos";
  if (/cros|chromeos/.test(value)) return "chromeos";
  if (/win|linux/.test(value)) return "windows";
  return "other";
}

export function formatSatShortcut(def: SatShortcutDefinition, platform: SatShortcutPlatform): string {
  if (platform === "macos" || platform === "ipad") return def.macos;
  return def.windows;
}

/** True when the event target is an editable field — shortcuts must not hijack typing. */
export function isSatShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}
