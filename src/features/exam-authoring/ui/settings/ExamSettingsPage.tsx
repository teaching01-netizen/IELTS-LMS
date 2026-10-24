import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ExamEntity } from "../../../../types/domain";
import { requestAuthoringDraftOnEntry } from "../../application/authoringEntryIntent";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import { CollaborationHeaderCluster } from "../collaboration/CollaborationHeaderCluster";
import { ExamWorkspaceHeader } from "../shell/ExamWorkspaceHeader";
import { deliveryDestination, examWorkspacePath, type ExamWorkspaceTab } from "../shell/examLifecycle";
import { useExamWorkspaceChrome } from "../shell/useExamWorkspaceChrome";
import { satListReturnTarget } from "@/src/products/sat/ui/useSatListReturn";
import { DeliverySettingsPanel } from "./DeliverySettingsPanel";
import { ScoreConverterPanel } from "../release/ScoreConverterPanel";
import { ScoreReportSettingPanel } from "../release/ScoreReportSettingPanel";
import { useExamQuery } from "../../api/examQueries";
import { FormsSettingsPanel } from "./FormsSettingsPanel";

const SETTINGS_SCORING_PANEL_ID = "sat-settings-scoring";
export const SETTINGS_FORMS_PANEL_ID = "sat-settings-forms";

/**
 * Settings tab: always a full page, so the tab behaves like every other tab
 * (Back, refresh, direct links). The SAME editors also open in place through
 * `ExamSettingsSheet` from the header's Quick settings action.
 */
export function ExamSettingsPage({ exam }: { exam: ExamEntity }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const examQuery = useExamQuery(exam.id);
  const chrome = useExamWorkspaceChrome(exam.id);
  // Counted per owner so a saved delivery panel cannot clear unsaved forms.
  const [deliveryDirty, setDeliveryDirty] = useState(0);
  const [formsDirty, setFormsDirty] = useState(0);
  const dirtyCount = deliveryDirty + formsDirty;
  const clearDirty = useCallback(() => {
    setDeliveryDirty(0);
    setFormsDirty(0);
  }, []);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  // A create-room finding about the converter deep-links here with ?panel=scoring.
  const panel = searchParams.get("panel");
  const focusPanelId = panel === "scoring" ? SETTINGS_SCORING_PANEL_ID : panel === "forms" ? SETTINGS_FORMS_PANEL_ID : null;
  useEffect(() => {
    if (!focusPanelId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(focusPanelId);
      target?.scrollIntoView?.({ block: "start" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusPanelId]);
  const go = (path: string) => {
    if (dirtyCount > 0) setPendingPath(path);
    else navigate(path);
  };
  const onSelectTab = (tab: ExamWorkspaceTab) => {
    if (tab !== "settings") go(examWorkspacePath(exam.id, tab));
  };

  return (
    <div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,#f7f7f8)] text-foreground">
      <ExamWorkspaceHeader
        examTitle={exam.title}
        lifecycle={chrome.lifecycle}
        activeTab="settings"
        showResponses={chrome.showResponses}
        onSelectTab={onSelectTab}
        onBack={() => go(satListReturnTarget("/sat/exams").to)}
        collaborationSlot={<CollaborationHeaderCluster surface="release" />}
        onPreview={() => go(`/sat/exams/${encodeURIComponent(exam.id)}/preview`)}
        {...(chrome.canCreateSession ? { onCreateSession: () => go(deliveryDestination(exam.id)) } : {})}
      />
      <div className="mx-auto w-full max-w-[920px] px-4 pb-20 pt-8 sm:px-6">
        <section aria-labelledby="exam-settings-delivery">
          <div className="mb-6">
            <h2 id="exam-settings-delivery" className="text-[length:var(--sat-staff-type-title-size,28px)] font-semibold leading-[var(--sat-staff-type-title-line,34px)] tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]">Settings</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              Module timing, the break between sections, and the adaptive routing threshold. Each section saves on its own; “Saved” appears only after the server confirms it.
            </p>
          </div>
          <DeliverySettingsPanel
            exam={exam}
            showRuntimePolicy
            onDirtyCountChange={setDeliveryDirty}
            onEditExam={() => {
              requestAuthoringDraftOnEntry(exam.id);
              go(examWorkspacePath(exam.id, "questions"));
            }}
          />
        </section>
        <div id={SETTINGS_FORMS_PANEL_ID} tabIndex={-1} className="outline-none">
          <FormsSettingsPanel
            examId={exam.id}
            canEdit={exam.canEdit}
            onDirtyCountChange={setFormsDirty}
            onEditExam={() => {
              requestAuthoringDraftOnEntry(exam.id);
              go(examWorkspacePath(exam.id, "questions"));
            }}
          />
        </div>
        {/* One addressable home for exam-level score policy, so a create-room
            finding about the converter has somewhere to land. */}
        <section
          id={SETTINGS_SCORING_PANEL_ID}
          tabIndex={-1}
          aria-labelledby="exam-settings-results"
          className="mt-12 space-y-6 outline-none"
        >
          <div>
            <h2 id="exam-settings-results" className="text-[length:var(--sat-staff-type-title-size,28px)] font-semibold leading-[var(--sat-staff-type-title-line,34px)] tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]">Results &amp; scoring</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              What students see when they finish, and how estimated scores are produced.
            </p>
          </div>
          <ScoreReportSettingPanel exam={exam} onSaved={() => examQuery.refetch()} />
          <ScoreConverterPanel examId={exam.id} canEdit={exam.canEdit} />
        </section>
      </div>

      <AuthoringConfirmDialog
        open={pendingPath !== null}
        title="Leave with unsaved changes?"
        description="Your settings have not been saved. Leaving now discards those changes."
        confirmLabel="Leave without saving"
        onCancel={() => setPendingPath(null)}
        onConfirm={() => {
          const path = pendingPath;
          setPendingPath(null);
          clearDirty();
          if (path) navigate(path);
        }}
      />
    </div>
  );
}
