import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  AnsweredExamPaper,
  answeredPaperReady,
  PAPER_READY_TIMEOUT_MS,
  type AnsweredExam,
} from "../ui/transitions/SatScoreReport";
import { fitAnsweredPaper } from "../ui/transitions/score-report/fitAnsweredPaper";
import type { StudentScoreReportView } from "../ui/transitions/score-report/scoreReportViewModel";

interface PrintPayload {
  exam: AnsweredExam;
  view: StudentScoreReportView | null;
  media: Record<string, string>;
}

const TOKEN = /^[0-9a-f]{32}$/;
// Geometry shared with backend/go/internal/answeredpdf (paper and viewport).
// #root holds the app chrome (connection notice); only the paper prints.
const PAGE_STYLE = `@page { size: A4 landscape; margin: 10mm; }
html, body { background: #fff; margin: 0; }
#root { display: none !important; }`;

function setPrintState(state: "ready" | "failed") {
  document.body.dataset["printState"] = state;
}

/**
 * Page the server's headless Chromium prints (answeredpdf): it reads the
 * payload the renderer serves on its own loopback origin, mounts the paper,
 * waits for every figure (PDF-10), fits each question to one page and then
 * reports `data-print-state` on <body>. Not reachable from the app's API.
 */
export function SatAnsweredPrintRoute() {
  const [params] = useSearchParams();
  const token = params.get("payload") ?? "";
  const [payload, setPayload] = useState<PrintPayload | null>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const mediaFailed = useRef(false);

  useEffect(() => {
    if (!TOKEN.test(token)) {
      setPrintState("failed");
      return;
    }
    let cancelled = false;
    void fetch(`/__answered-exam-payload/${token}`)
      .then((response) => (response.ok ? (response.json() as Promise<PrintPayload>) : Promise.reject(new Error(String(response.status)))))
      .then((value) => {
        if (!cancelled) setPayload(value);
      })
      .catch(() => {
        if (!cancelled) setPrintState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    const deadline = Date.now() + PAPER_READY_TIMEOUT_MS;
    const check = async () => {
      if (cancelled) return;
      const paper = paperRef.current;
      if (mediaFailed.current || Date.now() > deadline) {
        setPrintState("failed");
        return;
      }
      if (!paper || !answeredPaperReady(paper)) {
        window.setTimeout(() => void check(), 100);
        return;
      }
      await document.fonts.ready;
      if (cancelled) return;
      fitAnsweredPaper(paper);
      setPrintState("ready");
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (!payload) return null;
  const media = payload.media;
  return createPortal(
    <>
      <style>{PAGE_STYLE}</style>
      <AnsweredExamPaper
        exam={payload.exam}
        view={payload.view}
        loadMediaUrl={async (assetId) => media[assetId] ?? null}
        onMediaFailure={() => {
          mediaFailed.current = true;
        }}
        paperRef={paperRef}
      />
    </>,
    document.body
  );
}
