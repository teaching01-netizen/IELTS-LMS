import type { RuntimeStatus, SectionRuntimeStatus } from './types/domain';

export type ModuleType = 'listening' | 'reading' | 'writing' | 'speaking';
export type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export type QuestionType =
  | 'TFNG'
  | 'CLOZE'
  | 'MATCHING'
  | 'MAP'
  | 'MULTI_MCQ'
  | 'SINGLE_MCQ'
  | 'SHORT_ANSWER'
  | 'SENTENCE_COMPLETION'
  | 'DIAGRAM_LABELING'
  | 'FLOW_CHART'
  | 'TABLE_COMPLETION'
  | 'NOTE_COMPLETION'
  | 'CLASSIFICATION'
  | 'MATCHING_FEATURES';

export type TFNGMode = 'TFNG' | 'YNNG';
export type AnswerRule = 'ONE_WORD' | 'TWO_WORDS' | 'THREE_WORDS';

export interface TFNGQuestion {
  id: string;
  statement: string;
  correctAnswer: 'T' | 'F' | 'NG' | 'Y' | 'N' | 'NG';
}

export interface ClozeQuestion {
  id: string;
  prompt: string;
  correctAnswer: string;
}

export interface MatchingQuestion {
  id: string;
  paragraphLabel: string;
  correctHeading: string;
}

export interface MapQuestion {
  id: string;
  label: string;
  correctAnswer: string;
  x: number;
  y: number;
}

export interface MCQOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export type QuestionAnswer = 
  | string // For text answers, single MCQ selection, matching
  | string[] // For multi-select MCQ
  | 'T' | 'F' | 'NG' | 'Y' | 'N' // For TFNG/YNNG questions
  | null
  | undefined; // For unassigned answers

export type StimulusAnnotationTool = 'pointer' | 'hotspot' | 'arrow' | 'text' | 'box' | 'zoom';

export interface StimulusAnnotation {
  id: string;
  type: Exclude<StimulusAnnotationTool, 'pointer' | 'zoom'>;
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  text?: string | undefined;
  color?: string | undefined;
}

export interface StimulusImageAsset {
  id: string;
  alt: string;
  annotations: StimulusAnnotation[];
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  height: number;
  src: string;
  width: number;
  zoom: number;
}

export interface WritingChartData {
  id: string;
  imageSrc?: string | undefined;
  labels: string[];
  title: string;
  type: 'bar' | 'line' | 'pie' | 'table';
  values: number[];
}

export interface WritingTaskContent {
  taskId: string;
  prompt: string;
  chart?: WritingChartData | undefined;
  modelAnswer?: string | undefined;
  letterType?: 'formal' | 'informal' | 'semi-formal' | undefined;
  recipient?: string | undefined;
  letterPurpose?: string | undefined;
}

export interface PromptTemplateRecord {
  id: string;
  title: string;
  topic: 'Education' | 'Technology' | 'Environment' | 'Health' | 'Society';
  category: 'Task 1 Academic' | 'Task 1 General Training' | 'Task 2 Essay';
  prompt: string;
  source: 'official' | 'custom';
}

export interface RubricCriterion {
  id: string;
  label: string;
  description: string;
  weight: number;
  officialWeight: number;
}

export interface RubricDefinition {
  id: string;
  title: string;
  module: 'writing' | 'speaking';
  criteria: RubricCriterion[];
  custom?: boolean | undefined;
}

export interface CueCardDetails {
  topic: string;
  bullets: string[];
  timeAllocation: string;
  evaluatorNotes: string;
}

export interface CriterionBandScore {
  criterionId: string;
  band: number;
  comment: string;
}

export interface GradeHistoryEntry {
  id: string;
  assessor: string;
  createdAt: string;
  criteria: CriterionBandScore[];
  finalBand: number;
  note?: string | undefined;
}

export interface BaseQuestionBlock {
  id: string;
  type: QuestionType;
  instruction: string;
}

export interface TFNGBlock extends BaseQuestionBlock {
  type: 'TFNG';
  mode: TFNGMode;
  questions: TFNGQuestion[];
}

