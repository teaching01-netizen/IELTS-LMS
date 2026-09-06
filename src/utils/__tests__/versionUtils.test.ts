import { describe, expect, it } from 'vitest';
import type { ExamState } from '../../types';
import type { ExamVersion, VersionDiff } from '../../types/domain';
import {
  areContentSnapshotsEqual,
  getChangeCount,
  getRelativeTime,
  getVersionLineage,
  getVersionStatusColor,
  getVersionStatusLabel,
  isCurrentDraftVersion,
  isCurrentPublishedVersion,
  sortVersionsByDate,
  sortVersionsByNumber,
  summarizeChanges,
} from '../versionUtils';

function makeVersion(overrides: Partial<ExamVersion> & { id: string }): ExamVersion {
  return {
    examId: 'exam-1',
    versionNumber: 1,
    parentVersionId: null,
    contentSnapshot: {} as unknown as ExamVersion['contentSnapshot'],
    configSnapshot: {} as unknown as ExamVersion['configSnapshot'],
    createdBy: 'user-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    isDraft: true,
    isPublished: false,
    ...overrides,
  };
}

function makeBaseDiff(): VersionDiff {
  return {
    versionA: makeVersion({ id: 'v-a', versionNumber: 1 }),
    versionB: makeVersion({ id: 'v-b', versionNumber: 2, parentVersionId: 'v-a' }),
    hasChanges: false,
    metadataDiff: {
      versionNumberChanged: false,
      parentVersionChanged: false,
      creatorChanged: false,
      createdAtChanged: false,
      publishNotesChanged: false,
    },
    configDiff: {
      generalChanged: false,
      sectionsChanged: {
        listening: false,
        reading: false,
        writing: false,
        speaking: false,
      },
      progressionChanged: false,
      scoringChanged: false,
      securityChanged: false,
    },
    countsDiff: {
      readingPassages: { a: 1, b: 1, changed: false },
      readingQuestions: { a: 10, b: 10, changed: false },
      listeningParts: { a: 2, b: 2, changed: false },
      listeningQuestions: { a: 20, b: 20, changed: false },
    },
  };
}

describe('getVersionStatusColor', () => {
  it('returns green classes for published versions', () => {
    expect(getVersionStatusColor({ isPublished: true, isDraft: false })).toBe(
      'bg-green-100 text-green-800',
    );
  });

  it('prefers published color when both flags are set', () => {
    expect(getVersionStatusColor({ isPublished: true, isDraft: true })).toBe(
      'bg-green-100 text-green-800',
    );
  });

  it('returns blue classes for draft versions', () => {
    expect(getVersionStatusColor({ isPublished: false, isDraft: true })).toBe(
      'bg-blue-100 text-blue-800',
    );
  });

  it('returns gray classes for archived versions', () => {
    expect(getVersionStatusColor({ isPublished: false, isDraft: false })).toBe(
      'bg-gray-100 text-gray-800',
    );
  });
});

describe('getVersionStatusLabel', () => {
  it('returns Published for published versions', () => {
    expect(getVersionStatusLabel({ isPublished: true, isDraft: false })).toBe('Published');
  });

  it('returns Draft for draft versions', () => {
    expect(getVersionStatusLabel({ isPublished: false, isDraft: true })).toBe('Draft');
  });

  it('returns Archived when neither flag is set', () => {
    expect(getVersionStatusLabel({ isPublished: false, isDraft: false })).toBe('Archived');
  });
});

describe('isCurrentPublishedVersion', () => {
  it('returns true when the version id matches the published pointer', () => {
    expect(
      isCurrentPublishedVersion({ id: 'v-1' }, { currentPublishedVersionId: 'v-1' }),
    ).toBe(true);
  });

  it('returns false when the version id does not match', () => {
    expect(
      isCurrentPublishedVersion({ id: 'v-2' }, { currentPublishedVersionId: 'v-1' }),
    ).toBe(false);
  });

  it('returns false when there is no published version', () => {
    expect(isCurrentPublishedVersion({ id: 'v-1' }, { currentPublishedVersionId: null })).toBe(
      false,
    );
  });
});

describe('isCurrentDraftVersion', () => {
  it('returns true when the version id matches the draft pointer', () => {
    expect(isCurrentDraftVersion({ id: 'v-1' }, { currentDraftVersionId: 'v-1' })).toBe(true);
  });

  it('returns false when the version id does not match', () => {
    expect(isCurrentDraftVersion({ id: 'v-2' }, { currentDraftVersionId: 'v-1' })).toBe(false);
  });

  it('returns false when there is no draft version', () => {
    expect(isCurrentDraftVersion({ id: 'v-1' }, { currentDraftVersionId: null })).toBe(false);
  });
});

describe('sortVersionsByNumber', () => {
  it('sorts by version number descending', () => {
    const input = [{ versionNumber: 1 }, { versionNumber: 3 }, { versionNumber: 2 }];
    expect(sortVersionsByNumber(input).map((v) => v.versionNumber)).toEqual([3, 2, 1]);
  });

  it('does not mutate the input array', () => {
    const input = [{ versionNumber: 2 }, { versionNumber: 1 }];
    const snapshot = [...input];
    sortVersionsByNumber(input);
    expect(input).toEqual(snapshot);
  });

  it('returns an empty array for empty input', () => {
    expect(sortVersionsByNumber([])).toEqual([]);
  });
});

