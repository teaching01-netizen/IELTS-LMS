import { hasBackendStatusCode, isBackendNotFound } from "../api/examAuthoringBackendGateway";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
} from "../contracts/assessment";
import type { SnapshotSource } from "./contracts";

/**
 * Snapshot recovery: the authoritative HTTP refetch taken whenever the server
 * says the cursor is unrecoverable (`authoring.snapshot_required`).
 *
 * The socket is NEVER the source of truth. Recovery always:
 *   1. GET the shell (authoritative order + summaries) and install it;
 *   2. prune question caches whose ids are no longer in the shell;
 *   3. refresh the selected question detail (404/410 -> remove: deleted remotely).
 *
 * It does NOT touch the client cursor. The server cursor is monotonic and the
 * client only ever ignores `cursor <= lastProcessed`, so after a snapshot the
 * next event still processes while duplicates stay ignored — advancing the
 * cursor to an unknown value would be strictly worse.
 *
 * Retry once; a second failure means degraded HTTP mode (editing still works).
 */

export interface SnapshotRecoveryContext {
  examId: string;
  selectedExamQuestionId: string | null;
  source: SnapshotSource;
  setShellData(shell: AssessmentAuthoringShell): void;
  setQuestionData(examQuestionId: string, detail: AssessmentQuestionDetail): void;
  removeQuestionCache(examQuestionId: string): void;
  /** All exam-question ids currently cached, for pruning deleted ones. */
  listCachedQuestionIds(): string[];
  retryDelayMs?: number;
  wait?: (ms: number) => Promise<void>;
}

export interface SnapshotRecoveryResult {
  recovered: boolean;
  reason: string;
}

export function shellQuestionIds(shell: AssessmentAuthoringShell): string[] {
  const ids: string[] = [];
  for (const section of shell.sections) {
    for (const module of section.modules) {
      for (const question of module.questions) {
        ids.push(question.examQuestionId);
      }
    }
  }
  return ids;
}

const DEFAULT_RETRY_DELAY_MS = 1_000;

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function recoverAuthoringSnapshot(
  ctx: SnapshotRecoveryContext,
  reason: string,
): Promise<SnapshotRecoveryResult> {
  const wait = ctx.wait ?? defaultWait;
  const retryDelayMs = ctx.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const attempt = async (): Promise<void> => {
    const shell = await ctx.source.getShell(ctx.examId);
    ctx.setShellData(shell);

    const live = new Set(shellQuestionIds(shell));
    for (const cached of ctx.listCachedQuestionIds()) {
      if (!live.has(cached)) {
        ctx.removeQuestionCache(cached);
      }
    }

    const selected = ctx.selectedExamQuestionId;
    if (!selected) {
      return;
    }
    if (!live.has(selected)) {
      ctx.removeQuestionCache(selected);
      return;
    }
    try {
      const detail = await ctx.source.getQuestion(selected);
      ctx.setQuestionData(selected, detail);
    } catch (error) {
      if (isBackendNotFound(error) || hasBackendStatusCode(error, 410)) {
        ctx.removeQuestionCache(selected);
        return;
      }
      throw error;
    }
  };

  try {
    await attempt();
    return { recovered: true, reason };
  } catch {
    await wait(retryDelayMs);
    try {
      await attempt();
      return { recovered: true, reason };
    } catch {
      return { recovered: false, reason };
    }
  }
}
