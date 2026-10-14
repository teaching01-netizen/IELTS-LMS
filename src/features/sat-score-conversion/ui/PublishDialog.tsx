import { useEffect, useId, useRef, useState } from "react";
import { SatButton, SatField } from "../../../products/sat/ui/SatPage";
import { SatFormDialog } from "../../../products/sat/ui/ConfirmDialog";
import { SECTION_KEYS, SECTION_LABEL, TOPOLOGY_LABEL, type ScoreConversionImpact, type ScoreConversionIssue, type ScoreConversionValidation, type Score } from "../contracts/scoreConversion";
import { describeError, type ConversionError } from "../model/issues";

export interface PublishDialogProps {
  open: boolean;
  /** Runs the server checks; the dialog never trusts local validation to publish. */
  validate: () => Promise<ScoreConversionValidation>;
  impact: () => Promise<ScoreConversionImpact>;
  initialCalibrationSource: string;
  hasActive: boolean;
  onClose: () => void;
  /** Saves the calibration source if it changed, then publishes. Rejects with the server's error. */
  onPublish: (calibrationSource: string) => Promise<void>;
}

const showScore = (score: Score | null) => (score ? (score.low === score.high ? String(score.low) : `${score.low}–${score.high}`) : "unavailable");

function IssueList({ title, issues, tone }: { title: string; issues: ScoreConversionIssue[]; tone: "error" | "warning" }) {
  if (issues.length === 0) return null;
  const shown = issues.slice(0, 8);
  return (
    <div className="mt-3">
      <p className={"text-[14px] font-semibold " + (tone === "error" ? "text-[var(--sat-staff-danger,#b42318)]" : "text-[var(--sat-staff-text-primary,#1d1d1f)]")}>
        {title} ({issues.length})
      </p>
      <ul className="mt-1 list-disc pl-5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        {shown.map((issue) => (
          <li key={issue.path}>{issue.message}</li>
        ))}
        {issues.length > shown.length ? <li>…and {issues.length - shown.length} more.</li> : null}
      </ul>
    </div>
  );
}

