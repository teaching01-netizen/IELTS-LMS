import { useEffect, useState } from "react";

/**
 * Single card surface for the release page — same geometry as the SAT staff
 * cards (`SatPage` rows/cards) and the spine `spine-card`: 16px radius,
 * hairline border, one ambient shadow. No rounded-[18px]/[24px] one-offs.
 * The release page renders under `.sat-product`, so `border-black/[0.06]`
 * resolves to the same hairline as the list pages.
 */
export const releaseSurfaceClass =
  "rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

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