export interface ClozeBlock extends BaseQuestionBlock {
  type: 'CLOZE';
  answerRule: AnswerRule;
  questions: ClozeQuestion[];
}

export interface MatchingBlock extends BaseQuestionBlock {
  type: 'MATCHING';
  headings: { id: string; text: string }[];
  questions: MatchingQuestion[];
}

export interface MapBlock extends BaseQuestionBlock {
  type: 'MAP';
  assetUrl: string;
  questions: MapQuestion[];
}

export interface MultiMCQBlock extends BaseQuestionBlock {
  type: 'MULTI_MCQ';
  stem: string;
  requiredSelections: number;
  options: MCQOption[];
}

export interface SingleMCQBlock extends BaseQuestionBlock {
  type: 'SINGLE_MCQ';
  stem: string;
  options: MCQOption[];
}

export interface ShortAnswerQuestion {
  id: string;
  prompt: string;
  correctAnswer: string;
  answerRule: AnswerRule;
}

export interface ShortAnswerBlock extends BaseQuestionBlock {
  type: 'SHORT_ANSWER';
  questions: ShortAnswerQuestion[];
}

export interface SentenceBlank {
  id: string;
  correctAnswer: string;
  position: number;
}

export interface SentenceCompletionQuestion {
  id: string;
  sentence: string;
  blanks: SentenceBlank[];
  answerRule: AnswerRule;
}

export interface SentenceCompletionBlock extends BaseQuestionBlock {
  type: 'SENTENCE_COMPLETION';
  questions: SentenceCompletionQuestion[];
}

export interface DiagramLabel {
  id: string;
  x: number;
  y: number;
  correctAnswer: string;
}

export interface DiagramLabelingBlock extends BaseQuestionBlock {
  type: 'DIAGRAM_LABELING';
  imageUrl: string;
  labels: DiagramLabel[];
}

export interface FlowChartStep {
  id: string;
  label: string;
  correctAnswer: string;
}

export interface FlowChartBlock extends BaseQuestionBlock {
  type: 'FLOW_CHART';
  steps: FlowChartStep[];
}

export interface TableCell {
  id: string;
  correctAnswer: string;
  row: number;
  col: number;
}

export interface TableCompletionBlock extends BaseQuestionBlock {
  type: 'TABLE_COMPLETION';
  headers: string[];
  rows: string[][];
  cells: TableCell[];
  answerRule: AnswerRule;
}

export interface NoteBlank {
  id: string;
  correctAnswer: string;
  position: number;
}

export interface NoteCompletionQuestion {
  id: string;
  noteText: string;
  blanks: NoteBlank[];
  answerRule: AnswerRule;
}

export interface NoteCompletionBlock extends BaseQuestionBlock {
  type: 'NOTE_COMPLETION';
  questions: NoteCompletionQuestion[];
}

export interface ClassificationItem {
  id: string;
  text: string;
  correctCategory: string;
}

export interface ClassificationBlock extends BaseQuestionBlock {
  type: 'CLASSIFICATION';
  categories: string[];
  items: ClassificationItem[];
}

export interface MatchingFeature {
  id: string;
  text: string;
  correctMatch: string;
}

export interface MatchingFeaturesBlock extends BaseQuestionBlock {
  type: 'MATCHING_FEATURES';
  features: MatchingFeature[];
  options: string[];
}

export type QuestionBlock =
  | TFNGBlock
  | ClozeBlock
  | MatchingBlock
  | MapBlock
  | MultiMCQBlock
  | SingleMCQBlock
  | ShortAnswerBlock
  | SentenceCompletionBlock
  | DiagramLabelingBlock
  | FlowChartBlock
  | TableCompletionBlock
  | NoteCompletionBlock
  | ClassificationBlock
  | MatchingFeaturesBlock;

export interface Passage {
  id: string;
  title: string;
  content: string;
  blocks: QuestionBlock[];
  images?: StimulusImageAsset[] | undefined;
  wordCount?: number | undefined;
  metadata?: PassageMetadata | undefined;
}

