import { useState } from "react";
import { SatButton, SatField } from "../../../products/sat/ui/SatPage";
import { createMatrix, createModule2, type DraftTable } from "../model/draft";
import { SECTION_LABEL, TOPOLOGY_LABEL, isStandalone, type SectionKey, type Topology } from "../contracts/scoreConversion";

export interface CreateTableFormProps {
  section: SectionKey;
  topology: Topology;
  /** Blueprint operational counts used as the starting dimensions. */
  defaults: { m1Operational: number; m2Operational: number } | undefined;
  disabled: boolean;
  onCreate: (table: DraftTable) => void;
}

const MAX_AXIS = 200;

export function CreateTableForm({ section, topology, defaults, disabled, onCreate }: CreateTableFormProps) {
  const standalone = isStandalone(topology);
  const [m1, setM1] = useState(String(defaults?.m1Operational ?? ""));
  const [m2, setM2] = useState(String(defaults?.m2Operational ?? ""));
  const a = Number.parseInt(m1, 10);
  const b = Number.parseInt(m2, 10);
  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_AXIS;
  const valid = inRange(b) && (standalone || inRange(a));

  return (
    <section aria-label="Create a table" className="rounded-[var(--sat-staff-radius-card,14px)] border border-dashed border-[var(--sat-staff-border-strong,rgba(0,0,0,0.15))] p-5">
      <h3 className="text-[16px] font-semibold">No table for this route yet</h3>
      <p className="mt-1 max-w-xl text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        {SECTION_LABEL[section]}, {TOPOLOGY_LABEL[topology]}. Until a table exists, results on this route show raw scores only. The size must equal the number of scored
        (non-pretest) questions students answer in each module; a table of another size is never used.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {standalone ? null : (
          <SatField label="Module 1 scored questions">
            {(control) => <input {...control} className="sat-input w-32" inputMode="numeric" value={m1} onChange={(event) => setM1(event.target.value)} />}
          </SatField>
        )}
        <SatField label="Module 2 scored questions">
          {(control) => <input {...control} className="sat-input w-32" inputMode="numeric" value={m2} onChange={(event) => setM2(event.target.value)} />}
        </SatField>
        <SatButton variant="primary" disabled={disabled || !valid} onClick={() => onCreate(standalone ? createModule2(b) : createMatrix(a, b))}>
          Create empty table
        </SatButton>
      </div>
      {disabled ? <p className="mt-3 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">Open or create a draft to add a table.</p> : null}
    </section>
  );
}
