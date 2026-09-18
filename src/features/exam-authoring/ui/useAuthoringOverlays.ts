import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { useOverlayStack } from "./spine/useOverlayStack";
import { useOverlayToggle } from "./spine/useOverlayToggle";
import { restoreAuthoringFocus } from "./authoringPrimitives";

/**
 * Every overlay the authoring workspace can open, and the rules for opening it.
 *
 * WHY THIS EXISTS
 * ---------------
 * These used to be declared across three separate regions of the workspace
 * component, interleaved with unrelated state, which is how the inspector ended
 * up with its own modal/sheet dance, its own focus restore, and its own
 * registration order relative to the shared overlay stack. None of that is
 * workspace business: the workspace decides WHICH overlay an action opens, and
 * this hook decides how an overlay opens, what it does to the overlay stack, and
 * where focus goes when it closes.
 *
 * The overlay stack is the single ordering authority — two overlays cannot be
 * simultaneously open as the top layer, and `requestOpen` is the only way to
 * become it. The inspector is the one overlay whose KIND depends on the
 * viewport (a sheet on wide screens, a modal below 1280px), so it checks with
 * the stack before opening and re-registers when the viewport crosses over.
 */
export interface AuthoringOverlays {
  /** The shared stack handle, for the layout to read the top sheet's identity. */
  overlayStack: ReturnType<typeof useOverlayStack>;
  previewOpen: boolean;
  setPreviewOpen: (next: SetStateAction<boolean>) => void;
  importOpen: boolean;
  setImportOpen: (next: SetStateAction<boolean>) => void;
  workbookImportOpen: boolean;
  setWorkbookImportOpen: (next: SetStateAction<boolean>) => void;
  sampleDialogOpen: boolean;
  setSampleDialogOpen: (next: SetStateAction<boolean>) => void;
  jumpPaletteOpen: boolean;
  setJumpPaletteOpen: (next: SetStateAction<boolean>) => void;
  shortcutHelpOpen: boolean;
  setShortcutHelpOpen: (next: SetStateAction<boolean>) => void;
  questionListOpen: boolean;
  setQuestionListOpen: (next: SetStateAction<boolean>) => void;
  inspectorOpen: boolean;
  inspectorModal: boolean;
  openInspector: () => void;
  closeInspector: () => void;
  /** The question awaiting delete confirmation, or null. */
  deleteTarget: string | null;
  setDeleteTarget: (id: string | null) => void;
}

/** The viewport at or below which the inspector must be a modal, not a sheet. */
const INSPECTOR_MODAL_QUERY = "(max-width: 1279px)";

export function useAuthoringOverlays(): AuthoringOverlays {
  const overlayStack = useOverlayStack();

  const [previewOpen, setPreviewOpen] = useOverlayToggle(overlayStack, "preview", "sheet");
  const [importOpen, setImportOpen] = useOverlayToggle(overlayStack, "import", "sheet");
  const [workbookImportOpen, setWorkbookImportOpen] = useOverlayToggle(
    overlayStack,
    "workbook",
    "sheet"
  );
  const [sampleDialogOpen, setSampleDialogOpen] = useOverlayToggle(
    overlayStack,
    "sample",
    "dialog"
  );
  const [jumpPaletteOpen, setJumpPaletteOpen] = useOverlayToggle(overlayStack, "palette", "dialog");
  const [shortcutHelpOpen, setShortcutHelpOpen] = useOverlayToggle(
    overlayStack,
    "shortcuts",
    "dialog"
  );
  const [questionListOpen, setQuestionListOpen] = useOverlayToggle(
    overlayStack,
    "navigator",
    "sheet"
  );

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorModal, setInspectorModal] = useState(false);
  const inspectorOpener = useRef<HTMLElement | null>(null);
  const { requestOpen: requestOverlay, close: closeOverlay } = overlayStack;

  const openInspector = useCallback(() => {
    // A narrower viewport makes the inspector a modal, and a modal may not
    // stack on another overlay: if the stack refuses, it stays shut rather than
    // rendering underneath whatever owns the top layer.
    if (inspectorModal && !requestOverlay("inspector", "sheet")) return;
    // Remembered so closing puts the author back on the control they came from.
    inspectorOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInspectorOpen(true);
  }, [inspectorModal, requestOverlay]);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    closeOverlay("inspector");
    restoreAuthoringFocus(inspectorOpener.current);
  }, [closeOverlay]);

  // Which KIND the inspector is belongs to the viewport, not to the caller.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(INSPECTOR_MODAL_QUERY);
    const update = () => setInspectorModal(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  // Keep the stack in step with the viewport: crossing into modal mode registers
  // the inspector as the top layer, and crossing out gives the wide-screen sheet
  // back. A refusal on the way in closes it rather than leaving a modal rendered
  // behind someone else's overlay.
  useEffect(() => {
    if (!inspectorOpen) return;
    if (inspectorModal) {
      if (!requestOverlay("inspector", "sheet")) setInspectorOpen(false);
    } else {
      closeOverlay("inspector");
    }
  }, [inspectorModal, inspectorOpen, requestOverlay, closeOverlay]);

  const [deleteTarget, updateDeleteTarget] = useState<string | null>(null);
  // Opening is a REQUEST: the confirmation dialog takes the top layer or does
  // not appear at all. Closing always clears, so a refused request cannot leave
  // a stale target behind for the next confirm.
  const setDeleteTarget = useCallback(
    (id: string | null) => {
      if (id) {
        if (requestOverlay("delete", "dialog")) updateDeleteTarget(id);
      } else {
        updateDeleteTarget(null);
        closeOverlay("delete");
      }
    },
    [requestOverlay, closeOverlay]
  );

  return {
    overlayStack,
    previewOpen,
    setPreviewOpen,
    importOpen,
    setImportOpen,
    workbookImportOpen,
    setWorkbookImportOpen,
    sampleDialogOpen,
    setSampleDialogOpen,
    jumpPaletteOpen,
    setJumpPaletteOpen,
    shortcutHelpOpen,
    setShortcutHelpOpen,
    questionListOpen,
    setQuestionListOpen,
    inspectorOpen,
    inspectorModal,
    openInspector,
    closeInspector,
    deleteTarget,
    setDeleteTarget,
  };
}
