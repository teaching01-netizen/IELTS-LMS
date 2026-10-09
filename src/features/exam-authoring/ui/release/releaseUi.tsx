import { useEffect, useState } from "react";

/**
 * Single card surface for the release and settings pages — the staff grouped
 * surface: 14px radius, one hairline, flat (elevation is for overlays only).
 */
export const releaseSurfaceClass =
  "rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-surface-solid-fallback,#fff)]";

/** Single disabled-button treatment (replaces slate-200/muted mix). */
export const releaseDisabledButtonClass =
  "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70";

export type ReadinessTone = "success" | "danger" | "warning" | "neutral";

export const readinessToneClass: Record<ReadinessTone, string> = {
  success: "bg-green-100 text-green-800",
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-amber-100 text-amber-800",
  neutral: "bg-muted text-foreground",
};

/** Offline banner hook shared by the page shell (matches StudentNetworkProvider pattern). */
export function useReleaseOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}
