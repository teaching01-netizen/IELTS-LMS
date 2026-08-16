import type { ExamState } from '../../../types';
import { gradingService, gradingRepository } from '../../../features/grading/infrastructure/gradingGateway';
import { examRepository } from '../../../features/exam-authoring/infrastructure/examAuthoringGateway';
import {
  resolveObjectiveGradingVersionId,
} from '../gradingReviewUtils';
import type { BuildPerStudentZipPdfExportInputDeps } from '../buildPerStudentZipPdfExportInput';

async function resolveExamState(
  scheduleId: string,
  publishedVersionId?: string,
): Promise<ExamState | null> {
  const sourceResult = await gradingService.getObjectiveGradingSource(scheduleId);
  const versionId = resolveObjectiveGradingVersionId(
    publishedVersionId,
    sourceResult.success ? sourceResult.data?.draftVersionId : null,
  );
  if (!versionId) return null;
  const version = await examRepository.getVersionById(versionId);
  return (version?.contentSnapshot as ExamState | undefined) ?? null;
}

export const exportBuilderDeps: BuildPerStudentZipPdfExportInputDeps = {
  getSectionSubmissionsBySubmissionId: (submissionId) =>
    gradingRepository.getSectionSubmissionsBySubmissionId(submissionId),
  getWritingSubmissionsBySubmissionId: (submissionId) =>
    gradingRepository.getWritingSubmissionsBySubmissionId(submissionId),
  resolveExamState,
};
