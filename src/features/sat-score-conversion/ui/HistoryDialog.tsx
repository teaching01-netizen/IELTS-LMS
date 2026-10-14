import { SatButton, SatStatusPill } from "../../../products/sat/ui/SatPage";
import { SatFormDialog } from "../../../products/sat/ui/ConfirmDialog";
import type { ScoreConversionRevision } from "../contracts/scoreConversion";

export interface HistoryDialogProps {
  open: boolean;
  revisions: ScoreConversionRevision[] | undefined;
  loading: boolean;
  error: boolean;
  busy: boolean;
  onClose: () => void;
  onView: (revision: ScoreConversionRevision) => void;
  onRestore: (revision: ScoreConversionRevision) => void;
}

const formatWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

export function HistoryDialog({ open, revisions, loading, error, busy, onClose, onView, onRestore }: HistoryDialogProps) {
  return (
    <SatFormDialog open={open} eyebrow="Score Conversion" title="Version history" onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto px-5 pb-5 pt-1">
        <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          Published versions are permanent. Restoring one creates a new draft; it only takes effect when you publish it.
        </p>
        {loading ? <p className="mt-3 text-[14px]">Loading versions…</p> : null}
        {error ? (
          <p role="alert" className="mt-3 text-[14px] text-[var(--sat-staff-danger,#b42318)]">
            Version history could not be loaded.
          </p>
        ) : null}
        {revisions && revisions.length === 0 ? <p className="mt-3 text-[14px]">Nothing has been published yet.</p> : null}
        <ul className="mt-3 divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))]">
          {(revisions ?? []).map((revision) => (
            <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                  Version {revision.revisionNumber}
                  {revision.active ? <SatStatusPill tone="published">Active</SatStatusPill> : null}
                </p>
                <p className="text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">
                  {formatWhen(revision.publishedAt)} · {revision.publishedBy ?? "unknown"}
                  {revision.calibrationSource ? ` · ${revision.calibrationSource}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <SatButton variant="quiet" onClick={() => onView(revision)} aria-label={`View version ${revision.revisionNumber}`}>
                  View
                </SatButton>
                {!revision.active ? (
                  <SatButton variant="secondary" disabled={busy} onClick={() => onRestore(revision)} aria-label={`Restore version ${revision.revisionNumber} as new draft`}>
                    Restore as new draft
                  </SatButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SatFormDialog>
  );
}
