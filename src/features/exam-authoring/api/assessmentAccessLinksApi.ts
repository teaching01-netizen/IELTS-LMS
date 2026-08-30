import { backendGet, backendPatch, backendPost } from "../infrastructure/examAuthoringBackendGateway";
import type {
  AccessDistributionOverview,
  AccessLinkActivity,
  AccessLinkMember,
  AssessmentAccessLink,
  CreateAssessmentAccessLinkRequest,
  DuplicateAssessmentAccessLinkRequest,
  PublicAssessmentAccessLink,
  SetAccessLinkLifecycleRequest,
  UpdateAssessmentAccessLinkRequest,
} from "../contracts/accessLinks";

export const assessmentAccessLinksApi = {
  overview(examId: string): Promise<AccessDistributionOverview> {
    return backendGet<AccessDistributionOverview>(`/v1/assessment-access/exams/${examId}/overview`);
  },
  list(examId: string): Promise<AssessmentAccessLink[]> {
    return backendGet<AssessmentAccessLink[]>(`/v1/assessment-access/exams/${examId}/links`);
  },
  create(examId: string, request: CreateAssessmentAccessLinkRequest): Promise<AssessmentAccessLink> {
    return backendPost<AssessmentAccessLink, CreateAssessmentAccessLinkRequest>(
      `/v1/assessment-access/exams/${examId}/links`,
      request
    );
  },
  get(linkId: string): Promise<AssessmentAccessLink> {
    return backendGet<AssessmentAccessLink>(`/v1/assessment-access/links/${linkId}`);
  },
  update(linkId: string, request: UpdateAssessmentAccessLinkRequest): Promise<AssessmentAccessLink> {
    return backendPatch<AssessmentAccessLink>(`/v1/assessment-access/links/${linkId}`, request);
  },
  setLifecycle(linkId: string, request: SetAccessLinkLifecycleRequest): Promise<AssessmentAccessLink> {
    return backendPost<AssessmentAccessLink, SetAccessLinkLifecycleRequest>(
      `/v1/assessment-access/links/${linkId}/lifecycle`,
      request
    );
  },
  duplicate(linkId: string, request: DuplicateAssessmentAccessLinkRequest): Promise<AssessmentAccessLink> {
    return backendPost<AssessmentAccessLink, DuplicateAssessmentAccessLinkRequest>(
      `/v1/assessment-access/links/${linkId}/duplicate`,
      request
    );
  },
  members(linkId: string): Promise<AccessLinkMember[]> {
    return backendGet<AccessLinkMember[]>(`/v1/assessment-access/links/${linkId}/members`);
  },
  activity(linkId: string): Promise<AccessLinkActivity[]> {
    return backendGet<AccessLinkActivity[]>(`/v1/assessment-access/links/${linkId}/activity`);
  },
  publicLink(linkId: string): Promise<PublicAssessmentAccessLink> {
    return backendGet<PublicAssessmentAccessLink>(`/v1/public/access-links/${linkId}`);
  },
};
