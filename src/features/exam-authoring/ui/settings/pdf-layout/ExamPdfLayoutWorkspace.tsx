import { useEffect, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import type { SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";
import { ExamPdfLayoutEditor } from "./ExamPdfLayoutEditor";

export function ExamPdfLayoutWorkspace({ examId, examTitle, canEdit, settingsPath, api }: {
  examId: string;
  examTitle: string;
  canEdit: boolean;
  settingsPath: string;
  api?: SatPdfLayoutApi | undefined;
}) {
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  return (
    <ExamPdfLayoutEditor
      examId={examId}
      examTitle={examTitle}
      canEdit={canEdit}
      api={api}
      onDirtyChange={setDirty}
      onBack={() => navigate(settingsPath)}
      leave={blocker.state === "blocked" ? { stay: blocker.reset, proceed: blocker.proceed } : undefined}
    />
  );
}
