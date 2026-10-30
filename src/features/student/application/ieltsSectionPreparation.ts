import type { ExamState, ModuleType } from '../../../types';
import { clearDurableDraft, loadDurableDraft, saveDurableDraft } from '../../../utils/durableDraftStore';

/** Build-time rollout switch for IELTS V2 fast transitions (default off).
 *  It gates client pacing only; server timing and answer protection still apply. */
export const IELTS_FAST_TRANSITIONS = ['1', 'true'].includes(
  String(import.meta.env['VITE_IELTS_FAST_TRANSITIONS'] ?? '').trim().toLowerCase(),
);

/** Seconds before expiry at which the successor section is prepared locally. */
export const IELTS_PREPARATION_WINDOW_SECONDS = 15;

/** Already-delivered content for a section passes the authored-content checks. */
export function isIeltsSectionContentAvailable(
  state: ExamState,
  sectionKey: string | null | undefined,
): boolean {
  switch (sectionKey as ModuleType | undefined) {
    case 'listening':
      return (
        state.listening.parts.length > 0 &&
        state.listening.parts.every(
          (part) =>
            Boolean(part.title.trim()) &&
            part.blocks.length > 0 &&
            (!(state.config.sections.listening.audioPlaybackEnabled ?? true) ||
              Boolean(part.audioUrl?.trim())),
        )
      );
    case 'reading':
      return (
        state.reading.passages.length > 0 &&
        state.reading.passages.every(
          (passage) =>
            Boolean(passage.title.trim() || passage.content.trim()) && passage.blocks.length > 0,
        )
      );
    case 'writing':
      return (
        Boolean(state.writing.task1Prompt.trim() && state.writing.task2Prompt.trim()) &&
        (state.writing.tasks === undefined || state.writing.tasks.length > 0)
      );
    default:
      return false;
  }
}

/** IndexedDB write/read/delete probe for the attempt's durable answer store. */
export async function verifyAnswerStorage(attemptId: string): Promise<boolean> {
  const key = `ielts-readiness-probe:${attemptId}:${crypto.randomUUID()}`;
  const probe = { value: key };
  try {
    await saveDurableDraft(key, probe);
    const stored = await loadDurableDraft<typeof probe>(key);
    await clearDurableDraft(key);
    return stored?.value === key;
  } catch {
    try {
      await clearDurableDraft(key);
    } catch {
      // The exam is blocked until its durable store can accept writes.
    }
    return false;
  }
}
