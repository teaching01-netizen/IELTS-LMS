import type { SatPublishScope } from "./assessment";

export type AssessmentReleaseLifecycleState =
  | "never_published"
  | "published_current"
  | "unpublished_changes";

export interface ReleasePublishedVersion {
  id: string;
  versionNumber: number;
  revision: number;
  publishNotes: string | null;
  publishScope: SatPublishScope;
  publishedAt: string;
}

export interface ReleaseWorkingDraft {
  id: string;
  parentVersionId: string | null;
  versionNumber: number;
  revision: number;
}

export interface ReleaseContentSummary {
  candidateDurationSeconds: number;
  authoredQuestionCount: number;
  deliveredQuestionCount: number;
}

export interface ReleaseAccessSummary {
  totalLinks: number;
  liveLinks: number;
  upcomingLinks: number;
  linksOnCurrentRelease: number;
  liveLinksOnPreviousReleases: number;
}

export interface AssessmentReleaseState {
  examId: string;
  providerKey: string;
  state: AssessmentReleaseLifecycleState;
  currentPublishedVersion: ReleasePublishedVersion | null;
  workingDraft: ReleaseWorkingDraft | null;
  summary: ReleaseContentSummary;
  access: ReleaseAccessSummary;
}
