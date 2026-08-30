import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestionRevision } from '../../contracts/assessment';
import { clearDurableDraft, loadDurableDraft, saveDurableDraft } from '../../../../utils/durableDraftStore';
import { useQuestionAutosave } from '../useQuestionAutosave';

const KEY = 'staff-draft-test:question:staff-a:exam-a:q1';
const empty = { version: 1 as const, nodes: [] };

function revision(prompt: string, version = 7): QuestionRevision {
  return {
    id: 'revision-1', questionId: 'question-1', semanticRevision: 3, revision: version,
    state: 'draft', questionType: 'single_choice', stimulus: empty,
    prompt: { version: 1, nodes: [{ type: 'paragraph', id: 'p1', text: prompt }] },
    answer: { kind: 'single_choice', options: [], correctOptionId: null },
    rationale: empty,
    metadata: { sectionKey: 'math', domain: null, skill: null, difficulty: 'medium', tags: [] },
    accessibility: { longDescription: null },
  };
}

describe('staff SAT question draft durability laws', () => {
  beforeEach(async () => { window.localStorage.clear(); await clearDurableDraft(KEY).catch(() => undefined); });
  afterEach(async () => { await clearDurableDraft(KEY).catch(() => undefined); window.localStorage.clear(); });

  it('restores an interrupted question edit without auto-overwriting a newer server revision', async () => {
    const localDraft = revision('Unsaved local wording', 7);
    await saveDurableDraft(KEY, localDraft);
    const save = vi.fn().mockResolvedValue(revision('server', 9));
    const recovered = vi.fn();
    const hook = renderHook(() => useQuestionAutosave({ save, durableKey: KEY, onRecover: recovered }));

    await waitFor(() => expect(recovered).toHaveBeenCalledWith(localDraft));
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('unsaved');
  });

  it('keeps the recovered question locally when the server rejects its stale revision', async () => {
    const localDraft = revision('Keep this exact work', 7);
    await saveDurableDraft(KEY, localDraft);
    const save = vi.fn().mockRejectedValue(new Error('Question response is stale'));
    const hook = renderHook(() => useQuestionAutosave({ save, durableKey: KEY }));
    await waitFor(() => expect(hook.result.current.status).toBe('unsaved'));

    let result: { ok: boolean; isLatest: boolean } | null = null;
    await act(async () => { result = await hook.result.current.flushNow(localDraft); });

    expect(result).toEqual({ ok: false, isLatest: true });
    expect((await loadDurableDraft<QuestionRevision>(KEY))?.prompt).toEqual(localDraft.prompt);
  });
});
