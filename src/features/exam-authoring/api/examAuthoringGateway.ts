/**
 * The exam-authoring feature's PUBLIC data gateway for other features
 * (builder, admin, products/sat, utils).
 *
 * This is a re-export by design, not an unnecessary wrapper: it is the seam
 * other features import instead of reaching into `infrastructure/`, and the
 * seam their tests replace with a double (see
 * previewRuntimeSessionService.terminal-reuse.test.ts). Collapsing it would
 * move a dependency-inversion boundary into its consumers.
 */
export {
  examAuthoringGateway,
  examDeliveryService,
  examLifecycleService,
  examRepository,
  getEnabledModules,
  getQuestionNumberLabel,
  getQuestionAnswer,
  getStudentQuestionsForModule,
  hydrateExamState,
  seedDevelopmentFixtures,
} from '../infrastructure/examAuthoringGateway';
export type { StudentQuestionDescriptor } from '../infrastructure/examAuthoringGateway';
