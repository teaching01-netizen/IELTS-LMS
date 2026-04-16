import { useState } from 'react';
import { VersionDiff } from '../../../types/domain';
import { logger } from '../../../utils/logger';

interface UseVersionHistoryProps {
  onRestoreVersion?: ((versionId: string) => void) | undefined;
  onRepublishVersion?: ((versionId: string) => void) | undefined;
  onCompareVersions?: ((versionIdA: string, versionIdB: string) => Promise<VersionDiff | null>) | undefined;
  onCloneExam?: ((examId: string, title: string) => Promise<void>) | undefined;
  examId: string;
}

interface UseVersionHistoryReturn {
  selectedVersionId: string | null;
  compareVersionId: string | null;
  showAuditLog: boolean;
  showCompareModal: boolean;
  compareDiff: VersionDiff | null;
  isCloning: boolean;
  cloneTitle: string;
  setSelectedVersionId: (id: string | null) => void;
  setCompareVersionId: (id: string | null) => void;
  setShowAuditLog: (show: boolean) => void;
  setShowCompareModal: (show: boolean) => void;
  setCompareDiff: (diff: VersionDiff | null) => void;
  setCloneTitle: (title: string) => void;
  setIsCloning: (cloning: boolean) => void;
  handleCompare: (versionIdA: string, versionIdB: string) => Promise<void>;
  handleRestore: (versionId: string) => void;
  handleRepublish: (versionId: string) => void;
  handleClone: () => Promise<void>;
}

export function useVersionHistory({
  onRestoreVersion,
  onRepublishVersion,
  onCompareVersions,
  onCloneExam,
  examId
}: UseVersionHistoryProps): UseVersionHistoryReturn {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareDiff, setCompareDiff] = useState<VersionDiff | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneTitle, setCloneTitle] = useState('');

  const handleCompare = async (versionIdA: string, versionIdB: string) => {
    if (onCompareVersions) {
      const diff = await onCompareVersions(versionIdA, versionIdB);
      if (diff) {
        setCompareDiff(diff);
        setShowCompareModal(true);
      }
    }
  };

  const handleRestore = (versionId: string) => {
    if (onRestoreVersion) {
      onRestoreVersion(versionId);
    }
  };

  const handleRepublish = (versionId: string) => {
    if (onRepublishVersion) {
      onRepublishVersion(versionId);
    }
  };

  const handleClone = async () => {
    if (onCloneExam && cloneTitle.trim()) {
      setIsCloning(true);
      try {
        await onCloneExam(examId, cloneTitle);
        setCloneTitle('');
        setIsCloning(false);
      } catch (error) {
        logger.error('Clone failed:', error);
        setIsCloning(false);
      }
    }
  };

  return {
    selectedVersionId,
    compareVersionId,
    showAuditLog,
    showCompareModal,
    compareDiff,
    isCloning,
    cloneTitle,
    setSelectedVersionId,
    setCompareVersionId,
    setShowAuditLog,
    setShowCompareModal,
    setCompareDiff,
    setCloneTitle,
    setIsCloning,
    handleCompare,
    handleRestore,
    handleRepublish,
    handleClone
  };
}
