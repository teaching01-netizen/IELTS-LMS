import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PrepareAnsweredExamPdfRequest,
  PreparedAnsweredExamPdf,
} from "../../../api/answeredExamPdf";
import type { StudentScoreReportView } from "./scoreReportViewModel";

export interface AnsweredExamDownloadSource {
  key: string;
  preparePdf: (
    request: PrepareAnsweredExamPdfRequest,
    signal: AbortSignal
  ) => Promise<PreparedAnsweredExamPdf>;
}

export function useAnsweredExamDownload(
  source: AnsweredExamDownloadSource | null,
  view?: StudentScoreReportView | null
) {
  const [download, setDownload] = useState<"idle" | "preparing" | "ready" | "failed">("idle");
  const [ready, setReady] = useState<PreparedAnsweredExamPdf | null>(null);
  const active = useRef<AbortController | null>(null);
  // Route callers may recreate a source object on render. Lifecycle follows
  // the report's mounted identity, not that incidental object identity.
  useEffect(() => {
    setReady(null);
    setDownload("idle");
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [source?.key]);
  const prepare = useCallback(async () => {
    if (!source || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);
    controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
    setReady(null);
    setDownload("preparing");
    try {
      const result = await source.preparePdf({ view: view ?? null }, controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      // Download the server attachment directly; PDF bytes never enter JS.
      // Keep the anchor connected for browsers that ignore detached clicks.
      const link = document.createElement("a");
      link.href = result.downloadUrl;
      link.download = result.filename;
      link.referrerPolicy = "no-referrer";
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setReady(result);
      setDownload("ready");
    } catch {
      if (active.current === controller) setDownload("failed");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        if (controller.signal.aborted) setDownload("failed");
      }
    }
  }, [source, view]);
  useEffect(() => {
    if (!ready) return;
    const expire = () => {
      if (Date.parse(ready.expiresAt) <= Date.now()) {
        setReady(null);
        setDownload("idle");
      }
    };
    const timer = setTimeout(expire, Math.max(0, Date.parse(ready.expiresAt) - Date.now()));
    window.addEventListener("focus", expire);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", expire);
    };
  }, [ready]);
  return { download, ready, prepare };
}
