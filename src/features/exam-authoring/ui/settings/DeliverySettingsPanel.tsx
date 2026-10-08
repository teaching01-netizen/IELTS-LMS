import { useCallback, useEffect, useState } from "react";
import type { ExamEntity } from "../../../../types/domain";
import { useAuthoringShellLifecycle } from "../../application/authoringShellLifecycle";
import { RuntimePolicyPanel } from "../release/RuntimePolicyPanel";
import { SectionDeliveryEditor } from "../release/SectionDeliveryEditor";

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
    <div className="space-y-6">
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
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}{" "}
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => void lifecycle.refetch()}>
            Try again
          </button>
        </div>
      ) : state.kind === "no-draft" ? (
        <div className="rounded-xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
          <p className="font-semibold text-foreground">This exam is published.</p>
          <p className="mt-1">
            Timing and routing belong to the working draft. Editing opens a draft from the published version; students
            keep the published version until you publish again.
          </p>
          {exam.canEdit && onEditExam ? (
            <button
              type="button"
              onClick={onEditExam}
              className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Edit this exam
            </button>
          ) : null}
        </div>
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading delivery settings" className="space-y-3">
          <div className="h-40 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
          <div className="h-24 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
        </div>
      )}
      {showRuntimePolicy ? <RuntimePolicyPanel /> : null}
    </div>
  );
}
