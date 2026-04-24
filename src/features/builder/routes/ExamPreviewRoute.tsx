import React, { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { StudentExamPreview } from '@components/student/StudentExamPreview';
import { useBuilderRouteController } from '@builder/hooks/useBuilderRouteController';
import type { ModuleType } from '../../../types';

const MODULE_KEYS: ModuleType[] = ['listening', 'reading', 'writing', 'speaking'];

export function ExamPreviewRoute() {
  const { examId } = useParams<{ examId: string }>();
  const [searchParams] = useSearchParams();

  const initialModule = useMemo<ModuleType | null>(() => {
    const raw = searchParams.get('module');
    if (!raw) {
      return null;
    }
    const normalized = raw.trim().toLowerCase();
    return MODULE_KEYS.includes(normalized as ModuleType) ? (normalized as ModuleType) : null;
  }, [searchParams]);

  if (!examId) {
    return (
      <ErrorSurface
        title="Preview unavailable"
        description="Exam ID not found."
      />
    );
  }

  const controller = useBuilderRouteController(examId);

  if (controller.isLoading) {
    return <LoadingSurface label="Loading preview…" />;
  }

  if (controller.error) {
    return (
      <ErrorSurface
        title="Preview load failed"
        description={controller.error}
      />
    );
  }

  if (!controller.state) {
    return (
      <ErrorSurface
        title="Preview unavailable"
        description="The requested exam could not be loaded."
      />
    );
  }

  return (
    <StudentExamPreview
      examId={examId}
      state={controller.state}
      initialModule={initialModule}
    />
  );
}

