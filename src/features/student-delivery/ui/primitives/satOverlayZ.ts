/**
 * SAT overlay z-priority contract (Phase 0 foundation).
 *
 * Fixed layers CAN coincide (offline banner under an open calculator hid
 * save state; the compact-notes backdrop hid save failures). This table is
 * the single authority for stacking order; components reference these
 * constants in class strings instead of inventing z-values.
 *
 * blocking (100) > timer warning (96) > submission (95) > break veil (94) > lease (90) >
 * image viewer (89) > help/shortcuts (88) > break confirm (86) > route
 * alerts (85, incl. save-failed/superseded) > more menu (84) > navigator (80) >
 * compact modal backdrops (83/79/78) > tools (70) > save-status dock (65) >
 * saving hint (55).
 *
 * Bluebook elevation (Phase 10): 4 levels. BLOCKING 100 (pause veils own
 * the screen) > MODAL 88-96 (timer warning, submission, help/shortcuts,
 * image viewer, break confirm — centered dialogs with the 72% scrim) >
 * TOOLS 70 (floating calculator/reference + More menu + popover panels —
 * floating shadow only, light or no backdrop, never the modal scrim) >
 * CHROME/SURFACE 0-65 (header/footer chrome, question canvas,
 * save-status dock, banners — borders carry structure, no shadow).
 *
 * Priority summary: timeout/timer warnings can never hide under Desmos;
 * the break confirm sits above every tool; help/shortcuts sit above the
 * break confirm; the image viewer sits above help; the break veil covers tools/modals/presentation but yields to submission and blocking.
 *
 * Single-modal rule: at most one `aria-modal="true"` surface may be open
 * at a time. Wave A R-02 option (ii): the compact tool sheet is explicitly
 * non-modal (no aria-modal, no Tab trap — same as the desktop panel), so
 * tools never join the modal count on any breakpoint. Compact note /
 * directions / display panels keep participating in the exclusive-surface
 * machine instead of freelancing their own modals.
 *
 * Floating tool geometry (Phase 9): calculator/reference are draggable
 * floating panels at toolSheet (70) — free position + persisted geometry,
 * Calculator resizable — plus the compact bottom-sheet + modal backdrop at
 * readingBackdrop (83). Both tools coexist side by side above the exam but
 * below every modal layer; the sheet never claims space above the navigator.
 */
export const SAT_OVERLAY_Z = {
  savingHint: 55,
  saveStatusDock: 65,
  toolSheet: 70,
  saveAlert: 75,
  notesBackdrop: 78,
  directionsBackdrop: 79,
  navigator: 80,
  readingBackdrop: 83,
  // Bluebook tool-parity layers (Phase 0). Existing numeric values are
  // stable; new layers slot into the gaps. moreMenu sits above popovers but
  // below route alerts so save failures stay visible over the menu.
  moreMenu: 84,
  routeAlert: 85,
  breakConfirm: 86,
  helpModal: 88,
  shortcutsModal: 88,
  imageViewer: 89,
  leaseNotice: 90,
  breakVeil: 94,
  submissionVeil: 95,
  timerWarning: 96,
  blockingVeil: 100,
} as const;

export type SatOverlayLayer = keyof typeof SAT_OVERLAY_Z;

export const SAT_OVERLAY_Z_CLASS = {
  savingHint: "z-[55]",
  saveStatusDock: "z-[65]",
  toolSheet: "z-[70]",
  saveAlert: "z-[75]",
  notesBackdrop: "z-[78]",
  directionsBackdrop: "z-[79]",
  navigator: "z-[80]",
  readingBackdrop: "z-[83]",
  moreMenu: "z-[84]",
  routeAlert: "z-[85]",
  breakConfirm: "z-[86]",
  helpModal: "z-[88]",
  shortcutsModal: "z-[88]",
  imageViewer: "z-[89]",
  leaseNotice: "z-[90]",
  breakVeil: "z-[94]",
  submissionVeil: "z-[95]",
  timerWarning: "z-[96]",
  blockingVeil: "z-[100]",
} as const satisfies Record<SatOverlayLayer, string>;

/** Tailwind arbitrary z-index class for a contract layer. */
export function satOverlayZClass(layer: SatOverlayLayer): string {
  return SAT_OVERLAY_Z_CLASS[layer];
}

/** True when no two modal layers claim `aria-modal` at once. */
export function satSingleModalHolds(openModals: readonly SatOverlayLayer[]): boolean {
  return openModals.length <= 1;
}