// Question Bank Types
export interface QuestionMetadata {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  usageCount: number;
  createdAt: string;
  lastUsedAt?: string | undefined;
  author: string;
}

export interface QuestionBankItem {
  id: string;
  block: QuestionBlock;
  metadata: QuestionMetadata;
}

export interface QuestionBankQuery {
  type?: QuestionType | undefined;
  difficulty?: 'easy' | 'medium' | 'hard' | undefined;
  topic?: string | undefined;
  tags?: string[] | undefined;
  searchTerm?: string | undefined;
}

// Passage Management Types
export interface PassageMetadata {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  source: string;
  topic: string;
  tags: string[];
  wordCount: number;
  estimatedTimeMinutes: number;
  usageCount: number;
  createdAt: string;
  lastUsedAt?: string | undefined;
  author: string;
}

export interface PassageLibraryItem {
  id: string;
  passage: Passage;
  metadata: PassageMetadata;
}

export interface PassageLibraryQuery {
  difficulty?: 'easy' | 'medium' | 'hard' | undefined;
  topic?: string | undefined;
  tags?: string[] | undefined;
  searchTerm?: string | undefined;
  minWordCount?: number | undefined;
  maxWordCount?: number | undefined;
}

export interface ListeningPart {
  id: string;
  title: string;
  audioUrl?: string | undefined;
  pins: { id: string, time: string, label: string }[];
  blocks: QuestionBlock[];
}

export interface BandScoreTable {
  [raw: number]: number;
}

export interface PassageWordCountStandards {
  optimalMin: number;
  optimalMax: number;
  warningMin: number;
  warningMax: number;
}

export interface WritingTaskStandard {
  minWords: number;
  recommendedTime: number;
}

export interface WritingRubricWeights {
  taskResponse: number;
  coherence: number;
  lexical: number;
  grammar: number;
}

export interface SpeakingRubricWeights {
  fluency: number;
  lexical: number;
  grammar: number;
  pronunciation: number;
}

export interface StandardsConfig {
  passageWordCount: PassageWordCountStandards;
  writingTasks: {
    task1: WritingTaskStandard;
    task2: WritingTaskStandard;
  };
  rubricDeviationThreshold: number;
  rubricWeights: {
    writing: WritingRubricWeights;
    speaking: SpeakingRubricWeights;
  };
  bandScoreTables: {
    listening: BandScoreTable;
    readingAcademic: BandScoreTable;
    readingGeneralTraining: BandScoreTable;
  };
}

export type WritingTaskType = 'task1-academic' | 'task1-general' | 'task2-essay';

export interface WritingTaskConfig {
  id: string;
  label: string;
  taskType: WritingTaskType;
  minWords: number;
  maxWords?: number | undefined;
  optimalMin?: number | undefined;
  optimalMax?: number | undefined;
  recommendedTime: number; // in minutes
  rubricId?: string | undefined;
}

export interface SpeakingPartConfig {
  id: string;
  label: string;
  prepTime: number; // in seconds
  speakingTime: number; // in seconds
  rubricId?: string | undefined;
}

export interface ModuleConfig {
  enabled: boolean;
  label: string;
  duration: number; // in minutes
  order: number;
  gapAfterMinutes: number;
  allowedQuestionTypes: QuestionType[];
}

export interface ListeningConfig extends ModuleConfig {
  partCount: number;
  bandScoreTable: BandScoreTable;
  /**
   * When false, candidates will not be able to play the listening audio track.
   * Defaults to true when omitted (backwards compatible with older exams).
   */
  audioPlaybackEnabled?: boolean | undefined;
  /**
   * Optional staff-authored instructions shown to candidates during Listening.
   */
  staffInstructions?: string | undefined;
}

export interface ReadingConfig extends ModuleConfig {
  passageCount: number;
  bandScoreTable: BandScoreTable;
}

export interface WritingConfig extends ModuleConfig {
  tasks: WritingTaskConfig[];
  rubricWeights: WritingRubricWeights;
}

export interface SpeakingConfig extends ModuleConfig {
  parts: SpeakingPartConfig[];
  rubricWeights: SpeakingRubricWeights;
}