export function PublishDialog({ open, validate, impact, initialCalibrationSource, hasActive, onClose, onPublish }: PublishDialogProps) {
  const [validation, setValidation] = useState<ScoreConversionValidation | null>(null);
  const [report, setReport] = useState<ScoreConversionImpact | null>(null);
  const [checkError, setCheckError] = useState<ConversionError | null>(null);
  const [publishError, setPublishError] = useState<ConversionError | null>(null);
  const [calibration, setCalibration] = useState(initialCalibrationSource);
  const [publishing, setPublishing] = useState(false);
  const fieldId = useId();
  const runs = useRef(0);

  useEffect(() => {
    if (!open) return;
    const run = ++runs.current;
    setValidation(null);
    setReport(null);
    setCheckError(null);
    setPublishError(null);
    setCalibration(initialCalibrationSource);
    validate().then(
      (result) => run === runs.current && setValidation(result),
      (error: unknown) => run === runs.current && setCheckError(describeError(error)),
    );
    impact().then(
      (result) => run === runs.current && setReport(result),
      (error: unknown) => run === runs.current && setCheckError((current) => current ?? describeError(error)),
    );
    return () => {
      runs.current += 1;
    };
    // The checks run once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The calibration source has its own field below; the server's check of the saved
  // (possibly still empty) value must not keep blocking once it is filled in.
  const blockingErrors = validation?.errors.filter((issue) => issue.code !== "calibration_source_required") ?? [];
  const blocked = !validation || blockingErrors.length > 0 || calibration.trim() === "" || !report || publishing;

  const publish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      await onPublish(calibration.trim());
    } catch (error) {
      setPublishError(describeError(error));
    } finally {
      setPublishing(false);
    }
  };

  const considered = report?.resultsConsidered ?? 0;
  return (
    <SatFormDialog open={open} eyebrow="Score Conversion" title="Publish to all SAT exams" onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto px-5 pb-5 pt-1">
        <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          Publishing makes this table the active conversion for every SAT exam, including results that were already released. Student answers and raw scores are never changed.
        </p>

        <section aria-label="Checks" className="mt-4" aria-live="polite">
          {!validation && !checkError ? <p className="text-[14px]">Checking the table…</p> : null}
          {validation ? (
            blockingErrors.length === 0 ? (
              <p className="text-[14px] font-semibold">No errors.{validation.warnings.length > 0 ? ` ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"} to review.` : ""}</p>
            ) : (
              <IssueList title="Errors that block publishing" issues={blockingErrors} tone="error" />
            )
          ) : null}
          {validation ? <IssueList title="Warnings (scores are never changed automatically)" issues={validation.warnings.slice(0, 5)} tone="warning" /> : null}
          {checkError ? (
            <p role="alert" className="mt-2 text-[14px] text-[var(--sat-staff-danger,#b42318)]">
              {checkError.message}
            </p>
          ) : null}
        </section>

        <section aria-label="Impact on existing results" className="mt-4">
          <h3 className="text-[14px] font-semibold">Impact on released results</h3>
          {!report && !checkError ? <p className="mt-1 text-[14px]">Comparing against existing results…</p> : null}
          {report ? (
            considered === 0 ? (
              <p className="mt-1 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">No released SAT results exist yet, so nothing changes for existing results.</p>
            ) : (
              <div className="mt-1">
                <p className="text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">
                  {considered} released result{considered === 1 ? "" : "s"} compared with {hasActive ? "the active version" : "their current scores"}.
                </p>
                <table className="mt-2 w-full text-left text-[14px]">
                  <thead>
                    <tr className="text-[12px] text-[var(--sat-staff-text-secondary,#515154)]">
                      <th scope="col" className="py-1 pr-2 font-semibold">Subject</th>
                      <th scope="col" className="py-1 pr-2 font-semibold">Changed</th>
                      <th scope="col" className="py-1 pr-2 font-semibold">Unchanged</th>
                      <th scope="col" className="py-1 pr-2 font-semibold">Becomes unavailable</th>
                      <th scope="col" className="py-1 font-semibold">Becomes available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SECTION_KEYS.map((section) => {
                      const row = report.sections[section];
                      if (!row) return null;
                      return (
                        <tr key={section}>
                          <th scope="row" className="py-1 pr-2 font-medium">{SECTION_LABEL[section]}</th>
                          <td className="py-1 pr-2 tabular-nums">
                            {row.changed}
                            {row.minDelta !== null && row.maxDelta !== null ? ` (${row.minDelta >= 0 ? "+" : ""}${row.minDelta} to ${row.maxDelta >= 0 ? "+" : ""}${row.maxDelta})` : ""}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">{row.unchanged}</td>
                          <td className="py-1 pr-2 tabular-nums">{row.becomesUnavailable}</td>
                          <td className="py-1 tabular-nums">{row.becomesAvailable}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {report.topChanges.length > 0 ? (
                  <details className="mt-2 text-[14px]">
                    <summary className="cursor-pointer font-medium">Largest changes</summary>
                    <ul className="mt-1 list-disc pl-5 text-[var(--sat-staff-text-secondary,#515154)]">
                      {report.topChanges.slice(0, 10).map((change) => (
                        <li key={`${change.section}-${change.topology}-${change.m1}-${change.m2}`}>
                          {SECTION_LABEL[change.section]}, {TOPOLOGY_LABEL[change.topology]}, {change.topology.startsWith("full") ? `M1 ${change.m1} × M2 ${change.m2 ?? 0}` : `raw ${change.m2 ?? 0}`}:{" "}
                          {showScore(change.oldScore)} → {showScore(change.newScore)} ({change.count} result{change.count === 1 ? "" : "s"})
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )
          ) : null}
        </section>

        <SatField id={fieldId} label="Calibration source" help="Where these scores come from (for example, the table or test they were taken from). Recorded with this version." className="mt-4">
          {(control) => (
            <input {...control} className="sat-input" value={calibration} maxLength={500} onChange={(event) => setCalibration(event.target.value)} />
          )}
        </SatField>

        {publishError ? (
          <p role="alert" className="mt-3 text-[14px] text-[var(--sat-staff-danger,#b42318)]">
            {publishError.message}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <SatButton variant="quiet" onClick={onClose}>
            Cancel
          </SatButton>
          <SatButton variant="primary" disabled={blocked} pending={publishing} onClick={() => void publish()}>
            Publish
          </SatButton>
        </div>
      </div>
    </SatFormDialog>
  );
}
