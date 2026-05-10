import { examAuthoringGateway } from '../infrastructure/examAuthoringGateway';

export const examAuthoringFacade = {
  repository: examAuthoringGateway.examRepository,
  lifecycle: examAuthoringGateway.examLifecycleService,
  delivery: examAuthoringGateway.examDeliveryService,
  preferences: examAuthoringGateway.adminPreferencesRepository,
  seedDevelopmentFixtures: examAuthoringGateway.seedDevelopmentFixtures,
  createInitialExamState: examAuthoringGateway.createInitialExamState,
  adaptExamEntitiesToLegacyExams: examAuthoringGateway.adaptExamEntitiesToLegacyExams,
  getExamStateFromEntity: examAuthoringGateway.getExamStateFromEntity,
  hydrateExamState: examAuthoringGateway.hydrateExamState,
};
