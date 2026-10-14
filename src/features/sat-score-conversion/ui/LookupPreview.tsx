import { useState } from "react";
import { SatButton, SatField } from "../../../products/sat/ui/SatPage";
import { useScoreConversionLookup } from "../api/scoreConversionQueries";
import { isStandalone, SECTION_LABEL, TOPOLOGY_LABEL, type SectionKey, type Topology } from "../contracts/scoreConversion";

export interface LookupPreviewProps {
  /** The stored revision (draft or published) to ask; the server answers from what is saved. */
  revisionId: string;
  section: SectionKey;
  topology: Topology;
  /** True when the screen shows edits that are not saved yet. */
  unsavedEdits: boolean;
}

export function LookupPreview({ revisionId, section, topology, unsavedEdits }: LookupPreviewProps) {
  const lookup = useScoreConversionLookup();
  const [m1, setM1] = useState("0");
  const [m2, setM2] = useState("0");
  const standalone = isStandalone(topology);
  const result = lookup.data;
  const m1Number = Number.parseInt(m1, 10);
  const m2Number = Number.parseInt(m2, 10);
  const valid = Number.isInteger(m2Number) && m2Number >= 0 && (standalone || (Number.isInteger(m1Number) && m1Number >= 0));

  return (
    <section aria-label="Score lookup preview" className="rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface,#fff)] p-4">
      <h3 className="text-[14px] font-semibold">Test a score lookup</h3>
      <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        {SECTION_LABEL[section]}, {TOPOLOGY_LABEL[topology]}. Enter the raw scores a student would have.
        {unsavedEdits ? " The lookup uses the last saved draft; save to include your latest edits." : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {standalone ? null : (
          <SatField label="Module 1 correct">
            {(control) => <input {...control} className="sat-input w-28" inputMode="numeric" value={m1} onChange={(event) => setM1(event.target.value)} />}
          </SatField>
        )}
        <SatField label="Module 2 correct">
          {(control) => <input {...control} className="sat-input w-28" inputMode="numeric" value={m2} onChange={(event) => setM2(event.target.value)} />}
        </SatField>
        <SatButton
          variant="secondary"
          disabled={!valid}
          pending={lookup.isPending}
          onClick={() =>
            lookup.mutate({ revisionId, section, topology, m1: standalone ? 0 : m1Number, m2: m2Number })
          }
        >
          Look up
        </SatButton>
      </div>
      <p role="status" className="mt-3 min-h-5 text-[14px]">
        {lookup.isError ? "The lookup could not be completed." : null}
        {result?.status === "converted" && result.scaled ? (
          <>
            Estimated SAT score: <strong className="tabular-nums">{result.scaled.low === result.scaled.high ? result.scaled.low : `${result.scaled.low}–${result.scaled.high}`}</strong>
          </>
        ) : null}
        {result?.status === "unavailable" ? `Unavailable: ${result.reason ?? "no score is defined for these values."}` : null}
      </p>
    </section>
  );
}
