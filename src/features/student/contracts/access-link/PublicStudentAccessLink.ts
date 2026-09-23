export type StudentAccessLinkStatus = 'live' | 'upcoming' | 'ended' | 'paused' | 'revoked';
export type StudentAccessMode = 'student_code' | 'open';
export type StudentAudienceType = 'anyone' | 'cohort' | 'selected_students';
export type StudentAvailabilityType = 'scheduled' | 'anytime';
export type StudentSatPublishScope = 'full' | 'reading-writing' | 'math';

export interface PublicStudentAccessLink {
  id: string;
  scheduleId: string;
  examTitle: string;
  providerKey: string;
  versionNumber: number;
  publishScope: StudentSatPublishScope;
  name: string;
  /**
   * The sections this link admits, or null for every section the published
   * version enables. A scoped link ends the exam after its last section, so the
   * entry card has to say so before the student commits.
   */
  enabledSections: readonly string[] | null;
  audienceType: StudentAudienceType;
  audienceLabel: string | null;
  accessMode: StudentAccessMode;
  availabilityType: StudentAvailabilityType;
  opensAt: string | null;
  closesAt: string | null;
  status: StudentAccessLinkStatus;
}
