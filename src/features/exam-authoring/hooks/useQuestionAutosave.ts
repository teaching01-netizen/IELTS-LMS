import { useDurableLatestAutosave } from "../../../hooks/useDurableLatestAutosave";
import type { QuestionRevision } from "../contracts/assessment";

export type QuestionSaveStatus = "saved" | "unsaved" | "saving" | "error";

export interface UseQuestionAutosaveOptions {
  save: (revision: QuestionRevision) => Promise<QuestionRevision | void>;
  debounceMs?: number | undefined;
  durableKey?: string | null | undefined;
  onRecover?: ((revision: QuestionRevision) => void) | undefined;
  autoSaveRecovered?: boolean | undefined;
  onError?: ((error: Error) => void) | undefined;
}

export interface QuestionFlushResult {
  ok: boolean;
  isLatest: boolean;
}

export interface UseQuestionAutosaveResult {
  status: QuestionSaveStatus;
  lastSavedAt: Date | null;
  scheduleAutosave: (revision: QuestionRevision) => void;
  flushNow: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  retry: (revision: QuestionRevision) => void;
}

export function useQuestionAutosave(
  options: UseQuestionAutosaveOptions
): UseQuestionAutosaveResult {
  const autosave = useDurableLatestAutosave<QuestionRevision>({
    save: options.save,
    debounceMs: options.debounceMs ?? 800,
    durableKey: options.durableKey,
    onError: options.onError,
    onRecover: options.onRecover,
    autoSaveRecovered: options.autoSaveRecovered ?? false,
  });

  return {
    status: autosave.status,
    lastSavedAt: autosave.lastSavedAt,
    scheduleAutosave: autosave.schedule,
    flushNow: autosave.flush,
    retry: autosave.retry,
  };
}
