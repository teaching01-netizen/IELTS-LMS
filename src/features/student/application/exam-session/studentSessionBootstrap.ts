import {
  fetchStudentLiveSession,
  fetchStudentStaticSession,
  type BackendStudentLiveSessionContext,
  type BackendStudentStaticSessionContext,
} from '../../api/studentSessionQueries';
import { queryClient, queryKeys } from '../../../../shared/api/queryClient';

export interface StudentSessionBootstrap {
  loadStatic(): Promise<BackendStudentStaticSessionContext>;
  loadLive(): Promise<BackendStudentLiveSessionContext>;
  invalidateLive(): Promise<void>;
}

let studentSessionRequestSequence = 0;

export function createStudentSessionBootstrap(input: {
  readonly scheduleId: string;
  readonly candidateId: string;
}): StudentSessionBootstrap {
  const staticKey = queryKeys.students.staticSession(input.scheduleId, input.candidateId);
  const liveKey = queryKeys.students.liveSession(input.scheduleId, input.candidateId);
  const fetchFresh = async <T>(
    canonicalKey: readonly unknown[],
    queryFn: () => Promise<T>,
  ): Promise<T> => {
    studentSessionRequestSequence += 1;
    const requestKey = [...canonicalKey, 'request', studentSessionRequestSequence] as const;
    const data = await queryClient.fetchQuery({
      queryKey: requestKey,
      queryFn,
      staleTime: 0,
      retry: false,
    });
    queryClient.setQueryData(canonicalKey, data);
    queryClient.removeQueries({ queryKey: requestKey, exact: true });
    return data;
  };

  return {
    loadStatic: () =>
      fetchFresh(staticKey, () => fetchStudentStaticSession(input.scheduleId, input.candidateId)),
    loadLive: () =>
      fetchFresh(liveKey, () => fetchStudentLiveSession(input.scheduleId, input.candidateId)),
    invalidateLive: async () => {
      await queryClient.invalidateQueries({ queryKey: liveKey });
    },
  };
}
