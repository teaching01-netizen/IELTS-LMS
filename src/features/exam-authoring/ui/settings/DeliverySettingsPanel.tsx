import { useCallback, useEffect, useState } from "react";
import type { ExamEntity } from "../../../../types/domain";
import { useAuthoringShellLifecycle } from "../../application/authoringShellLifecycle";
import { RuntimePolicyPanel } from "../release/RuntimePolicyPanel";
import { SectionDeliveryEditor } from "../release/SectionDeliveryEditor";
import { SatInlineError } from "@/src/products/sat/ui/SatPage";

export interface DeliverySettingsPanelProps {
  exam: ExamEntity;
  /** Number of sections with unsaved edits; hosts use it to guard leaving. */
  onDirtyCountChange?: (count: number) => void;
  /** Explicit "open a working draft" gesture for an exam that is only published. */
  onEditExam?: () => void;
  /** Show the read-only exam-day policy summary under the editors. */
  showRuntimePolicy?: boolean;
}

/**
 * The delivery editors (module timing, breaks, adaptive routing) as one
 * embeddable unit. The Settings page and the in-place Settings sheet render the
 * SAME component, so an author can change timing from any exam surface without
 * a route change, and the saving rules cannot differ between the two.
 */
export function DeliverySettingsPanel({
  exam,
  onDirtyCountChange,
  onEditExam,
  showRuntimePolicy = false,
}: DeliverySettingsPanelProps) {
  const lifecycle = useAuthoringShellLifecycle(exam.id);
  const state = lifecycle.state;
  const [dirtySections, setDirtySections] = useState<Set<string>>(() => new Set());

  const setSectionDirty = useCallback((sectionId: string, dirty: boolean) => {
    setDirtySections((current) => {
      if (current.has(sectionId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  }, []);

  useEffect(() => {
    onDirtyCountChange?.(dirtySections.size);
  }, [dirtySections.size, onDirtyCountChange]);

  const loadError =
    state.kind === "error"
      ? state.error.message
      : state.kind === "exam-not-found"
        ? "This exam does not exist."
        : state.kind === "forbidden"
          ? "You do not have permission to view this exam."
          : null;

  return (
    <div className="space-y-4">
      {state.kind === "ready" ? (
        state.shell.sections.map((section) => (
          <SectionDeliveryEditor
            key={section.id}
            examId={exam.id}
            section={section}
            canEdit={exam.canEdit}
            onDirtyChange={setSectionDirty}
          />
        ))
      ) : loadError ? (
        <SatInlineError title="Settings could not load" description={loadError} onRetry={() => void lifecycle.refetch()} />
      ) : state.kind === "no-draft" ? (
        <div className="rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-white p-5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          <p className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">This exam is published.</p>
          <p className="mt-1">
            Timing and routing belong to the working draft. Editing opens a draft from the published version; students
            keep the published version until you publish again.
          </p>
          {exam.canEdit && onEditExam ? (
            <button type="button" onClick={onEditExam} className="sat-btn sat-btn--primary sat-press mt-4">
              Edit this exam
            </button>
          ) : null}
        </div>
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading delivery settings" className="space-y-3">
          <div className="sat-skeleton-shimmer h-40 rounded-[var(--sat-staff-radius-card,14px)] bg-white" />
          <div className="sat-skeleton-shimmer h-24 rounded-[var(--sat-staff-radius-card,14px)] bg-white" />
        </div>
      )}
      {showRuntimePolicy ? <RuntimePolicyPanel /> : null}
    </div>
  );
}
