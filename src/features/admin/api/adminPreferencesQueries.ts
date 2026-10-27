import { useQuery } from '@tanstack/react-query';
import { examAuthoringFacade } from '../../exam-authoring/api/examAuthoringFacade';

export type ExamDefaultsSnapshot = Awaited<ReturnType<typeof examAuthoringFacade.preferences.loadDefaults>>;

export const adminPreferencesKeys = {
  examDefaults: () => ['admin', 'preferences', 'exam-defaults'] as const,
};

/** Confirmed saved exam defaults; edits live in the settings owner's draft. */
export function useExamDefaultsQuery(enabled: boolean) {
  return useQuery({
    queryKey: adminPreferencesKeys.examDefaults(),
    queryFn: ({ signal }) => examAuthoringFacade.preferences.loadDefaults(signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
