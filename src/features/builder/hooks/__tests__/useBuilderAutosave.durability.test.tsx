import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { clearDurableDraft, loadDurableDraft, saveDurableDraft } from '../../../../utils/durableDraftStore';
import type { ExamState } from '../../../../types';
import { useBuilderAutosave } from '../useBuilderAutosave';

const KEY = 'staff-draft-test:builder:staff-a:exam-a';

function state(title: string): ExamState {
  return createInitialExamState(title, 'Academic');
}

describe('staff builder draft durability laws', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await clearDurableDraft(KEY).catch(() => undefined);
  });
  afterEach(async () => {
    await clearDurableDraft(KEY).catch(() => undefined);
    window.localStorage.clear();
  });

  it('restores a locally committed edit after the editor process dies before debounce', async () => {
    const original = state('Recovered IELTS Draft');
    const firstSave = vi.fn().mockResolvedValue(undefined);
    const first = renderHook(() => useBuilderAutosave({ save: firstSave, durableKey: KEY, debounceMs: 60_000 }));

    act(() => { first.result.current.scheduleAutosave(original); });
    await waitFor(async () => expect((await loadDurableDraft<ExamState>(KEY))?.title).toBe(original.title));
    expect(firstSave).not.toHaveBeenCalled();
    first.unmount();

    const recovered = vi.fn();
    const secondSave = vi.fn().mockResolvedValue(undefined);
    const second = renderHook(() => useBuilderAutosave({
      save: secondSave, durableKey: KEY, onRecover: recovered,
    }));
    await waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));

    expect(recovered.mock.calls[0]?.[0]).toMatchObject({ title: original.title });
    expect(secondSave).not.toHaveBeenCalled();
    expect(second.result.current.status).toBe('unsaved');
  });

  it('keeps the recovery draft after a server revision conflict and clears it only after acknowledgement', async () => {
    const recoveredState = state('Two-tab conflict draft');
    await saveDurableDraft(KEY, recoveredState);
    const conflict = vi.fn().mockRejectedValue(new Error('Draft has been modified'));
    const recovered = vi.fn();
    const hook = renderHook(() => useBuilderAutosave({ save: conflict, durableKey: KEY, onRecover: recovered }));
    await waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));

    let result: { ok: boolean; isLatest: boolean } | null = null;
    await act(async () => { result = await hook.result.current.flushNow(recoveredState); });
    expect(result).toEqual({ ok: false, isLatest: true });
    expect((await loadDurableDraft<ExamState>(KEY))?.title).toBe(recoveredState.title);

    const acknowledged = vi.fn().mockResolvedValue(undefined);
    hook.unmount();
    const retry = renderHook(() => useBuilderAutosave({ save: acknowledged, durableKey: KEY }));
    await waitFor(() => expect(retry.result.current.status).toBe('unsaved'));
    await act(async () => { await retry.result.current.flushNow(recoveredState); });
    expect(await loadDurableDraft<ExamState>(KEY)).toBeNull();
  });
});
