import { adminPreferencesRepository } from '@services/adminPreferencesRepository';
import { seedDevelopmentFixtures } from '@services/developmentFixtures';
import {
  adaptExamEntitiesToLegacyExams,
  createInitialExamState,
  getEnabledModules,
  getExamStateFromEntity,
  hydrateExamState,
  getQuestionNumberLabel,
  getQuestionAnswer,
  getStudentQuestionsForModule,
  type StudentQuestionDescriptor,
} from '@services/examAdapterService';
import { examDeliveryService } from '@services/examDeliveryService';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';

export const examAuthoringGateway = {
  adminPreferencesRepository,
  seedDevelopmentFixtures,
  adaptExamEntitiesToLegacyExams,
  createInitialExamState,
  getEnabledModules,
  getExamStateFromEntity,
  hydrateExamState,
  getQuestionNumberLabel,
  getQuestionAnswer,
  getStudentQuestionsForModule,
  examDeliveryService,
  examLifecycleService,
  examRepository,
};

export {
  examDeliveryService,
  examLifecycleService,
  examRepository,
  getEnabledModules,
  getQuestionAnswer,
  getQuestionNumberLabel,
  getStudentQuestionsForModule,
  hydrateExamState,
  seedDevelopmentFixtures,
};
export type { StudentQuestionDescriptor };
