/**
 * One-shot "look here" flash for spine fields (micro-interaction slice 5).
 *
 * Called additively after the existing scroll-focus in the workspace focus
 * effect, so every `setFocusField` path (per-question ValidationChecklist
 * clicks AND issues-pane `openIssue`) flashes without forking handlers.
 * Never fires on initial render: `focusField` is null until a user action
 * (or deep-link navigation, which is itself a look-here intent) sets it.
 *
 * Reduced-motion safe: the `.sat-spine` reduced-motion block collapses the
 * keyframe to 0.01ms, and `animationend` still fires so cleanup runs.
 */
export function flashAuthoringField(field: string | null | undefined): void {
  if (!field || typeof document === "undefined") return;
  let target: HTMLElement | null = null;
  try {
    target = document.querySelector<HTMLElement>(
      `[data-authoring-field="${CSS.escape(field)}"]`
    );
  } catch {
    return;
  }
  if (!target) return;
  // Restart-from-live: re-clicking the same issue restarts the flash
  // instead of queuing or silently no-op-ing on the present class.
  target.classList.remove("spine-flash-once");
  void target.offsetWidth;
  target.classList.add("spine-flash-once");
  target.addEventListener(
    "animationend",
    () => target?.classList.remove("spine-flash-once"),
    { once: true }
  );
}
