import { hydrateExamState as hydrateExamStateFromAdapter } from '@services/examAdapterService';
import {
  backendGet,
  mapBackendExamVersion,
  mapBackendRuntime,
  mapBackendSchedule,
} from '@services/backendBridge';
import {
  mapBackendStudentAttempt,
  studentAttemptRepository,
} from '@services/studentAttemptRepository';
import { studentSessionTransport } from '@services/studentSessionTransport';
import type { ExamState } from '../../../types';
import type { StudentAttemptSeed } from '../../../types/studentAttempt';
import type {
  StudentSessionFacade,
  StudentSessionLivePayload,
  StudentSessionStaticPayload,
} from '../application/studentSessionFacade';

export { studentSessionTransport };

export function createStudentSessionGateway(): StudentSessionFacade {
  return {
    async loadStaticSession(scheduleId, candidateId) {
      return backendGet<StudentSessionStaticPayload>(
        studentSessionTransport.paths.staticSession(scheduleId, candidateId),
      );
    },

    async loadLiveSession(scheduleId, candidateId) {
      return backendGet<StudentSessionLivePayload>(
        studentSessionTransport.paths.liveSession(scheduleId, candidateId),
      );
    },

    mapSchedule(schedule) {
      return mapBackendSchedule(schedule as Parameters<typeof mapBackendSchedule>[0]);
    },

    mapVersion(version) {
      return mapBackendExamVersion(version as Parameters<typeof mapBackendExamVersion>[0]);
    },

    hydrateExamState(contentSnapshot, configSnapshot) {
      return hydrateExamStateFromAdapter({
        ...contentSnapshot,
        config: configSnapshot,
      } satisfies ExamState);
    },

    mapRuntime(runtime, schedule) {
      return mapBackendRuntime(runtime as Parameters<typeof mapBackendRuntime>[0], schedule);
    },

    mapAttempt(attempt) {
      return mapBackendStudentAttempt(attempt as Parameters<typeof mapBackendStudentAttempt>[0]);
    },

    saveAttempt(attempt) {
      return studentAttemptRepository.saveAttempt(attempt);
    },

    getAttemptsByScheduleId(scheduleId) {
      return studentAttemptRepository.getAttemptsByScheduleId(scheduleId);
    },

    createAttempt(seed) {
      return studentAttemptRepository.createAttempt(seed as StudentAttemptSeed);
    },
  };
}
