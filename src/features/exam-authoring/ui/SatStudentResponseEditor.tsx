import { useState } from "react";
import { CheckCircle2, Plus, X } from "lucide-react";
import { validateSatStudentResponse } from "../providers/sat/studentResponse";

export interface SatStudentResponseEditorProps {
  acceptedResponses: string[];
  onChange: (responses: string[]) => void;
}

export function SatStudentResponseEditor({
  acceptedResponses,
  onChange,
}: SatStudentResponseEditorProps) {
  const [equivalentDraft, setEquivalentDraft] = useState("");
  const [equivalentError, setEquivalentError] = useState<string | null>(null);
  const primary = acceptedResponses[0] ?? "";
  const primaryValidation = validateSatStudentResponse(primary);
  const equivalents = acceptedResponses.slice(1).filter(Boolean);

  const updatePrimary = (value: string) => {
    onChange([value, ...equivalents]);
  };

  const addEquivalent = () => {
    const validation = validateSatStudentResponse(equivalentDraft);
    if (!validation.valid) {
      setEquivalentError(validation.message);
      return;
    }
    if ([primary, ...equivalents].includes(validation.value)) {
      setEquivalentError("That accepted response is already included.");
      return;
    }
    onChange([primary, ...equivalents, validation.value]);
    setEquivalentDraft("");
    setEquivalentError(null);
  };

  const removeEquivalent = (value: string) => {
    onChange([primary, ...equivalents.filter((candidate) => candidate !== value)]);
  };

  return (
    <div className="space-y-4 rounded-[16px] border border-au-separator bg-au-surface-raised p-4">
      <div>
        <div className="block">
          <span className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold text-slate-800">Primary answer</span>
            <span className="text-[11px] text-slate-400">5 characters · 6 with a minus sign</span>
          </span>
          <input
            id="sat-primary-response"
            aria-label="Primary answer"
            value={primary}
            onChange={(event) => updatePrimary(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
            aria-invalid={Boolean(primary && !primaryValidation.valid)}
            aria-describedby="sat-primary-response-help"
            className={`w-full rounded-[12px] border bg-white px-3.5 py-3 font-mono text-[16px] text-slate-950 outline-none transition focus:ring-4 ${primary && !primaryValidation.valid ? "border-au-danger/40 focus:border-au-danger focus:ring-au-danger/10" : "border-au-separator-strong focus:border-au-accent/35 focus:ring-au-accent/10"}`}
            placeholder="12"
          />
        </div>
        <div id="sat-primary-response-help" className="mt-1.5 min-h-5 text-[11px] leading-5">
          {primary && !primaryValidation.valid ? (
            <span className="text-au-danger-text">{primaryValidation.message}</span>
          ) : primaryValidation.valid ? (
            <span className="inline-flex items-center gap-1 text-au-success-text">
              <CheckCircle2 size={12} aria-hidden="true" />
              Valid SAT student response
            </span>
          ) : (
            <span className="text-slate-500">
              Use an integer, decimal, or fraction. Do not include %, $, commas, or mixed numbers.
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[12px] font-semibold text-slate-800">Accepted equivalents</span>
          <span className="text-[11px] text-slate-400">Optional</span>
        </div>
        {equivalents.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {equivalents.map((response) => (
              <span
                key={response}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-700 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
              >
                {response}
                <button
                  type="button"
                  onClick={() => removeEquivalent(response)}
                  className="rounded-full p-0.5 text-slate-400 hover:bg-black/[0.05] hover:text-slate-700"
                  aria-label={`Remove accepted response ${response}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            value={equivalentDraft}
            onChange={(event) => {
              setEquivalentDraft(event.target.value);
              setEquivalentError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addEquivalent();
              }
            }}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
            aria-label="Add accepted equivalent"
            className="min-w-0 flex-1 rounded-[12px] border border-au-separator-strong bg-white px-3 py-2.5 font-mono text-[13px] text-slate-900 outline-none focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10"
            placeholder="Example: 24/2"
          />
          <button
            type="button"
            disabled={!equivalentDraft}
            onClick={addEquivalent}
            className="authoring-interactive inline-flex h-10 items-center gap-1.5 rounded-[11px] bg-au-fill px-3.5 text-[12px] font-semibold text-slate-700 hover:bg-au-fill-strong disabled:opacity-35"
          >
            <Plus size={12} aria-hidden="true" />
            Add
          </button>
        </div>
        {equivalentError ? (
          <p className="mt-1.5 text-[11px] text-au-danger-text">{equivalentError}</p>
        ) : null}
      </div>
    </div>
  );
}
