import { useQuery } from '@tanstack/react-query';
import { proctorFacade } from '../../../features/proctor/api/proctorFacade';

export type SatRoomEntryState = 'not_joined' | 'waiting' | 'working' | 'finished';

export interface SatRoomEntryLink {
  id: string;
  name: string;
  versionNumber: number;
  publishScope: 'full' | 'reading-writing' | 'math';
  enabledSections: readonly string[] | null;
  audienceType: 'anyone' | 'cohort' | 'selected_students';
  audienceLabel: string | null;
  accessMode: 'student_code' | 'open';
  availabilityType: 'scheduled' | 'anytime';
  status: 'live' | 'upcoming' | 'ended' | 'paused' | 'revoked';
  selectedStudentCount: number;
}

export interface SatRoomExpectedStudent {
  ordinal: number;
  name: string;
  state: SatRoomEntryState;
  attemptId: string | null;
}

export interface SatRoomEntryInfo {
  link: SatRoomEntryLink | null;
  roster: readonly SatRoomExpectedStudent[];
}

export function useSatRoomEntryInfo(scheduleId: string, enabled = true) {
  return useQuery({
    queryKey: ['sat-room-entry-info', scheduleId] as const,
    queryFn: ({ signal }) => proctorFacade.backendGet<SatRoomEntryInfo>(`/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/entry-info`, { signal }),
    enabled: Boolean(scheduleId) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchInterval: enabled ? 30_000 : false,
  });
}
