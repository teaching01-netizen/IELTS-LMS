import type { WordVaultEntry } from "@shared/sat/wordVault";
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PdfTarget, ResolvedPdfLayout } from "@shared/sat/pdfLayout";
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
  layout?: ResolvedPdfLayout;
  wordVault?: WordVaultEntry[];
  sectionSample?: PdfTarget;
  sampleBook?: boolean;
  /** Optional top-level copy for older renderers; the exam field wins. */
  answerKey?: AnsweredExam["answerKey"];
}

const TOKEN = /^[0-9a-f]{32}$/;
// Geometry shared with backend/go/internal/answeredpdf (paper and viewport).
// #root holds the app chrome (connection notice); only the paper prints.
const PAGE_STYLE = `@page { size: A4 landscape; margin: 10mm; }
@page sat-image-page { size: A4 landscape; margin: 0; }
html, body { background: #fff; margin: 0; }
#root { display: none !important; }`;

function setPrintState(state: "ready" | "failed") {
  document.body.dataset["printState"] = state;
}

/** A paper render failure must fail the print quickly, with a cause the renderer can log. */
function failPrint(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  document.body.dataset["printState"] = "failed";
  document.body.dataset["printError"] = message.slice(0, 800);
}

class PrintPaperBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    failPrint(error);
    console.error("SAT print paper failed", error, info.componentStack);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
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
    let finished = false;
    const finish = (state: "ready" | "failed") => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      setPrintState(state);
    };
    const timeout = window.setTimeout(() => finish("failed"), PAPER_READY_TIMEOUT_MS);
    const check = async () => {
      if (finished) return;
      try {
        const paper = paperRef.current;
        if (mediaFailed.current) {
          finish("failed");
          return;
        }
        if (!paper || !answeredPaperReady(paper)) {
          window.setTimeout(() => void check(), 100);
          return;
        }
        if (payload.wordVault?.length) {
          const fonts = await document.fonts.load('10pt "SAT Word Vault Thai"', "ปรับตัว");
          if (fonts.length === 0) throw new Error("The Thai print font is unavailable.");
        }
        await document.fonts.ready;
        if (finished) return;
        fitAnsweredPaper(paper);
        finish("ready");
      } catch {
        finish("failed");
      }
    };
    void check();
    return () => {
      finished = true;
      window.clearTimeout(timeout);
    };
  }, [payload]);

  if (!payload) return null;
  const media = payload.media;
  return createPortal(
    <>
      <style>{PAGE_STYLE}</style>
      <PrintPaperBoundary>
      <AnsweredExamPaper
        exam={payload.exam}
        view={payload.view}
        answerKey={payload.exam.answerKey ?? payload.answerKey ?? null}
        loadMediaUrl={async (assetId) => media[assetId] ?? null}
        onMediaFailure={() => {
          mediaFailed.current = true;
        }}
        layout={payload.layout}
        wordVault={payload.wordVault}
        sectionSample={payload.sectionSample}
        sampleBook={payload.sampleBook === true}
        paperRef={paperRef}
      />
      </PrintPaperBoundary>
    </>,
    document.body
  );
}
