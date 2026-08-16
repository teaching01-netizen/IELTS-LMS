import { useQuery } from '@tanstack/react-query';
import {
  studentSessionFacade,
  type StudentSessionLivePayload,
  type StudentSessionStaticPayload,
} from '../application/studentSessionFacade';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { liveQueryPolicy, queryKeys, staticQueryPolicy } from '../../../shared/api/queryClient';

export type BackendStudentSessionContext = StudentSessionStaticPayload & StudentSessionLivePayload;
export type BackendStudentStaticSessionContext = StudentSessionStaticPayload;
export type BackendStudentLiveSessionContext = StudentSessionLivePayload;

export function fetchStudentStaticSession(scheduleId: string, candidateId: string) {
  return studentSessionFacade.loadStaticSession(scheduleId, candidateId);
}

export function fetchStudentLiveSession(scheduleId: string, candidateId: string) {
  return studentSessionFacade.loadLiveSession(scheduleId, candidateId);
}

export function useStudentStaticSession(
  scheduleId: string | undefined,
  candidateId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.students.staticSession(scheduleId ?? '', candidateId ?? ''),
    queryFn: () => fetchStudentStaticSession(scheduleId!, candidateId!),
    enabled: enabled && Boolean(scheduleId && candidateId),
    ...staticQueryPolicy,
  });
}

export function useStudentLiveSession(
  scheduleId: string | undefined,
  candidateId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.students.liveSession(scheduleId ?? '', candidateId ?? ''),
    queryFn: () => fetchStudentLiveSession(scheduleId!, candidateId!),
    enabled: enabled && Boolean(scheduleId && candidateId),
    ...liveQueryPolicy,
  });
}

export type BackendStudentAttemptPayload = NonNullable<BackendStudentSessionContext['attempt']>;
export type SavedStudentAttempt = StudentAttempt;
