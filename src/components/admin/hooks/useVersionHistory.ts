import { useState, useCallback } from 'react';
import type { ExamEvent, ExamVersionSummary, VersionDiff } from '../../../types/domain';
import { logger } from '../../../utils/logger';

interface UseVersionHistoryParams {
  onRestoreVersion?: ((versionId: string) => void | Promise<void>) | undefined;
  onRepublishVersion?: ((versionId: string) => void | Promise<void>) | undefined;
  onCompareVersions?: ((versionIdA: string, versionIdB: string) => Promise<VersionDiff | null>) | undefined;
  onCloneExam?: ((examId: string, newTitle: string) => Promise<void>) | undefined;
  examId: string;
}

export function useVersionHistory({
  onRestoreVersion,
  onRepublishVersion,
  onCompareVersions,
  onCloneExam,
  examId
}: UseVersionHistoryParams) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareDiff, setCompareDiff] = useState<VersionDiff | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneTitle, setCloneTitle] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleCompare = useCallback(async () => {
    if (!onCompareVersions || !selectedVersionId || !compareVersionId) {
      return;
    }
    if (selectedVersionId === compareVersionId) {
      setCompareError('Select two different versions to compare.');
      return;
    }
    setIsComparing(true);
    setCompareError(null);
    try {
      const diff = await onCompareVersions(selectedVersionId, compareVersionId);
      if (!diff) {
        setCompareDiff(null);
        setCompareError('No differences found between these versions.');
        return;
      }
      setCompareDiff(diff);
      setShowCompareModal(true);
    } catch (error) {
      logger.error('Version compare failed:', error);
      setCompareDiff(null);
      setCompareError(error instanceof Error ? error.message : 'Failed to compare versions.');
    } finally {
      setIsComparing(false);
    }
  }, [compareVersionId, onCompareVersions, selectedVersionId]);

  // C17: confirm-before-restore is owned by ExamVersionHistory; this handler
  // performs the restore and surfaces failures in UI state (not logger-only).
  const handleRestore = async (versionId: string): Promise<void> => {
    if (!versionId || isRestoring) {
      return;
    }
    if (!onRestoreVersion) {
      return;
    }
    setIsRestoring(true);
    setRestoreError(null);
    try {
      await onRestoreVersion(versionId);
    } catch (error) {
      logger.error('Version restore failed:', error);
      setRestoreError(error instanceof Error ? error.message : 'Failed to restore version.');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRepublish = (versionId: string) => {
    if (!versionId) {
      return;
    }
    if (onRepublishVersion) {
      try {
        const result = onRepublishVersion(versionId);
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            logger.error('Version republish failed:', error);
          });
        }
      } catch (error) {
        logger.error('Version republish failed:', error);
      }
    }
  };

  const handleClone = async () => {
    if (!onCloneExam || !cloneTitle.trim()) {
      return;
    }
    if (!examId) {
      logger.error('Clone failed: missing exam id.');
      return;
    }
    setIsCloning(true);
    try {
      await onCloneExam(examId, cloneTitle);
      setCloneTitle('');
    } catch (error) {
      logger.error('Clone failed:', error);
    } finally {
      setIsCloning(false);
    }
  };

  return {
    selectedVersionId,
    compareVersionId,
    showAuditLog,
    showCompareModal,
    compareDiff,
    compareError,
    isComparing,
    restoreError,
    isRestoring,
    isCloning,
    cloneTitle,
    setSelectedVersionId,
    setCompareVersionId,
    setShowAuditLog,
    setShowCompareModal,
    setCompareDiff,
    setRestoreError,
    setCloneTitle,
    setIsCloning,
    handleCompare,
    handleRestore,
    handleRepublish,
    handleClone
  };
}

export type { ExamEvent, ExamVersionSummary };
