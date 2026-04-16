import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';
import type { ExamConfig } from '../../../types';
import type { ExamEntity } from '../../../types/domain';
import { syncConfigWithStandards } from '../../../constants/examDefaults';

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
  handleSaveConfig: () => Promise<void>;
  handleNavigateToBuilder: () => void;
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

      if (!entity.currentDraftVersionId) {
        setError('No draft version exists for this exam');
        setIsLoading(false);
        return;
      }

      const currentVersion = await examRepository.getVersionById(entity.currentDraftVersionId);
      if (currentVersion) {
        setConfig(currentVersion.configSnapshot);
      } else {
        setError('Current draft version not found');
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
    },
    [examId],
  );

  const handleSaveConfig = useCallback(async () => {
    if (!examId || !config) {
      return;
    }

    const result = await examLifecycleService.saveDraft(examId, { config } as any, 'System');
    if (result.success) {
      await loadExam();
    }
  }, [examId, config, loadExam]);

  const handleNavigateToBuilder = useCallback(() => {
    if (!examId) {
      return;
    }
    navigate(`/builder/${examId}/builder`);
  }, [examId, navigate]);

  const handleCancel = useCallback(() => {
    navigate('/admin');
  }, [navigate]);

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
