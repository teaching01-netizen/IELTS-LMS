import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, Cloud, LoaderCircle } from "lucide-react";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";
import { authoringMotion } from "./authoringMotion";

export function SaveStatusIndicator({
  status,
  lastSavedAt,
  onRetry,
}: {
  status: QuestionSaveStatus;
  lastSavedAt: Date | null;
  onRetry?: () => void;
}) {
  const [showSaving, setShowSaving] = useState(false);

  useEffect(() => {
    if (status !== "saving") {
      setShowSaving(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSaving(true), 220);
    return () => window.clearTimeout(timer);
  }, [status]);

  const visibleStatus = status === "saving" && !showSaving ? "unsaved" : status;
  const meta =
    visibleStatus === "saving"
      ? { key: "saving", label: "Saving", icon: LoaderCircle, className: "text-slate-500" }
      : visibleStatus === "unsaved"
        ? { key: "editing", label: "Editing", icon: Cloud, className: "text-slate-500" }
        : visibleStatus === "error"
          ? { key: "error", label: "Not saved", icon: CircleAlert, className: "text-au-danger-text" }
          : { key: "saved", label: "Saved", icon: Check, className: "text-au-success-text" };
  const Icon = meta.icon;
  const title = lastSavedAt
    ? `Last saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : meta.label;

  return (
    <button
      type="button"
      title={title}
      aria-label={visibleStatus === "error" ? `${title}. Retry save` : title}
      onClick={visibleStatus === "error" ? onRetry : undefined}
      className={`relative flex min-w-[84px] items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold ${meta.className} ${visibleStatus === "error" ? "hover:bg-au-danger-tint" : "cursor-default"}`}
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={meta.key}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={authoringMotion.state}
          className="flex items-center gap-1.5"
        >
          <Icon
            size={14}
            className={visibleStatus === "saving" ? "animate-spin" : undefined}
            strokeWidth={2.3}
          />
          <span>{meta.label}</span>
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
