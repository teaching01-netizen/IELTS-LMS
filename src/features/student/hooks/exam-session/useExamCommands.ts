import { useStudentExamSession } from './StudentExamSessionProvider';

export function useExamCommands() {
  return useStudentExamSession((state) => state.actions);
}