export interface ExamConfig {
  general: {
    preset: 'Academic' | 'General Training' | 'Listening' | 'Reading' | 'Writing' | 'Speaking' | 'Custom';
    type: 'Academic' | 'General Training';
    ieltsMode: boolean;
    title: string;
    summary: string;
    instructions: string;
  };
  sections: {
    listening: ListeningConfig;
    reading: ReadingConfig;
    writing: WritingConfig;
    speaking: SpeakingConfig;
  };
  standards: StandardsConfig;
  progression: {
    autoSubmit: boolean;
    lockAfterSubmit: boolean;
    allowPause: boolean;
    showWarnings: boolean;
    warningThreshold: number;
    unansweredSubmissionPolicy?: 'allow' | 'confirm' | 'block' | undefined;
  };
  delivery: {
    launchMode: 'proctor_start';
    transitionMode: 'auto_with_proctor_override';
    allowedExtensionMinutes: number[];
  };
  scoring: {
    overallRounding: 'nearest-0.5' | 'floor' | 'ceil';
  };
  security: {
    requireFullscreen: boolean;
    tabSwitchRule: 'none' | 'warn' | 'terminate';
    detectSecondaryScreen: boolean;
    blockClipboard: boolean;
    preventAutofill: boolean;
    preventAutocorrect: boolean;
    preventTranslation: boolean;
    fullscreenAutoReentry: boolean;
    fullscreenMaxViolations: number;
    heartbeatIntervalSeconds?: number | undefined;
    heartbeatMissThreshold?: number | undefined;
    heartbeatWarningThreshold?: number | undefined;
    heartbeatHardBlockThreshold?: number | undefined;
    pauseOnOffline?: boolean | undefined;
    bufferAnswersOffline?: boolean | undefined;
    requireDeviceContinuityOnReconnect?: boolean | undefined;
    allowSafariWithAcknowledgement?: boolean | undefined;
    proctoringFlags: {
      webcam: boolean;
      audio: boolean;
      screen: boolean;
    };
    severityThresholds?: {
      lowLimit: number;
      mediumLimit: number;
      highLimit: number;
      criticalAction: 'terminate';
    } | undefined;
  };
}

export interface ExamDefaultsProfile {
  id: string;
  name: string;
  config: ExamConfig;
}

export type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'error';

export interface ValidationError {
  blockId?: string | undefined;
  passageId?: string | undefined;
  partId?: string | undefined;
  field: string;
  message: string;
  type: 'error' | 'warning';
}

export interface ValidationScope {
  checked: string[];
  notChecked: string[];
}

export interface BlockValidation {
  blockId: string;
  isValid: boolean;
  errors: ValidationError[];
}

export interface Exam {
  id: string;
  title: string;
  type: 'Academic' | 'General Training';
  status: 'Draft' | 'Published' | 'Archived';
  author: string;
  lastModified: string;
  createdAt: string;
  content: ExamState;
  saveStatus?: SaveStatus | undefined;
}

export interface ExamState {
  title: string;
  type: 'Academic' | 'General Training';
  activeModule: ModuleType;
  activePassageId: string;
  activeListeningPartId: string;
  config: ExamConfig;
  reading: {
    passages: Passage[];
  };
  listening: {
    parts: ListeningPart[];
  };
  writing: {
    task1Prompt: string;
    task2Prompt: string;
    task1Chart?: WritingChartData | undefined;
    tasks?: WritingTaskContent[] | undefined;
    customPromptTemplates?: PromptTemplateRecord[] | undefined;
    rubric?: RubricDefinition | undefined;
    gradeHistory?: GradeHistoryEntry[] | undefined;
  };
  speaking: {
    part1Topics: string[];
    cueCard: string;
    cueCardDetails?: CueCardDetails | undefined;
    part3Discussion: string[];
    evaluatorNotes?: string | undefined;
    rubric?: RubricDefinition | undefined;
    gradeHistory?: GradeHistoryEntry[] | undefined;
  };
}

export type StudentStatus = 'active' | 'warned' | 'paused' | 'terminated' | 'idle' | 'connecting';

