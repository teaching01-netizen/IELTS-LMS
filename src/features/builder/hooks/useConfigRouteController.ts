import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';
import type { ExamConfig } from '../../../types';
import type { ExamEntity } from '../../../types/domain';
import { syncConfigWithStandards } from '../../../constants/examDefaults';
import { hydrateExamState } from '@services/examAdapterService';

export interface ConfigValidationResult {
  isValid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

export interface ConfigRouteController {
  error: string | null;
  exam: ExamEntity | undefined;
  isLoading: boolean;
  config: ExamConfig | undefined;
  validation: ConfigValidationResult;
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

  const validation: ConfigValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  const loadExam = useCallback(async () => {
    if (!examId) {
      setError('Exam ID not found');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const entity = await examRepository.getExamById(examId);
      if (!entity) {
        throw new Error('Exam not found');
      }

      setExam(entity);

      const versionId = entity.currentDraftVersionId ?? entity.currentPublishedVersionId;
      if (!versionId) {
        setError('No version exists for this exam');
        setIsLoading(false);
        return;
      }

      const currentVersion = await examRepository.getVersionById(versionId);
      if (currentVersion) {
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

    const entity = await examRepository.getExamById(examId);
    const versionId = entity?.currentDraftVersionId ?? entity?.currentPublishedVersionId;
    if (!versionId) {
      setError('Current draft version not found');
      return false;
    }

    const version = await examRepository.getVersionById(versionId);
    if (!version) {
      setError('Current draft version not found');
      return false;
    }

    const nextContent = hydrateExamState({
      ...version.contentSnapshot,
      config,
    });

    const result = await examLifecycleService.saveDraft(examId, nextContent, 'System');
    if (!result.success) {
      setError(result.error ?? 'Failed to save draft');
      return false;
    }

    setIsDirty(false);
    await loadExam();
    return true;
  }, [examId, config, loadExam]);

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
    config,
    validation,
    handleUpdateConfig,
    handleSaveConfig,
    handleNavigateToBuilder,
    handleCancel,
    reload: loadExam,
  };
}
