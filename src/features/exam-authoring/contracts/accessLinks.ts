import type { SatPublishScope } from "./assessment";

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

/** SAT sections enabled by the immutable release pinned to a link. */
export function availableAccessLinkSections(publishScope: SatPublishScope = "full"): AccessLinkSectionKey[] {
  return publishScope === "full" ? [...ACCESS_LINK_SECTION_KEYS] : [publishScope];
}

/** Sections students actually receive after applying the release and link scopes. */
export function effectiveAccessLinkSections(
  scope: AccessLinkSectionScope | undefined,
  publishScope: SatPublishScope = "full",
): AccessLinkSectionKey[] {
  const releaseSections = availableAccessLinkSections(publishScope);
  const stored = (scope ?? []).filter(isAccessLinkSectionKey);
  return releaseSections.filter((key) => stored.length === 0 || stored.includes(key));
}

/**
 * Sections the editor should select when it opens. If an older link has an
 * empty release/link intersection, select the release's available sections so
 * the operator can repair the link without first understanding storage rules.
 */
export function editableAccessLinkSections(
  scope: AccessLinkSectionScope | undefined,
  publishScope: SatPublishScope = "full",
): AccessLinkSectionKey[] {
  const effective = effectiveAccessLinkSections(scope, publishScope);
  return effective.length > 0 ? effective : availableAccessLinkSections(publishScope);
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
 * The effective section label for admin badges. A full-release link which
 * includes both sections gets no badge; a partial release is always explicit.
 */
export function accessLinkSectionBadge(
  scope: AccessLinkSectionScope | undefined,
  publishScope: SatPublishScope = "full",
): string | null {
  const effective = effectiveAccessLinkSections(scope, publishScope);
  if (effective.length === 0) return "No sections available";
  if (effective.length === ACCESS_LINK_SECTION_KEYS.length) return null;
  return `${effective.map((key) => ACCESS_LINK_SECTION_LABELS[key]).join(" and ")} only`;
}

/** The student-facing copy for a scoped link, or null when it is unscoped. */
export function accessLinkSectionStudentCopy(
  scope: AccessLinkSectionScope | undefined,
  publishScope: SatPublishScope = "full",
): string | null {
  const effective = effectiveAccessLinkSections(scope, publishScope);
  if (effective.length === 0) return "No sections in this Student Link are enabled in its published release.";
  if (effective.length === ACCESS_LINK_SECTION_KEYS.length && publishScope === "full") return null;
  const labels = ACCESS_LINK_SECTION_KEYS.filter((key) => effective.includes(key)).map(
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
  publishScope: SatPublishScope;
  createdAt: string;
}

export interface AssessmentAccessLink {
  id: string;
  examId: string;
  examTitle: string;
  providerKey: string;
  publishedVersionId: string;
  versionNumber: number;
  publishScope: SatPublishScope;
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

export interface DeleteAssessmentAccessLinkRequest {
  revision: number;
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
  publishScope: SatPublishScope;
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
