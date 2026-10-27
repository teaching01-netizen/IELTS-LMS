import { useQuery } from '@tanstack/react-query';
import type { ExamEntity, ExamVersion } from '../../../types/domain';
import { examAuthoringFacade } from '../../exam-authoring/api/examAuthoringFacade';

export interface ConfigSnapshot {
  exam: ExamEntity | null;
  version: ExamVersion | null;
  issue: 'No version exists for this exam' | 'Current version not found' | null;
}

export const configKeys = {
  snapshot: (examId: string) => ['builder', 'config', examId] as const,
};

async function readConfigSnapshot(examId: string, signal: AbortSignal): Promise<ConfigSnapshot> {
  const exam = await examAuthoringFacade.repository.getExamById(examId, signal);
  if (!exam) return { exam: null, version: null, issue: null };

  // A stale draft pointer can occur after a failed clone. Keep the existing
  // published-version fallback when the referenced draft no longer exists.
  const candidates = [exam.currentDraftVersionId, exam.currentPublishedVersionId]
    .filter((id): id is string => Boolean(id));
  if (candidates.length === 0) return { exam, version: null, issue: 'No version exists for this exam' };
  for (const id of candidates) {
    const version = await examAuthoringFacade.repository.getVersionById(id, signal);
    if (version?.configSnapshot) return { exam, version, issue: null };
  }
  return { exam, version: null, issue: 'Current version not found' };
}

export function useConfigSnapshotQuery(examId?: string) {
  return useQuery({
    queryKey: configKeys.snapshot(examId ?? ''),
    queryFn: ({ signal }) => readConfigSnapshot(examId ?? '', signal),
    enabled: Boolean(examId),
    retry: false,
    refetchOnWindowFocus: false,
    // A completed read is an adoption event even when it has identical values.
    structuralSharing: false,
  });
}
