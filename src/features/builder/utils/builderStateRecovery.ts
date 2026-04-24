import type { ExamState, ModuleType } from '../../../types';
import { getEnabledModules } from '../../../services/examAdapterService';

export function getBuilderStateRecoveryIssue(state: ExamState): string | null {
  const enabledModules = getEnabledModules(state.config);
  if (enabledModules.length === 0) {
    return 'No builder modules are enabled in the current configuration.';
  }

  return null;
}

export function reconcileBuilderState(state: ExamState): ExamState {
  const enabledModules = getEnabledModules(state.config);
  if (enabledModules.includes(state.activeModule)) {
    return state;
  }

  if (enabledModules.length === 0) {
    return state;
  }

  const fallbackModule = enabledModules[0];
  if (!fallbackModule) {
    return state;
  }
  return {
    ...state,
    activeModule: fallbackModule,
  };
}
