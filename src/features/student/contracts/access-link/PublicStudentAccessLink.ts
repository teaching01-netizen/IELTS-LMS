export type StudentAccessLinkStatus = 'live' | 'upcoming' | 'ended' | 'paused' | 'revoked';
export type StudentAccessMode = 'student_code' | 'open';
export type StudentAudienceType = 'anyone' | 'cohort' | 'selected_students';
export type StudentAvailabilityType = 'scheduled' | 'anytime';
export type StudentSatPublishScope = 'full' | 'reading-writing' | 'math';
export type StudentAccessLinkSectionKey = 'reading-writing' | 'math';

const STUDENT_ACCESS_LINK_SECTION_KEYS: readonly StudentAccessLinkSectionKey[] = ['reading-writing', 'math'];
const STUDENT_ACCESS_LINK_SECTION_LABELS: Record<StudentAccessLinkSectionKey, string> = {
  'reading-writing': 'Reading & Writing',
  math: 'Math',
};

function isStudentAccessLinkSectionKey(value: unknown): value is StudentAccessLinkSectionKey {
  return value === 'reading-writing' || value === 'math';
}

/** Sections a student actually receives after applying release and link scopes. */
export function effectiveStudentAccessLinkSections(
  scope: readonly string[] | null | undefined,
  publishScope: StudentSatPublishScope = 'full',
): StudentAccessLinkSectionKey[] {
  const releaseSections: readonly StudentAccessLinkSectionKey[] =
    publishScope === 'full' ? STUDENT_ACCESS_LINK_SECTION_KEYS : [publishScope];
  const stored = (scope ?? []).filter(isStudentAccessLinkSectionKey);
  return releaseSections.filter((key) => stored.length === 0 || stored.includes(key));
}

/** Student-facing copy for a scoped link, or null when the link admits all sections. */
export function studentAccessLinkSectionCopy(
  scope: readonly string[] | null | undefined,
  publishScope: StudentSatPublishScope = 'full',
): string | null {
  const effective = effectiveStudentAccessLinkSections(scope, publishScope);
  if (effective.length === 0) return 'No sections in this Student Link are enabled in its published release.';
  if (effective.length === STUDENT_ACCESS_LINK_SECTION_KEYS.length && publishScope === 'full') return null;
  const labels = STUDENT_ACCESS_LINK_SECTION_KEYS.filter((key) => effective.includes(key)).map(
    (key) => STUDENT_ACCESS_LINK_SECTION_LABELS[key],
  );
  return `You'll take ${labels.join(' and ')} only. The exam ends after that section.`;
}

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
