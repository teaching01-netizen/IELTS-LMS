import { adminPreferencesRepository } from '@services/adminPreferencesRepository';
import { seedDevelopmentFixtures } from '@services/developmentFixtures';
import {
  adaptExamEntitiesToLegacyExams,
  createInitialExamState,
  getExamStateFromEntity,
  hydrateExamState,
} from '@services/examAdapterService';
import { examDeliveryService } from '@services/examDeliveryService';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';

export const examAuthoringGateway = {
  adminPreferencesRepository,
  seedDevelopmentFixtures,
  adaptExamEntitiesToLegacyExams,
  createInitialExamState,
  getExamStateFromEntity,
  hydrateExamState,
  examDeliveryService,
  examLifecycleService,
  examRepository,
};
