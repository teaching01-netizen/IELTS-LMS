import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { reconcileBuilderState } from '../builderStateRecovery';

describe('reconcileBuilderState', () => {
  it('switches to the first enabled module when the active one is disabled', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.config.sections.reading.enabled = false;
    state.config.sections.listening.enabled = false;
    state.config.sections.writing.enabled = true;
    state.config.sections.writing.order = 0;
    state.activeModule = 'reading';

    const recovered = reconcileBuilderState(state);

    expect(recovered.activeModule).toBe('writing');
  });

  it('falls back to reading when no modules are enabled', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.config.sections.reading.enabled = false;
    state.config.sections.listening.enabled = false;
    state.config.sections.writing.enabled = false;
    state.config.sections.speaking.enabled = false;
    state.activeModule = 'speaking';

    const recovered = reconcileBuilderState(state);

    expect(recovered.activeModule).toBe('reading');
  });
});
