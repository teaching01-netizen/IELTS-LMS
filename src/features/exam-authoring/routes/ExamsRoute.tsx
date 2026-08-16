import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorSurface } from '@components/ui/ErrorSurface';
import { LoadingSurface } from '@components/ui/LoadingSurface';
import type { ExamConfig } from '../../../types';
import type { ExamEvent, ExamVersionSummary, VersionDiff } from '../../../types/domain';
import { ExamList } from '../ui/ExamList/ExamList';
import { examAuthoringFacade } from '../application/examAuthoringFacade';
import {
  invalidateExamList,
  useDeleteExamMutation,
  useExamListQuery,
} from '../api/examQueries';

export function ExamsRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const examListQuery = useExamListQuery();
  const deleteExamMutation = useDeleteExamMutation();
  const [defaults, setDefaults] = useState<ExamConfig>(() =>
    examAuthoringFacade.preferences.getDefaults(),
  );

  useEffect(() => {
    let isMounted = true;

    void examAuthoringFacade.preferences.loadDefaults().then((loadedDefaults) => {
      if (isMounted) {
        setDefaults(loadedDefaults);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  if (examListQuery.isLoading) {
    return <LoadingSurface label="Loading exams..." />;
  }

  if (examListQuery.error) {
    return (
      <ErrorSurface
        title="Unable to load exams"
        description={
          examListQuery.error instanceof Error
            ? examListQuery.error.message
            : 'The exam list could not be loaded.'
        }
        actionLabel="Retry"
        onAction={() => void examListQuery.refetch()}
      />
    );
  }

  const examList = examListQuery.data ?? { entities: [], exams: [] };

  const invalidateAfterSuccess = async (success: boolean) => {
    if (success) {
      await invalidateExamList(queryClient);
    }
  };

  const handleCloneExam = async (examId: string, newTitle: string) => {
    const result = await examAuthoringFacade.lifecycle.cloneExam(examId, newTitle, 'Admin');
    await invalidateAfterSuccess(result.success);
  };

  const handleCreateFromTemplate = async (templateId: string, newTitle: string) => {
    const result = await examAuthoringFacade.lifecycle.createFromTemplate(
      templateId,
      newTitle,
      'Admin',
    );
    await invalidateAfterSuccess(result.success);
  };

  const handleBulkPublish = async (examIds: string[]) => {
    const result = await examAuthoringFacade.lifecycle.bulkPublish(examIds, 'Admin');
    await invalidateAfterSuccess(result.success);
    return result;
  };

  const handleBulkUnpublish = async (examIds: string[]) => {
    const result = await examAuthoringFacade.lifecycle.bulkUnpublish(examIds, 'Admin');
    await invalidateAfterSuccess(result.success);
    return result;
  };

  const handleBulkArchive = async (examIds: string[]) => {
    const result = await examAuthoringFacade.lifecycle.bulkArchive(examIds, 'Admin');
    await invalidateAfterSuccess(result.success);
    return result;
  };

  const handleBulkDuplicate = async (examIds: string[], titlePattern?: string) => {
    const result = await examAuthoringFacade.lifecycle.bulkDuplicate(examIds, 'Admin', titlePattern);
    await invalidateAfterSuccess(result.success);
    return result;
  };

  const handleBulkExport = async (examIds: string[]) => {
    return examAuthoringFacade.lifecycle.bulkExport(examIds, 'Admin');
  };

  const handleBulkDelete = async (examIds: string[]) => {
    const result = await examAuthoringFacade.lifecycle.bulkDelete(examIds, 'Admin');
    await invalidateAfterSuccess(result.success);
    return result;
  };

  const handleDeleteExam = async (examId: string) => {
    const result = await deleteExamMutation.mutateAsync({ examId, actor: 'Admin' });
    if (!result.success) {
      alert(result.error ?? 'Failed to delete exam');
    }
  };

  const handleCreateExam = async (
    title: string,
    type: 'Academic' | 'General Training',
    preset: ExamConfig['general']['preset'] = 'Academic',
  ) => {
    const initialState = examAuthoringFacade.createInitialExamState(title, type, preset, defaults);
    const result = await examAuthoringFacade.lifecycle.createExam(
      title,
      type,
      initialState,
      'Sarah Chen',
    );

    if (result.success && result.exam) {
      await invalidateExamList(queryClient);
      navigate(`/builder/${result.exam.id}`);
    }
  };

  const handleGetVersions = async (examId: string): Promise<ExamVersionSummary[]> => {
    return examAuthoringFacade.repository.getVersionSummaries(examId);
  };

  const handleGetEvents = async (examId: string): Promise<ExamEvent[]> => {
    return examAuthoringFacade.repository.getEvents(examId);
  };

  const handleRestoreVersion = async (versionId: string) => {
    const version = await examAuthoringFacade.repository.getVersionById(versionId);
    if (!version) {
      return;
    }

    const result = await examAuthoringFacade.lifecycle.restoreVersionAsDraft(
      version.examId,
      versionId,
      'Admin',
    );
    await invalidateAfterSuccess(result.success);
  };

  const handleCompareVersions = async (
    versionIdA: string,
    versionIdB: string,
  ): Promise<VersionDiff | null> => {
    const versionA = await examAuthoringFacade.repository.getVersionById(versionIdA);
    const versionB = await examAuthoringFacade.repository.getVersionById(versionIdB);
    if (!versionA || !versionB) {
      return null;
    }

    return examAuthoringFacade.lifecycle.compareVersions(versionA.examId, versionIdA, versionIdB);
  };

  return (
    <ExamList
      onNavigate={(mode) => navigate(`/${mode}`)}
      exams={examList.exams}
      onEditExam={(id) => navigate(`/builder/${id}`)}
      onGoToConfig={(id) => navigate(`/builder/${id}`)}
      onGoToReview={(id) => navigate(`/builder/${id}/review`)}
      onCreateExam={handleCreateExam}
      onCloneExam={handleCloneExam}
      onCreateFromTemplate={handleCreateFromTemplate}
      examEntities={examList.entities}
      onGetVersions={handleGetVersions}
      onGetEvents={handleGetEvents}
      onRestoreVersion={handleRestoreVersion}
      onCompareVersions={handleCompareVersions}
      onBulkPublish={handleBulkPublish}
      onBulkUnpublish={handleBulkUnpublish}
      onBulkArchive={handleBulkArchive}
      onBulkDuplicate={handleBulkDuplicate}
      onBulkExport={handleBulkExport}
      onBulkDelete={handleBulkDelete}
      onDeleteExam={handleDeleteExam}
    />
  );
}
