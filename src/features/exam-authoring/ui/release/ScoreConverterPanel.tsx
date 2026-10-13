import { useState, type ChangeEvent } from "react";
import { ApiError } from "../../../../shared/api-client/errors";
import { useScoreConverter, useSetScoreConverter } from "../../api/assessmentQueries";
import { SectionHeading } from "./releaseChrome";
import { releaseSurfaceClass } from "./releaseUi";

const SECTION_LABEL: Record<string, string> = { "reading-writing": "Reading and Writing", math: "Math" };

/**
 * Versioned estimated-score converter of the draft (docs/sat-result.md §1–2).
 * Staff upload an approved table as JSON; the server validates it and publish
 * requires a table for every module route the plan delivers. Without one,
 * Classroom reports show raw scores only.
 */
export function ScoreConverterPanel({ examId, canEdit }: { examId: string; canEdit: boolean }) {
  const query = useScoreConverter(examId);
  const save = useSetScoreConverter(examId);
  const [fileError, setFileError] = useState<string | null>(null);
  const converter = query.data?.converter ?? null;
  const busy = !canEdit || !query.isSuccess || save.isPending;
  const inputId = `score-converter-${examId}`;
  const uploadLabel = converter ? "Replace converter (JSON)" : "Upload converter (JSON)";

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setFileError("The file is not valid JSON.");
      return;
    }
    save.mutate(parsed);
  };

  // Validation messages are server-written sentences naming the bad table.
  const saveError = save.error
    ? save.error instanceof ApiError && save.error.category === "validation"
      ? save.error.message
      : "The score converter could not be saved. Try again."
    : null;

  return (
    <section className={`${releaseSurfaceClass} p-5 sm:p-6`}>
      <SectionHeading
        eyebrow="Results"
        title="Estimated score converter"
        description="An approved table that maps raw scores to estimated 200–800 section scores for each module route. Without one, Classroom reports show raw scores only. Results keep the converter version they were scored with."
      />
      {converter ? (
        <dl className="mt-4 space-y-1 text-[14px] leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">
          <div className="flex gap-2">
            <dt className="font-semibold">Version</dt>
            <dd>{converter.converterVersion}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Calibration source</dt>
            <dd>{converter.calibrationSource}</dd>
          </div>
          {Object.entries(converter.sections).map(([section, routes]) => (
            <div key={section} className="flex gap-2">
              <dt className="font-semibold">{SECTION_LABEL[section] ?? section}</dt>
              <dd>{Object.keys(routes).sort().join(", ")}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">No converter: raw scores only.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <label htmlFor={inputId} className={`sat-btn sat-btn--secondary sat-press focus-within:ring-2 focus-within:ring-[var(--sat-staff-accent,#0071e3)] ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          {uploadLabel}
          <input id={inputId} type="file" accept=".json,application/json" aria-label={uploadLabel} className="sr-only" disabled={busy} onChange={(event) => void upload(event)} />
        </label>
        {converter ? (
          <button type="button" disabled={busy} onClick={() => save.mutate(null)} className="sat-btn sat-btn--secondary sat-press">
            Remove converter
          </button>
        ) : null}
      </div>
      {fileError ?? saveError ? (
        <p role="alert" className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-danger,#d70015)]">
          {fileError ?? saveError}
        </p>
      ) : null}
    </section>
  );
}
