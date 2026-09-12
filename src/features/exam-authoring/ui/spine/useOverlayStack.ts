import { useCallback, useRef, useState } from "react";

export type SpineOverlayKind = "sheet" | "dialog";

/**
 * Overlay stack guard: at most one modal dialog and one sheet open at once.
 * The second opener of the same kind is refused (returns false) with focus
 * left exactly where it was — no stacking, no focus loss, no silent swap.
 * Sheets and dialogs are independent kinds: one preview sheet plus one
 * confirm dialog is allowed; two dialogs are not.
 */
export function useOverlayStack() {
  const [openDialog, setOpenDialog] = useState<string | null>(null);
  const [openSheet, setOpenSheet] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const slots=useRef<{dialog:string|null;sheet:string|null}>({dialog:null,sheet:null});

  const requestOpen = useCallback(
    (id: string, kind: SpineOverlayKind): boolean => {
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        openerRef.current = document.activeElement;
      }
      if(slots.current[kind]!==null&&slots.current[kind]!==id)return false;
      slots.current[kind]=id;
      if (kind === "dialog") {
        setOpenDialog(id);
        return true;
      }
      setOpenSheet(id);
      return true;
    },
    [],
  );

  const close = useCallback((id: string) => {
    if(slots.current.dialog===id)slots.current.dialog=null;
    if(slots.current.sheet===id)slots.current.sheet=null;
    setOpenDialog((current) => (current === id ? null : current));
    setOpenSheet((current) => (current === id ? null : current));
  }, []);

  const restoreOpener = useCallback(() => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && opener.isConnected) opener.focus();
  }, []);

  return { openDialog, openSheet, requestOpen, close, restoreOpener };
}
