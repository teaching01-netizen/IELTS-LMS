import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExamSchedule } from '../../../types/domain';
import type {
  DerivedScheduleWindow,
  ScheduleRuntimeMutationResult,
  ScheduleWindowOptions,
} from '../contracts';
import { schedulingGateway } from '../infrastructure/schedulingGateway';

const scheduleQueryPolicy = {
  staleTime: 15 * 1000,
  gcTime: 2 * 60 * 1000,
} as const;

export const scheduleKeys = {
  all: ['scheduling'] as const,
  list: () => [...scheduleKeys.all, 'list'] as const,
};

export async function fetchScheduleList(): Promise<ExamSchedule[]> {
  return schedulingGateway.repository.getAllSchedules();
}

export function useScheduleListQuery(enabled = true) {
  return useQuery({
    queryKey: scheduleKeys.list(),
    queryFn: fetchScheduleList,
    enabled,
    ...scheduleQueryPolicy,
  });
}

export function useSaveScheduleMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ExamSchedule>({
    mutationFn: (schedule) => schedulingGateway.repository.saveSchedule(schedule),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.list() });
    },
  });
}

export function useDeleteScheduleMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (scheduleId) => schedulingGateway.repository.deleteSchedule(scheduleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.list() });
    },
  });
}

export function useStartScheduleMutation() {
  const queryClient = useQueryClient();

  return useMutation<ScheduleRuntimeMutationResult, Error, string>({
    mutationFn: (scheduleId) => schedulingGateway.delivery.startRuntime(scheduleId, 'Proctor'),
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: scheduleKeys.list() });
      }
    },
  });
}

export function getScheduleVersion(versionId: string) {
  return schedulingGateway.repository.getVersionById(versionId);
}

export function resolveScheduleWindow(options: ScheduleWindowOptions): DerivedScheduleWindow {
  return schedulingGateway.delivery.resolveScheduleWindow(options);
}

export function getPlannedDuration(config: Parameters<typeof schedulingGateway.delivery.getPlannedDuration>[0]): number {
  return schedulingGateway.delivery.getPlannedDuration(config);
}
