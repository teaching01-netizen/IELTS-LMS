export type AccessLinkAudienceType = "anyone" | "cohort" | "selected_students";
export type AccessLinkMode = "student_code" | "open";
export type AccessLinkAvailabilityType = "scheduled" | "anytime";
export type AccessLinkLifecycleState = "active" | "paused" | "revoked";
export type AccessLinkStatus = "live" | "upcoming" | "ended" | "paused" | "revoked";

/**
 * Sections a Student Access link may be scoped to. SAT-only by decision: the
 * toggles and the backend validator hardcode the pair, and every other provider
 * leaves `enabledSections` null (all sections).
 */
export type AccessLinkSectionKey = "reading-writing" | "math";
export const ACCESS_LINK_SECTION_KEYS: readonly AccessLinkSectionKey[] = ["reading-writing", "math"];
export const ACCESS_LINK_SECTION_LABELS: Record<AccessLinkSectionKey, string> = {
  "reading-writing": "Reading & Writing",
  math: "Math",
};
/** The stored scope: null (or absent) means every section the version enables. */
export type AccessLinkSectionScope = readonly string[] | null;

function isAccessLinkSectionKey(value: unknown): value is AccessLinkSectionKey {
  return value === "reading-writing" || value === "math";
}

/**
 * The toggle state for a stored scope, in canonical order. An unscoped (or
 * unreadable) link selects every section, so the editor opens on "both" for
 * every link created before this feature existed.
 */
export function selectedAccessLinkSections(scope: AccessLinkSectionScope | undefined): AccessLinkSectionKey[] {
  const stored = (scope ?? []).filter(isAccessLinkSectionKey);
  if (stored.length === 0) return [...ACCESS_LINK_SECTION_KEYS];
  return ACCESS_LINK_SECTION_KEYS.filter((key) => stored.includes(key));
}

/**
 * The stored shape for a toggle state: null means "all sections", which the
 * backend persists as a NULL column. Callers writing the request send `[]` for
 * that case (an omitted field keeps the current scope instead of clearing it).
 */
export function accessLinkSectionRequest(
  selection: readonly AccessLinkSectionKey[],
): AccessLinkSectionKey[] | null {
  const canonical = ACCESS_LINK_SECTION_KEYS.filter((key) => selection.includes(key));
  return canonical.length === ACCESS_LINK_SECTION_KEYS.length ? null : canonical;
}

/** True when a toggle state differs from what the link currently stores. */
export function accessLinkSectionsChanged(
  scope: AccessLinkSectionScope | undefined,
  selection: readonly AccessLinkSectionKey[],
): boolean {
  const stored = accessLinkSectionRequest(selectedAccessLinkSections(scope));
  const next = accessLinkSectionRequest(selection);
  if (stored === null || next === null) return stored !== next;
  return stored.length !== next.length || stored.some((key, index) => key !== next[index]);
}

/**
 * "Verbal only" / "Math only" / null, for the admin badges. A link scoped to
 * every section gets no badge: nothing about it differs from an unscoped link.
 */
export function accessLinkSectionBadge(scope: AccessLinkSectionScope | undefined): string | null {
  const stored = (scope ?? []).filter(isAccessLinkSectionKey);
  if (stored.length === 0 || stored.length === ACCESS_LINK_SECTION_KEYS.length) return null;
  if (stored.includes("reading-writing")) return "Verbal only";
  return "Math only";
}

/** The student-facing copy for a scoped link, or null when it is unscoped. */
export function accessLinkSectionStudentCopy(scope: AccessLinkSectionScope | undefined): string | null {
  const stored = (scope ?? []).filter(isAccessLinkSectionKey);
  if (stored.length === 0 || stored.length === ACCESS_LINK_SECTION_KEYS.length) return null;
  const labels = ACCESS_LINK_SECTION_KEYS.filter((key) => stored.includes(key)).map(
    (key) => ACCESS_LINK_SECTION_LABELS[key],
  );
  return `You'll take ${labels.join(" and ")} only. The exam ends after that section.`;
}

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
  /** null = every section the published version enables. */
  enabledSections: string[] | null;
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
  /** [] = all sections (the stored NULL shape). */
  enabledSections?: AccessLinkSectionKey[] | undefined;
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
  /** Omitted = keep the current scope; [] = clear it back to all sections. */
  enabledSections?: AccessLinkSectionKey[] | undefined;
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
  enabledSections: string[] | null;
  audienceType: AccessLinkAudienceType;
  audienceLabel: string | null;
  accessMode: AccessLinkMode;
  availabilityType: AccessLinkAvailabilityType;
  opensAt: string | null;
  closesAt: string | null;
  status: AccessLinkStatus;
  scheduleId: string;
}
