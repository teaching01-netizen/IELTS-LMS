export type StudentAccessLinkStatus = 'live' | 'upcoming' | 'ended' | 'paused' | 'revoked';
export type StudentAccessMode = 'student_code' | 'open';
export type StudentAudienceType = 'anyone' | 'cohort' | 'selected_students';
export type StudentAvailabilityType = 'scheduled' | 'anytime';

export interface PublicStudentAccessLink {
  id: string;
  examTitle: string;
  providerKey: string;
  versionNumber: number;
  name: string;
  audienceType: StudentAudienceType;
  audienceLabel: string | null;
  accessMode: StudentAccessMode;
  availabilityType: StudentAvailabilityType;
  opensAt: string | null;
  closesAt: string | null;
  status: StudentAccessLinkStatus;
}
