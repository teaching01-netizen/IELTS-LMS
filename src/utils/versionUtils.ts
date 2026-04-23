/**
 * Version Comparison Utilities
 * 
 * Helper functions for comparing exam versions and generating diffs
 */

import { ExamVersion, VersionDiff } from '../types/domain';
import { ExamState } from '../types';
import {
  getReadingTotalQuestions,
  getListeningTotalQuestions
} from './examUtils';
import { normalizeWritingTaskContents } from './writingTaskUtils';

/**
 * Calculate content statistics for a version
 */
export function getVersionContentStats(version: ExamVersion) {
  const content = version.contentSnapshot;
  
  return {
    readingPassages: content.reading.passages.length,
    readingQuestions: getReadingTotalQuestions(content.reading.passages),
    listeningParts: content.listening.parts.length,
    listeningQuestions: getListeningTotalQuestions(content.listening.parts),
    hasWriting: normalizeWritingTaskContents(content.writing, content.config.sections.writing.tasks)
      .some((task) => task.prompt.trim().length > 0),
    hasSpeaking: content.speaking.part1Topics.length > 0 || !!content.speaking.cueCard
  };
}

/**
 * Format a version display string
 */
export function formatVersionDisplay(version: ExamVersion): string {
  const status = version.isPublished ? 'Published' : 'Draft';
  const date = new Date(version.createdAt).toLocaleDateString();
  return `v${version.versionNumber} (${status}) - ${date}`;
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

/**
 * Get relative time string (e.g., "2 hours ago")
 */
export function getRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

type VersionStatusLike = {
  isPublished: boolean;
  isDraft: boolean;
};

/**
 * Get version status badge color
 */
export function getVersionStatusColor(version: VersionStatusLike): string {
  if (version.isPublished) return 'bg-green-100 text-green-800';
  if (version.isDraft) return 'bg-blue-100 text-blue-800';
  return 'bg-gray-100 text-gray-800';
}

/**
 * Get version status label
 */
export function getVersionStatusLabel(version: VersionStatusLike): string {
  if (version.isPublished) return 'Published';
  if (version.isDraft) return 'Draft';
  return 'Archived';
}

/**
 * Check if a version is the current published version
 */
export function isCurrentPublishedVersion(
  version: { id: string },
  exam: { currentPublishedVersionId: string | null },
): boolean {
  return version.id === exam.currentPublishedVersionId;
}

/**
 * Check if a version is the current draft version
 */
export function isCurrentDraftVersion(
  version: { id: string },
  exam: { currentDraftVersionId: string | null },
): boolean {
  return version.id === exam.currentDraftVersionId;
}

/**
 * Sort versions by version number (descending)
 */
export function sortVersionsByNumber<T extends { versionNumber: number }>(versions: T[]): T[] {
  return [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
}

/**
 * Sort versions by creation date (descending)
 */
export function sortVersionsByDate<T extends { createdAt: string }>(versions: T[]): T[] {
  return [...versions].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Get version lineage (parent chain)
 */
export function getVersionLineage(
  version: ExamVersion,
  allVersions: ExamVersion[]
): ExamVersion[] {
  const lineage: ExamVersion[] = [version];
  let currentVersion = version;

  while (currentVersion.parentVersionId) {
    const parent = allVersions.find(v => v.id === currentVersion.parentVersionId);
    if (!parent) break;
    lineage.push(parent);
    currentVersion = parent;
  }

  return lineage;
}

/**
 * Generate a summary of changes between two versions
 */
export function summarizeChanges(diff: VersionDiff): string[] {
  const changes: string[] = [];

  if (diff.metadataDiff.versionNumberChanged) {
    changes.push(`Version number changed from v${diff.versionA.versionNumber} to v${diff.versionB.versionNumber}`);
  }

  if (diff.configDiff.generalChanged) {
    changes.push('General configuration changed');
  }

  if (diff.configDiff.sectionsChanged.reading) {
    changes.push('Reading module configuration changed');
  }

  if (diff.configDiff.sectionsChanged.listening) {
    changes.push('Listening module configuration changed');
  }

  if (diff.configDiff.sectionsChanged.writing) {
    changes.push('Writing module configuration changed');
  }

  if (diff.configDiff.sectionsChanged.speaking) {
    changes.push('Speaking module configuration changed');
  }

  if (diff.countsDiff.readingPassages.changed) {
    changes.push(`Reading passages: ${diff.countsDiff.readingPassages.a} → ${diff.countsDiff.readingPassages.b}`);
  }

  if (diff.countsDiff.readingQuestions.changed) {
    changes.push(`Reading questions: ${diff.countsDiff.readingQuestions.a} → ${diff.countsDiff.readingQuestions.b}`);
  }

  if (diff.countsDiff.listeningParts.changed) {
    changes.push(`Listening parts: ${diff.countsDiff.listeningParts.a} → ${diff.countsDiff.listeningParts.b}`);
  }

  if (diff.countsDiff.listeningQuestions.changed) {
    changes.push(`Listening questions: ${diff.countsDiff.listeningQuestions.a} → ${diff.countsDiff.listeningQuestions.b}`);
  }

  return changes;
}

/**
 * Check if two content snapshots are deeply equal
 */
export function areContentSnapshotsEqual(contentA: ExamState, contentB: ExamState): boolean {
  return JSON.stringify(contentA) === JSON.stringify(contentB);
}

/**
 * Get the number of changes between two versions
 */
export function getChangeCount(diff: VersionDiff): number {
  let count = 0;

  if (diff.metadataDiff.versionNumberChanged) count++;
  if (diff.metadataDiff.parentVersionChanged) count++;
  if (diff.metadataDiff.creatorChanged) count++;
  if (diff.metadataDiff.publishNotesChanged) count++;

  if (diff.configDiff.generalChanged) count++;
  if (diff.configDiff.sectionsChanged.listening) count++;
  if (diff.configDiff.sectionsChanged.reading) count++;
  if (diff.configDiff.sectionsChanged.writing) count++;
  if (diff.configDiff.sectionsChanged.speaking) count++;
  if (diff.configDiff.progressionChanged) count++;
  if (diff.configDiff.scoringChanged) count++;
  if (diff.configDiff.securityChanged) count++;

  if (diff.countsDiff.readingPassages.changed) count++;
  if (diff.countsDiff.readingQuestions.changed) count++;
  if (diff.countsDiff.listeningParts.changed) count++;
  if (diff.countsDiff.listeningQuestions.changed) count++;

  return count;
}
