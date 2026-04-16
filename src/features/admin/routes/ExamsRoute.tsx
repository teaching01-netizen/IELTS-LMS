import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adaptExamEntitiesToLegacyExams,
  createInitialExamState,
} from '@services/examAdapterService';
import { AdminExams } from '@components/admin/AdminExams';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';
import type { Exam, ExamConfig } from '../../../types';
import type { ExamEntity, ExamEvent, ExamVersion, VersionDiff } from '../../../types/domain';
import { useAdminContext } from './AdminContext';

/**
 * Exams Route
 *
 * Exam list mutations delegate shared conversion and state-factory logic to
 * service adapters so route files stop copy-pasting business logic.
 */
export function ExamsRoute() {
  const { defaults, examEntities, exams, onNavigate, onGetVersions, onGetEvents, onRestoreVersion, onRepublishVersion, onCompareVersions } = useAdminContext();
  const navigate = useNavigate();
  const [localExamEntities, setLocalExamEntities] = useState<ExamEntity[]>(examEntities);
  const [localExams, setLocalExams] = useState<Exam[]>(exams);

  const refreshLocalExamData = async () => {
    const entities = await examRepository.getAllExams();
    setLocalExamEntities(entities);
    setLocalExams(await adaptExamEntitiesToLegacyExams(entities, examRepository));
  };

  const handleCloneExam = async (examId: string, newTitle: string) => {
    await examLifecycleService.cloneExam(examId, newTitle, 'Admin');
    await refreshLocalExamData();
  };

  const handleCreateFromTemplate = async (templateId: string, newTitle: string) => {
    await examLifecycleService.createFromTemplate(templateId, newTitle, 'Admin');
    await refreshLocalExamData();
  };

  const handleBulkPublish = async (examIds: string[]) => {
    return examLifecycleService.bulkPublish(examIds, 'Admin');
  };

  const handleBulkUnpublish = async (examIds: string[]) => {
    return examLifecycleService.bulkUnpublish(examIds, 'Admin');
  };

  const handleBulkArchive = async (examIds: string[]) => {
    return examLifecycleService.bulkArchive(examIds, 'Admin');
  };

  const handleBulkDuplicate = async (examIds: string[]) => {
    return examLifecycleService.bulkDuplicate(examIds, 'Admin');
  };

  const handleBulkExport = async (examIds: string[]) => {
    return examLifecycleService.bulkExport(examIds, 'Admin');
  };

  const handleCreateExam = async (
    title: string,
    type: 'Academic' | 'General Training',
    preset: ExamConfig['general']['preset'] = 'Academic',
  ) => {
    const initialState = createInitialExamState(title, type, preset, defaults);
    const result = await examLifecycleService.createExam(title, type, initialState, 'Sarah Chen');

    if (result.success && result.exam) {
      await refreshLocalExamData();
      navigate(`/builder/${result.exam.id}`);
    }
  };

  return (
    <AdminExams
      onNavigate={onNavigate}
      exams={localExams}
      onEditExam={(id) => navigate(`/builder/${id}`)}
      onGoToConfig={(id) => navigate(`/builder/${id}`)}
      onGoToReview={(id) => navigate(`/builder/${id}/review`)}
      onCreateExam={handleCreateExam}
      onCloneExam={handleCloneExam}
      onCreateFromTemplate={handleCreateFromTemplate}
      examEntities={localExamEntities}
      onGetVersions={onGetVersions}
      onGetEvents={onGetEvents}
      onRestoreVersion={onRestoreVersion}
      onRepublishVersion={onRepublishVersion}
      onCompareVersions={onCompareVersions}
      onBulkPublish={handleBulkPublish}
      onBulkUnpublish={handleBulkUnpublish}
      onBulkArchive={handleBulkArchive}
      onBulkDuplicate={handleBulkDuplicate}
      onBulkExport={handleBulkExport}
    />
  );
}
