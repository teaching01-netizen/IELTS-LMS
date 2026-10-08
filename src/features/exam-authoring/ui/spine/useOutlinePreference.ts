import { useCallback, useState } from "react";

const STORAGE_KEY = "sat-authoring-outline";

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "open";
  } catch {
    return false;
  }
}

/**
 * Whether the optional question-outline panel is open beside the card canvas.
 * Remembered per browser; closed by default so the cards stay the primary
 * surface. Storage failures degrade to "closed" and never throw.
 */
export function useOutlinePreference(): readonly [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(read);
  const update = useCallback((next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "open" : "closed");
    } catch {
      // Private mode / quota: the in-memory state still applies for this session.
    }
  }, []);
  return [open, update] as const;
}
