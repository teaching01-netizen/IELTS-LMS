import { Sparkles } from "lucide-react";
import { AuthoringDialog } from "./authoringPrimitives";

export interface SampleExamLoadDialogProps {
  open: boolean;
  busy: boolean;
  existingQuestionCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SampleExamLoadDialog({
  open,
  busy,
  existingQuestionCount,
  onCancel,
  onConfirm,
}: SampleExamLoadDialogProps) {
  return (
    <AuthoringDialog
      open={open}
      title="Load complete sample SAT?"
      ariaLabel="Load sample SAT"
      onClose={onCancel}
      closeDisabled={busy}
      contentClassName="max-w-md"
    >
      <div className="px-5 pb-5">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-au-accent-tint text-au-accent"
            aria-hidden="true"
          >
            <Sparkles size={17} aria-hidden="true" />
          </span>
          <p className="text-[12px] leading-5 text-slate-500">
            This loads 147 original SAT-style questions: 81 Reading &amp; Writing and 66 Math,
            including both adaptive branches and exactly two pretest items per module.
          </p>
        </div>
        <div className="mt-4 rounded-[12px] bg-au-warning-tint px-3.5 py-3 text-[12px] leading-5 text-au-warning-text">
          {existingQuestionCount > 0
            ? `${existingQuestionCount} current draft question${existingQuestionCount === 1 ? "" : "s"} will be replaced. `
            : ""}
          Published versions are untouched. The operation is transactional: it either loads the
          entire sample or changes nothing.
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-400">
          Sample items are original practice content, not copied College Board questions.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="authoring-button authoring-button--quiet"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="authoring-button authoring-button--primary"
          >
            {busy ? "Loading sample…" : "Load 147 questions"}
          </button>
        </div>
      </div>
    </AuthoringDialog>
  );
}
