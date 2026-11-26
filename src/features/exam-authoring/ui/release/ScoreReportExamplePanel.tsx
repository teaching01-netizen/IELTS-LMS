import { useState } from "react";
import { Download } from "lucide-react";
import { SatButton } from "../../../../products/sat/ui/SatPage";
import { saveScoreReportExample } from "../../api/scoreReportExampleApi";
import { releaseSurfaceClass } from "./releaseUi";

/**
 * The exam-level example download. The PDF editor owns its own layout preview;
 * this is the artifact a teacher can hand to a colleague: the student report
 * shape with every answer marked correct, the answer key, and The Word Vault.
 */
export function ScoreReportExamplePanel({ examId }: { examId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveScoreReportExample(examId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t prepare the example. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`${releaseSurfaceClass} space-y-3 p-5 sm:p-6`}
      aria-labelledby="sat-score-report-example-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="sat-score-report-example-title" className="font-semibold">Score report example</h3>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            A sample student report built from example questions: every answer marked correct, with the answer key and
            The Word Vault from this exam’s current draft. Published exams keep their own vocabulary.
          </p>
        </div>
        <SatButton variant="secondary" disabled={busy} onClick={() => void download()}>
          <Download size={16} aria-hidden="true" />
          {busy ? "Preparing example…" : "Download example PDF"}
        </SatButton>
      </div>
      <p role="status" className="sr-only">
        {busy ? "Preparing the score report example…" : ""}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-au-danger-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
