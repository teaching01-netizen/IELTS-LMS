import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { examAuthoringFacade } from '../../exam-authoring/api/examAuthoringFacade';
import type { ExamConfig } from '../../../types';
import type { ExamEntity, ExamVersion } from '../../../types/domain';
import { syncConfigWithStandards } from '../../../constants/examDefaults';

export interface ConfigRouteController {
  error: string | null;
  exam: ExamEntity | undefined;
  isLoading: boolean;
  isSaving: boolean;
  config: ExamConfig | undefined;
  handleUpdateConfig: (config: ExamConfig) => Promise<void>;
  handleSaveConfig: () => Promise<boolean>;
  handleNavigateToBuilder: () => Promise<void>;
  handleCancel: () => void;
  reload: () => Promise<void>;
}

export function useConfigRouteController(
  examId?: string,
): ConfigRouteController {
  const navigate = useNavigate();

  const [exam, setExam] = useState<ExamEntity | undefined>(undefined);
  const [config, setConfig] = useState<ExamConfig | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const examRef = useRef<ExamEntity | undefined>(undefined);
  const versionRef = useRef<ExamVersion | null>(null);
  const isSavingRef = useRef(false);

  const loadExam = useCallback(async () => {
    if (!examId) {
      setError('Exam ID not found');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const entity = await examAuthoringFacade.repository.getExamById(examId);
      if (!entity) {
        throw new Error('Exam not found');
      }

      setExam(entity);
      examRef.current = entity;

      const versionId = entity.currentDraftVersionId ?? entity.currentPublishedVersionId;
      if (!versionId) {
        setError('No version exists for this exam');
        setIsLoading(false);
        return;
      }

      const currentVersion = await examAuthoringFacade.repository.getVersionById(versionId);
      if (currentVersion) {
        versionRef.current = currentVersion;
        setConfig(currentVersion.configSnapshot);
        setIsDirty(false);
      } else {
        setError('Current version not found');
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load exam');
    } finally {
      setIsLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void loadExam();
  }, [loadExam]);

  const handleUpdateConfig = useCallback(
    async (nextConfig: ExamConfig) => {
      if (!examId) {
        return;
      }

      const syncedConfig = syncConfigWithStandards(nextConfig);
      setConfig(syncedConfig);
      setIsDirty(true);
    },
    [examId],
  );

  const handleSaveConfig = useCallback(async () => {
    if (!examId || !config) {
      return false;
    }

    if (isSavingRef.current) {
      return false;
    }

    const entity = examRef.current;
    const version = versionRef.current;
    if (!entity || !version) {
      setError('Current draft version not found');
      return false;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const nextContent = examAuthoringFacade.hydrateExamState({
        ...version.contentSnapshot,
        config,
      });

      const result = await examAuthoringFacade.lifecycle.saveDraft(examId, nextContent, 'System');
      if (!result.success) {
        setError(result.error ?? 'Failed to save draft');
        return false;
      }

      setIsDirty(false);
      await loadExam();
      return true;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [config, examId, loadExam]);

  const handleNavigateToBuilder = useCallback(async () => {
    if (!examId) {
      return;
    }
    const saved = await handleSaveConfig();
    if (!saved) {
      return;
    }
    navigate(`/builder/${examId}/builder`);
  }, [examId, handleSaveConfig, navigate]);

  const handleCancel = useCallback(() => {
    if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) {
      return;
    }
    navigate('/admin');
  }, [isDirty, navigate]);

  return {
    error,
    exam,
    isLoading,
    isSaving,
    config,
    handleUpdateConfig,
    handleSaveConfig,
    handleNavigateToBuilder,
    handleCancel,
    reload: loadExam,
  };
}
