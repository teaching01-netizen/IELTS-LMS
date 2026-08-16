import type { ModuleType } from '../../../../types';
import type { StudentExamStore } from './studentExamStore';

export interface StudentNavigationCommands {
  setModule(module: ModuleType, firstQuestionId: string | null): void;
  setQuestion(questionId: string | null): void;
}

export function createStudentNavigationCommands(
  store: StudentExamStore,
): StudentNavigationCommands {
  return {
    setModule(module, firstQuestionId) {
      store.getState().actions.setNavigation(module, firstQuestionId);
    },
    setQuestion(questionId) {
      const currentModule = store.getState().navigation.currentModule;
      store.getState().actions.setNavigation(currentModule, questionId);
    },
  };
}