describe('sortVersionsByDate', () => {
  it('sorts by creation date descending', () => {
    const input = [
      { createdAt: '2024-01-01T00:00:00.000Z' },
      { createdAt: '2024-03-01T00:00:00.000Z' },
      { createdAt: '2024-02-01T00:00:00.000Z' },
    ];
    expect(sortVersionsByDate(input).map((v) => v.createdAt)).toEqual([
      '2024-03-01T00:00:00.000Z',
      '2024-02-01T00:00:00.000Z',
      '2024-01-01T00:00:00.000Z',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [
      { createdAt: '2024-01-01T00:00:00.000Z' },
      { createdAt: '2024-02-01T00:00:00.000Z' },
    ];
    const snapshot = [...input];
    sortVersionsByDate(input);
    expect(input).toEqual(snapshot);
  });
});

describe('getVersionLineage', () => {
  it('returns just the version when it has no parent', () => {
    const v1 = makeVersion({ id: 'v-1', versionNumber: 1, parentVersionId: null });
    expect(getVersionLineage(v1, [v1]).map((v) => v.id)).toEqual(['v-1']);
  });

  it('walks the full parent chain', () => {
    const v1 = makeVersion({ id: 'v-1', versionNumber: 1, parentVersionId: null });
    const v2 = makeVersion({ id: 'v-2', versionNumber: 2, parentVersionId: 'v-1' });
    const v3 = makeVersion({ id: 'v-3', versionNumber: 3, parentVersionId: 'v-2' });
    expect(getVersionLineage(v3, [v1, v2, v3]).map((v) => v.id)).toEqual(['v-3', 'v-2', 'v-1']);
  });

  it('stops when a parent is missing from the list', () => {
    const v2 = makeVersion({ id: 'v-2', versionNumber: 2, parentVersionId: 'v-missing' });
    const v3 = makeVersion({ id: 'v-3', versionNumber: 3, parentVersionId: 'v-2' });
    expect(getVersionLineage(v3, [v2, v3]).map((v) => v.id)).toEqual(['v-3', 'v-2']);
  });
});

describe('areContentSnapshotsEqual', () => {
  it('returns true for deeply equal snapshots', () => {
    const a = { reading: { passages: [1, 2] } } as unknown as ExamState;
    const b = { reading: { passages: [1, 2] } } as unknown as ExamState;
    expect(areContentSnapshotsEqual(a, b)).toBe(true);
  });

  it('returns false when snapshots differ', () => {
    const a = { reading: { passages: [1] } } as unknown as ExamState;
    const b = { reading: { passages: [2] } } as unknown as ExamState;
    expect(areContentSnapshotsEqual(a, b)).toBe(false);
  });
});

describe('getChangeCount', () => {
  it('returns 0 when nothing changed', () => {
    expect(getChangeCount(makeBaseDiff())).toBe(0);
  });

  it('counts each metadata and config and counts flag once', () => {
    const diff = makeBaseDiff();
    diff.metadataDiff.versionNumberChanged = true;
    diff.metadataDiff.parentVersionChanged = true;
    diff.metadataDiff.creatorChanged = true;
    diff.metadataDiff.publishNotesChanged = true;
    diff.configDiff.generalChanged = true;
    diff.configDiff.sectionsChanged.listening = true;
    diff.configDiff.sectionsChanged.reading = true;
    diff.configDiff.sectionsChanged.writing = true;
    diff.configDiff.sectionsChanged.speaking = true;
    diff.configDiff.progressionChanged = true;
    diff.configDiff.scoringChanged = true;
    diff.configDiff.securityChanged = true;
    diff.countsDiff.readingPassages = { a: 1, b: 2, changed: true };
    diff.countsDiff.readingQuestions = { a: 10, b: 11, changed: true };
    diff.countsDiff.listeningParts = { a: 2, b: 3, changed: true };
    diff.countsDiff.listeningQuestions = { a: 20, b: 21, changed: true };
    // 4 metadata + 8 config + 4 counts = 16
    expect(getChangeCount(diff)).toBe(16);
  });

  it('does not count createdAtChanged', () => {
    const diff = makeBaseDiff();
    diff.metadataDiff.createdAtChanged = true;
    expect(getChangeCount(diff)).toBe(0);
  });

  it('counts a single flag as one', () => {
    const diff = makeBaseDiff();
    diff.configDiff.scoringChanged = true;
    expect(getChangeCount(diff)).toBe(1);
  });
});

describe('summarizeChanges', () => {
  it('returns an empty list when nothing changed', () => {
    expect(summarizeChanges(makeBaseDiff())).toEqual([]);
  });

  it('summarizes a version number change', () => {
    const diff = makeBaseDiff();
    diff.metadataDiff.versionNumberChanged = true;
    expect(summarizeChanges(diff)).toEqual(['Version number changed from v1 to v2']);
  });

  it('summarizes a general configuration change', () => {
    const diff = makeBaseDiff();
    diff.configDiff.generalChanged = true;
    expect(summarizeChanges(diff)).toEqual(['General configuration changed']);
  });

  it('summarizes a single changed section', () => {
    const diff = makeBaseDiff();
    diff.configDiff.sectionsChanged.reading = true;
    expect(summarizeChanges(diff)).toEqual(['Reading module configuration changed']);
  });

  it('summarizes a single counts entry', () => {
    const diff = makeBaseDiff();
    diff.countsDiff.readingPassages = { a: 1, b: 3, changed: true };
    expect(summarizeChanges(diff)).toEqual(['Reading passages: 1 → 3']);
  });
});

describe('getRelativeTime', () => {
  it("returns 'just now' for the current time", () => {
    expect(getRelativeTime(new Date().toISOString())).toBe('just now');
  });
});
