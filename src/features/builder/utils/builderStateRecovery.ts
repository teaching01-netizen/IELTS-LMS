import type { ExamState, ModuleType } from '../../../types';
import { getEnabledModules } from '../../../services/examAdapterService';

export function reconcileBuilderState(state: ExamState): ExamState {
  const enabledModules = getEnabledModules(state.config);
  if (enabledModules.includes(state.activeModule)) {
    return state;
  }

  const fallbackModule: ModuleType = enabledModules[0] ?? 'reading';
  return {
    ...state,
    activeModule: fallbackModule,
  };
}
