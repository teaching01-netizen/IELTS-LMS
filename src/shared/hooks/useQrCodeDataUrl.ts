import { useEffect, useState } from "react";

export function useQrCodeDataUrl(url: string | null, size = 640) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    if (url)
      void import("qrcode")
        .then((module) =>
          module.toDataURL(url, { width: size, margin: 2, errorCorrectionLevel: "M" })
        )
        .then((next) => {
          if (!cancelled) setDataUrl(next);
        })
        .catch(() => {
          if (!cancelled) setError("QR code could not be generated.");
        });
    return () => {
      cancelled = true;
    };
  }, [url, size]);
  return { dataUrl, error };
}
