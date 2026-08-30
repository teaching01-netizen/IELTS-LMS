export type AccessLinkAudienceType = "anyone" | "cohort" | "selected_students";
export type AccessLinkMode = "student_code" | "open";
export type AccessLinkAvailabilityType = "scheduled" | "anytime";
export type AccessLinkLifecycleState = "active" | "paused" | "revoked";
export type AccessLinkStatus = "live" | "upcoming" | "ended" | "paused" | "revoked";

export interface AccessLinkMetrics {
  registered: number;
  started: number;
  submitted: number;
}

export interface PublishedAccessVersionSummary {
  id: string;
  versionNumber: number;
  revision: number;
  publishNotes: string | null;
  createdAt: string;
}

export interface AssessmentAccessLink {
  id: string;
  examId: string;
  examTitle: string;
  providerKey: string;
  publishedVersionId: string;
  versionNumber: number;
  scheduleId: string;
  name: string;
  audienceType: AccessLinkAudienceType;
  audienceLabel: string | null;
  accessMode: AccessLinkMode;
  availabilityType: AccessLinkAvailabilityType;
  opensAt: string | null;
  closesAt: string | null;
  lifecycleState: AccessLinkLifecycleState;
  status: AccessLinkStatus;
  selectedStudentCount: number;
  metrics: AccessLinkMetrics;
  isCurrentRelease: boolean;
  hasParticipation: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccessDistributionOverview {
  currentPublishedVersion: PublishedAccessVersionSummary | null;
  links: AssessmentAccessLink[];
}

export interface AccessLinkMemberInput {
  studentCode: string;
  studentName?: string | null;
  studentEmail?: string | null;
}

export interface AccessLinkMember {
  studentCode: string;
  studentName: string | null;
  studentEmail: string | null;
}

export interface CreateAssessmentAccessLinkRequest {
  publishedVersionId?: string | undefined;
  name: string;
  audienceType: AccessLinkAudienceType;
  audienceLabel?: string | null;
  accessMode: AccessLinkMode;
  availabilityType: AccessLinkAvailabilityType;
  opensAt?: string | null;
  closesAt?: string | null;
  selectedStudents: AccessLinkMemberInput[];
}

export interface UpdateAssessmentAccessLinkRequest {
  revision: number;
  name: string;
  audienceType: AccessLinkAudienceType;
  audienceLabel?: string | null;
  accessMode: AccessLinkMode;
  availabilityType: AccessLinkAvailabilityType;
  opensAt?: string | null;
  closesAt?: string | null;
  selectedStudents?: AccessLinkMemberInput[] | undefined;
}

export interface SetAccessLinkLifecycleRequest {
  revision: number;
  state: AccessLinkLifecycleState;
}

export interface DuplicateAssessmentAccessLinkRequest {
  revision: number;
  name?: string | undefined;
  releaseTarget?: "source" | "current" | undefined;
  availabilityType?: AccessLinkAvailabilityType | undefined;
  opensAt?: string | null | undefined;
  closesAt?: string | null | undefined;
}

export interface AccessLinkActivity {
  kind: "joined" | "started" | "submitted" | string;
  studentName: string;
  occurredAt: string;
}

export interface PublicAssessmentAccessLink {
  id: string;
  examTitle: string;
  providerKey: string;
  versionNumber: number;
  name: string;
  audienceType: AccessLinkAudienceType;
  audienceLabel: string | null;
  accessMode: AccessLinkMode;
  availabilityType: AccessLinkAvailabilityType;
  opensAt: string | null;
  closesAt: string | null;
  status: AccessLinkStatus;
  scheduleId: string;
}
