import { useCallback, useEffect, useState } from 'react';
import { useAsyncPolling } from '@app/hooks/useAsyncPolling';
import { examDeliveryService } from '@services/examDeliveryService';
import { getExamStateFromEntity } from '@services/examAdapterService';
import { examRepository } from '@services/examRepository';
import { studentAttemptRepository } from '@services/studentAttemptRepository';
import type { ExamState } from '../../../types';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';

function getStudentKey(scheduleId: string) {
  return `student-${scheduleId}`;
}

interface StudentSessionRouteData {
  attemptSnapshot: StudentAttempt | null;
  error: string | null;
  isLoading: boolean;
  runtimeSnapshot: ExamSessionRuntime | null;
  schedule: ExamSchedule | null;
  state: ExamState | null;
  refreshRuntime: () => Promise<void>;
  retry: () => Promise<void>;
}

export function useStudentSessionRouteData(
  scheduleId?: string,
): StudentSessionRouteData {
  const [attemptSnapshot, setAttemptSnapshot] = useState<StudentAttempt | null>(null);
  const [schedule, setSchedule] = useState<ExamSchedule | null>(null);
  const [state, setState] = useState<ExamState | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ExamSessionRuntime | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshRuntimeSnapshot = useCallback(async () => {
    if (!scheduleId) {
      return;
    }

    try {
      const snapshot = await examDeliveryService.getRuntimeSnapshot(scheduleId);
      setRuntimeSnapshot(snapshot);
    } catch {
      setRuntimeSnapshot(null);
    }
  }, [scheduleId]);

  const loadStudentData = useCallback(async () => {
    if (!scheduleId) {
      setError('Schedule ID not found');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const schedules = await examRepository.getAllSchedules();
      const scheduleEntity = schedules.find((candidate) => candidate.id === scheduleId);

      if (!scheduleEntity) {
        throw new Error('Schedule not found');
      }
      setSchedule(scheduleEntity);

      const examEntity = await examRepository.getExamById(scheduleEntity.examId);
      if (!examEntity) {
        throw new Error('Exam not found');
      }

      const examState = await getExamStateFromEntity(examEntity, examRepository);
      setState(examState);
      const snapshot = await examDeliveryService.getRuntimeSnapshot(scheduleId);
      setRuntimeSnapshot(snapshot);

      const studentKey = getStudentKey(scheduleId);
      const existingAttempt = await studentAttemptRepository.getAttemptByScheduleId(
        scheduleId,
        studentKey,
      );

      if (existingAttempt) {
        setAttemptSnapshot(existingAttempt);
      } else {
        const firstEnabledModule =
          (['listening', 'reading', 'writing', 'speaking'] as const).find(
            (module) => examState.config.sections[module].enabled,
          ) ?? 'listening';
        const createdAttempt = await studentAttemptRepository.createAttempt({
          scheduleId,
          studentKey,
          examId: scheduleEntity.examId,
          examTitle: scheduleEntity.examTitle,
          currentModule: snapshot?.currentSectionKey ?? firstEnabledModule,
        });
        setAttemptSnapshot(createdAttempt);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load exam data');
    } finally {
      setIsLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    void loadStudentData();
  }, [loadStudentData]);

  useAsyncPolling(refreshRuntimeSnapshot, {
    enabled: Boolean(scheduleId && state && !error),
    intervalMs: 1_000,
    maxIntervalMs: 4_000,
  });

  return {
    attemptSnapshot,
    error,
    isLoading,
    runtimeSnapshot,
    schedule,
    state,
    refreshRuntime: refreshRuntimeSnapshot,
    retry: loadStudentData,
  };
}
