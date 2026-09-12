import { useEffect } from "react";
import { isSatShortcutEditableTarget } from "../domain/satShortcuts";
import { runSatToolAction, type SatToolActionBinding } from "../domain/satToolActions";

interface SatShortcutBinding {
  ctrlAltKey: string;
  action: Parameters<typeof runSatToolAction>[1];
}

/**
 * Bluebook keyboard shortcuts (Phase 3). Global keydown listener, module
 * phase only. Every shortcut calls the same satToolActions id as the click
 * path — no separate keyboard implementation.
 *
 * Safety: ignored while typing in inputs/textareas/selects, while blocked,
 * when the event is default-prevented, or with conflicting modifiers.
 * Ctrl+H / Ctrl+L are documented in the modal but NOT bound (browser
 * conflicts: history / address bar) — the modal shows them as reference
 * with the Ctrl+Alt equivalents bound instead.
 */
const BINDINGS: readonly SatShortcutBinding[] = [
  { ctrlAltKey: "x", action: "nextQuestion" },
  { ctrlAltKey: "b", action: "previousQuestion" },
  { ctrlAltKey: "g", action: "questionMenu" },
  { ctrlAltKey: "v", action: "toggleMarkForReview" },
  { ctrlAltKey: "c", action: "toggleCalculator" },
  { ctrlAltKey: "r", action: "toggleReference" },
  { ctrlAltKey: "o", action: "toggleEliminatorMode" },
];

export function useSatShortcuts(
  enabled: boolean,
  binding: SatToolActionBinding,
  options?: { disableLineReaderShortcut?: boolean | undefined },
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isSatShortcutEditableTarget(event.target)) return;
      // Zoom shortcuts: Ctrl/Cmd + plus/minus/0 (no Alt). Never hijack when
      // Alt or Shift modify (browser menus), and never inside Desmos iframe
      // (no key events escape it anyway — documented, not handled).
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key === "+" || event.key === "=") {
        if (event.altKey || event.shiftKey) return;
        event.preventDefault();
        runSatToolAction(binding, "zoomIn");
        return;
      }
      if (event.key === "-" || event.key === "_") {
        if (event.altKey || event.shiftKey) return;
        event.preventDefault();
        runSatToolAction(binding, "zoomOut");
        return;
      }
      if (event.key === "0") {
        if (event.altKey || event.shiftKey) return;
        event.preventDefault();
        runSatToolAction(binding, "zoomReset");
        return;
      }
      // Tool shortcuts: Ctrl+Alt (+Shift on some layouts) + key.
      if (!event.altKey) return;
      const key = event.key.toLowerCase();
      // Line Reader on Ctrl+Alt+L (modal documents Ctrl+L as reference;
      // binding the Alt variant avoids the browser address-bar conflict).
      if (key === "l" && !options?.disableLineReaderShortcut) {
        event.preventDefault();
        runSatToolAction(binding, "toggleLineReader");
        return;
      }
      // Highlights on Ctrl+Alt+H (modal documents Ctrl+H as reference).
      if (key === "h") {
        event.preventDefault();
        runSatToolAction(binding, "toggleHighlights");
        return;
      }
      for (const candidate of BINDINGS) {
        if (key === candidate.ctrlAltKey) {
          event.preventDefault();
          runSatToolAction(binding, candidate.action);
          return;
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, binding, options?.disableLineReaderShortcut]);
}
