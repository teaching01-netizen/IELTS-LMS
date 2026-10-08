import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ExamEntity } from "../../../../types/domain";
import { requestAuthoringDraftOnEntry } from "../../application/authoringEntryIntent";
import type { AssessmentValidationIssue } from "../../contracts/assessment";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import { CollaborationHeaderCluster } from "../collaboration/CollaborationHeaderCluster";
import { ExamPublishSheet } from "../publish/ExamPublishSheet";
import { SectionHeading } from "../release/releaseChrome";
import { parseIssueLink } from "../release/releaseSelectors";
import { releaseSurfaceClass } from "../release/releaseUi";
import { ExamWorkspaceHeader } from "../shell/ExamWorkspaceHeader";
import { deliveryDestination, examWorkspacePath, type ExamWorkspaceTab } from "../shell/examLifecycle";
import { useExamWorkspaceChrome } from "../shell/useExamWorkspaceChrome";
import { satListReturnTarget } from "@/src/products/sat/ui/useSatListReturn";
import { DeliverySettingsPanel } from "./DeliverySettingsPanel";

/**
 * Settings tab: always a full page, so the tab behaves like every other tab
 * (Back, refresh, direct links). The SAME editors also open in place through
 * `ExamSettingsSheet` from the header's Quick settings action.
 */
export function ExamSettingsPage({ exam }: { exam: ExamEntity }) {
  const navigate = useNavigate();
  const chrome = useExamWorkspaceChrome(exam.id);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  const go = (path: string) => {
    if (dirtyCount > 0) setPendingPath(path);
    else navigate(path);
  };
  const onSelectTab = (tab: ExamWorkspaceTab) => {
    if (tab !== "settings") go(examWorkspacePath(exam.id, tab));
  };
  const openIssue = (issue: AssessmentValidationIssue) => {
    const { questionId, field } = parseIssueLink(issue.path);
    if (!questionId && !field) return;
    const params = new URLSearchParams();
    if (questionId) params.set("question", questionId);
    if (field) params.set("field", field);
    requestAuthoringDraftOnEntry(exam.id);
    go(`${examWorkspacePath(exam.id, "questions")}?${params.toString()}`);
  };

  return (
    <div className="sat-product min-h-screen bg-background text-foreground">
      <ExamWorkspaceHeader
        examTitle={exam.title}
        lifecycle={chrome.lifecycle}
        activeTab="settings"
        showResponses={chrome.showResponses}
        onSelectTab={onSelectTab}
        onBack={() => go(satListReturnTarget("/sat/exams").to)}
        collaborationSlot={<CollaborationHeaderCluster surface="release" />}
        onPreview={() => go(`/sat/exams/${encodeURIComponent(exam.id)}/preview`)}
        {...(exam.canPublish ? { onPublish: () => setPublishOpen(true) } : {})}
        {...(chrome.canCreateSession ? { onCreateSession: () => go(deliveryDestination(exam.id)) } : {})}
        publishDisabledReason={dirtyCount > 0 ? "Save your timing changes before publishing" : null}
      />
      <main className="mx-auto w-full max-w-[920px] space-y-6 px-4 pb-20 pt-8 sm:px-6">
        <section className={`${releaseSurfaceClass} p-5 sm:p-6`} aria-labelledby="exam-settings-delivery">
          <SectionHeading
            eyebrow="Delivery plan"
            title="Timing & adaptive routing"
            description="Set how long each module runs, the break between sections, and how many correct answers in the base module send a candidate to the higher branch. Each section saves on its own, and “Saved” appears only after the server confirms it."
          />
          <div className="mt-6">
            <DeliverySettingsPanel
              exam={exam}
              showRuntimePolicy
              onDirtyCountChange={setDirtyCount}
              onEditExam={() => {
                requestAuthoringDraftOnEntry(exam.id);
                go(examWorkspacePath(exam.id, "questions"));
              }}
            />
          </div>
        </section>
      </main>

      {publishOpen ? (
        <ExamPublishSheet
          examId={exam.id}
          open
          onClose={() => setPublishOpen(false)}
          onOpenIssue={openIssue}
          onOpenStudentAccess={(target) => go(deliveryDestination(exam.id, target))}
          onOpenSettings={() => setPublishOpen(false)}
        />
      ) : null}
      <AuthoringConfirmDialog
        open={pendingPath !== null}
        title="Leave with unsaved changes?"
        description="Your delivery settings have not been saved. Leaving now discards those changes."
        confirmLabel="Leave without saving"
        onCancel={() => setPendingPath(null)}
        onConfirm={() => {
          const path = pendingPath;
          setPendingPath(null);
          setDirtyCount(0);
          if (path) navigate(path);
        }}
      />
    </div>
  );
}