export type ViolationSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Violation {
  id: string;
  type: string;
  severity: ViolationSeverity;
  timestamp: string;
  description: string;
}

export interface StudentSession {
  id: string;
  studentId: string;
  name: string;
  email: string;
  scheduleId: string;
  status: StudentStatus;
  currentSection: ModuleType;
  timeRemaining: number;
  runtimeStatus?: RuntimeStatus | undefined;
  runtimeCurrentSection?: ModuleType | null | undefined;
  runtimeTimeRemainingSeconds?: number | undefined;
  runtimeSectionStatus?: SectionRuntimeStatus | undefined;
  runtimeWaiting?: boolean | undefined;
  violations: Violation[];
  warnings: number;
  lastActivity: string;
  examId: string;
  examName: string;
}

export interface ExamGroup {
  id: string;
  scheduleId: string;
  examId: string;
  examTitle: string;
  cohortName: string;
  scheduledStartTime: string;
  runtimeStatus: RuntimeStatus;
  isReadyToStart: boolean;
  currentLiveSection: ModuleType | null;
  studentCount: number;
  activeCount: number;
  violationCount: number;
  status: 'live' | 'scheduled' | 'completed' | 'cancelled' | 'not_started';
  plannedDurationMinutes: number;
}

export interface ProctorAlert {
  id: string;
  severity: ViolationSeverity;
  type: string;
  studentName: string;
  studentId: string;
  timestamp: string;
  message: string;
  isAcknowledged: boolean;
}

export type AuditActionType =
  | 'SESSION_START'
  | 'SESSION_PAUSE'
  | 'SESSION_RESUME'
  | 'SESSION_END'
  | 'SECTION_START'
  | 'SECTION_END'
  | 'VIOLATION_DETECTED'
  | 'STUDENT_WARN'
  | 'STUDENT_PAUSE'
  | 'STUDENT_RESUME'
  | 'STUDENT_TERMINATE'
  | 'COHORT_PAUSE'
  | 'COHORT_RESUME'
  | 'EXTENSION_GRANTED'
  | 'ALERT_ACKNOWLEDGED'
  | 'NOTE_CREATED'
  | 'HANDOVER_INITIATED'
  | 'PRECHECK_COMPLETED'
  | 'PRECHECK_WARNING_ACKNOWLEDGED'
  | 'NETWORK_DISCONNECTED'
  | 'NETWORK_RECONNECTED'
  | 'HEARTBEAT_MISSED'
  | 'HEARTBEAT_LOST'
  | 'DEVICE_CONTINUITY_FAILED'
  | 'CLIPBOARD_BLOCKED'
  | 'CONTEXT_MENU_BLOCKED'
  | 'AUTOFILL_SUSPECTED'
  | 'PASTE_BLOCKED'
  | 'REPLACEMENT_SUSPECTED'
  | 'SCREEN_CHECK_UNSUPPORTED'
  | 'SCREEN_CHECK_PERMISSION_DENIED'
  | 'AUTO_ACTION';

export interface SessionAuditLog {
  id: string;
  timestamp: string;
  actor: string; // 'system' or proctor name/ID
  actionType: AuditActionType;
  targetStudentId?: string | undefined;
  sessionId: string; // scheduleId
  payload?: Record<string, unknown> | undefined;
}

export type NoteCategory = 'general' | 'incident' | 'handover';

export interface SessionNote {
  id: string;
  scheduleId: string;
  author: string;
  timestamp: string;
  content: string;
  category: NoteCategory;
  isResolved?: boolean | undefined;
}

export type ViolationTriggerType = 'violation_count' | 'specific_violation_type' | 'severity_threshold';
export type ViolationAutoAction = 'warn' | 'pause' | 'notify_proctor' | 'terminate';

export interface ViolationRule {
  id: string;
  scheduleId: string;
  triggerType: ViolationTriggerType;
  threshold: number;
  specificViolationType?: string | undefined;
  specificSeverity?: ViolationSeverity | undefined;
  action: ViolationAutoAction;
  isEnabled: boolean;
  createdAt: string;
  createdBy: string;
}
