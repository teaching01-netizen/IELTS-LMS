import { backendGet } from "../infrastructure/examAuthoringBackendGateway";
import type { AssessmentReleaseState } from "../contracts/release";

export const assessmentReleaseApi = {
  get(examId: string): Promise<AssessmentReleaseState> {
    return backendGet<AssessmentReleaseState>(`/v1/assessment-release/exams/${examId}`);
  },
};
