/**
 * Domain Model for Grading Workflow
 * 
 * This file defines the authoritative domain entities for the grading system.
 * Grading is a 3-level workflow: Session Queue -> Session Detail -> Student Review Workspace.
 */

/**
 * Grading session status
 */
export type GradingSessionStatus = 
  | 'scheduled'
  | 'live'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/**
 * Student submission status per section
 */
export type SectionGradingStatus = 
  | 'pending'
  | 'auto_graded'
  | 'needs_review'
  | 'in_review'
  | 'finalized'
  | 'reopened';

/**
 * Overall grading status for a student attempt
 */
export type OverallGradingStatus = 
  | 'not_submitted'
  | 'submitted'
  | 'in_progress'
  | 'grading_complete'
  | 'ready_to_release'
  | 'released'
  | 'reopened';

/**
 * Release workflow states - separate from grading status
 */
export type ReleaseStatus = 
  | 'draft'
  | 'grading_complete'
  | 'ready_to_release'
  | 'released'
  | 'reopened';

/**
 * Visibility for comments and notes
 */
export type CommentVisibility = 'student_visible' | 'internal_only';

/**
 * Writing annotation types
 */
export type AnnotationType = 
  | 'inline_comment'
  | 'rubric_note'
  | 'overall_feedback'
  | 'private_grader_note'
  | 'highlight'
  | 'underline'
  | 'strike_through'
  | 'circle'
  | 'freehand_draw'
  | 'arrow'
  | 'margin_comment';

/**
 * Drawing annotation for freehand and shapes
 */
export interface DrawingAnnotation {
  id: string;
  taskId: string;
  type: 'freehand_draw' | 'arrow' | 'circle' | 'underline' | 'strike_through';
  
  // Coordinates (relative to text container)
  points: Array<{ x: number; y: number }>;
  color: string;
  strokeWidth: number;
  
  visibility: CommentVisibility;
  
  createdBy: string;
  createdAt: string;
  updatedAt?: string | undefined;
}

/**
 * Grading Session - Level 1: Groups exam version + cohort + scheduled window
 * This is the top-level grouping for the grading queue
 */
export interface GradingSession {
  id: string;
  scheduleId: string;
  examId: string;
  examTitle: string;
  publishedVersionId: string;
  cohortName: string;
  institution?: string | undefined;
  
  // Session timing
  startTime: string;
  endTime: string;
  
  // Status
  status: GradingSessionStatus;
  
  // Counters (denormalized for performance)
  totalStudents: number;
  submittedCount: number;
  pendingManualReviews: number;
  inProgressReviews: number;
  finalizedReviews: number;
  overdueReviews: number;
  
  // Assigned teachers
  assignedTeachers: string[];
  
  // Metadata
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/**
 * Student Submission - Links a student's attempt to a session
 * Level 2: One row per student attempt in session detail
 */
export interface StudentSubmission {
  id: string;
  submissionId: string;
  scheduleId: string;
  examId: string;
  publishedVersionId: string;
  studentId: string;
  studentName: string;
  studentEmail?: string | undefined;
  cohortName: string;
  
  // Submission timing
  submittedAt: string;
  timeSpentSeconds: number;
  
  // Overall grading status
  gradingStatus: OverallGradingStatus;
  
  // Assignment
  assignedTeacherId?: string | undefined;
  assignedTeacherName?: string | undefined;
  
  // Flags
  isFlagged: boolean;
  flagReason?: string | undefined;
  isOverdue: boolean;
  dueDate?: string | undefined;
  
  // Section-level status badges
  sectionStatuses: {
    listening: SectionGradingStatus;
    reading: SectionGradingStatus;
    writing: SectionGradingStatus;
    speaking: SectionGradingStatus;
  };
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Section Submission - Immutable snapshot of a student's section attempt
 */
export interface SectionSubmission {
  id: string;
  submissionId: string;
  section: 'listening' | 'reading' | 'writing' | 'speaking';
  
  // Immutable snapshot of student answers
  answers: SectionAnswers;
  
  // Auto-grading results (for objective sections)
  autoGradingResults?: AutoGradingResult | undefined;
  
  // Grading status
  gradingStatus: SectionGradingStatus;
  
  // Review metadata
  reviewedBy?: string | undefined;
  reviewedAt?: string | undefined;
  finalizedBy?: string | undefined;
  finalizedAt?: string | undefined;
  
  // Metadata
  submittedAt: string;
}

/**
 * Section answers - discriminated union by section type
 */
export type SectionAnswers = 
  | ListeningAnswers
  | ReadingAnswers
  | WritingAnswers
  | SpeakingAnswers;

export interface ListeningAnswers {
  type: 'listening';
  parts: ListeningPartAnswers[];
}

export interface ListeningPartAnswers {
  partId: string;
  questions: ObjectiveQuestionAnswer[];
}

export interface ReadingAnswers {
  type: 'reading';
  passages: ReadingPassageAnswers[];
}

export interface ReadingPassageAnswers {
  passageId: string;
  questions: ObjectiveQuestionAnswer[];
}

export interface WritingAnswers {
  type: 'writing';
  tasks: WritingTaskAnswer[];
}

export interface WritingTaskAnswer {
  taskId: string;
  taskLabel: string;
  text: string;
  wordCount: number;
  prompt: string;
}

export interface SpeakingAnswers {
  type: 'speaking';
  part1Answers?: string[] | undefined;
  part2Recording?: string | undefined; // URL to audio file
  part2Transcript?: string | undefined; // Optional transcript
  part3Answers?: string[] | undefined;
}

/**
 * Objective question answer (for reading/listening)
 */
export interface ObjectiveQuestionAnswer {
  questionId: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect?: boolean | undefined; // Auto-graded
  score?: number | undefined;
  maxScore: number;
  scoringRule?: string | undefined;
}

/**
 * Auto-grading result for objective sections
 */
export interface AutoGradingResult {
  totalScore: number;
  maxScore: number;
  percentage: number;
  questionResults: ObjectiveQuestionResult[];
  generatedAt: string;
}

/**
 * Individual question result with override support
 */
export interface ObjectiveQuestionResult {
  questionId: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  awardedScore: number;
  maxScore: number;
  scoringRule: string;
  hasOverride: boolean;
  overrideReason?: string | undefined;
  overriddenBy?: string | undefined;
  overriddenAt?: string | undefined;
}

/**
 * Writing task submission with review support
 */
export interface WritingTaskSubmission {
  id: string;
  submissionId: string;
  taskId: string;
  taskLabel: string;
  
  // Immutable snapshot
  prompt: string;
  studentText: string;
  wordCount: number;
  
  // Grading
  rubricAssessment?: RubricAssessment | undefined;
  
  // Comments/annotations
  annotations: WritingAnnotation[];
  
  // Overall feedback
  overallFeedback?: string | undefined;
  studentVisibleNotes?: string | undefined;
  
  // Grading status
  gradingStatus: SectionGradingStatus;
  
  // Metadata
  submittedAt: string;
  gradedBy?: string | undefined;
  gradedAt?: string | undefined;
  finalizedBy?: string | undefined;
  finalizedAt?: string | undefined;
}

/**
 * IELTS Writing Rubric Assessment
 */
export interface RubricAssessment {
  // Task Response / Task Achievement
  taskResponseBand: number;
  taskResponseNotes?: string | undefined;
  
  // Coherence and Cohesion
  coherenceBand: number;
  coherenceNotes?: string | undefined;
  
  // Lexical Resource
  lexicalBand: number;
  lexicalNotes?: string | undefined;
  
  // Grammatical Range and Accuracy
  grammarBand: number;
  grammarNotes?: string | undefined;
  
  // Overall
  overallBand: number;
  wordCount: number;
  gradingStatus: SectionGradingStatus;
  
  // Internal grader notes (not visible to student)
  internalNotes?: string | undefined;
}

/**
 * Writing annotation for inline commenting
 */
export interface WritingAnnotation {
  id: string;
  taskId: string;
  type: AnnotationType;
  
  // Text anchor (for inline comments)
  startOffset: number;
  endOffset: number;
  selectedText: string;
  
  // Comment content
  comment: string;
  visibility: CommentVisibility;
  
  // Color (for highlights, drawings)
  color?: string | undefined;
  
  // Metadata
  createdBy: string;
  createdAt: string;
  updatedAt?: string | undefined;
}

/**
 * Review Draft - Draft state of grading for a student
 */
export interface ReviewDraft {
  id: string;
  submissionId: string;
  studentId: string;
  teacherId: string;
  
  // Release workflow status
  releaseStatus: ReleaseStatus;
  
  // Draft rubric assessments per section
  sectionDrafts: {
    listening?: RubricAssessment | undefined;
    reading?: RubricAssessment | undefined;
    writing?: {
      task1?: RubricAssessment | undefined;
      task2?: RubricAssessment | undefined;
    } | undefined;
    speaking?: RubricAssessment | undefined;
  };
  
  // Draft annotations (text comments)
  annotations: WritingAnnotation[];
  
  // Draft drawings (freehand, shapes)
  drawings: DrawingAnnotation[];
  
  // Draft overall feedback
  overallFeedback?: string | undefined;
  studentVisibleNotes?: string | undefined;
  internalNotes?: string | undefined;
  
  // Teacher summary for result
  teacherSummary?: {
    strengths: string[];
    improvementPriorities: string[];
    recommendedPractice: string[];
  } | undefined;
  
  // Grading checklist
  checklist: GradingChecklist;
  
  // State
  hasUnsavedChanges: boolean;
  lastAutoSaveAt?: string | undefined;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Review Event - Audit trail for grading actions
 */
export type ReviewAction =
  | 'review_started'
  | 'review_assigned'
  | 'draft_saved'
  | 'comment_added'
  | 'comment_updated'
  | 'rubric_updated'
  | 'review_finalized'
  | 'review_reopened'
  | 'score_override'
  | 'feedback_updated';

export interface ReviewEvent {
  id: string;
  submissionId: string;
  teacherId: string;
  teacherName: string;
  action: ReviewAction;
  
  // Context
  section?: 'listening' | 'reading' | 'writing' | 'speaking' | undefined;
  taskId?: string | undefined;
  annotationId?: string | undefined;
  questionId?: string | undefined;
  
  // State changes
  fromStatus?: SectionGradingStatus | OverallGradingStatus | undefined;
  toStatus?: SectionGradingStatus | OverallGradingStatus | undefined;
  
  // Payload
  payload?: Record<string, unknown> | undefined;
  
  // Metadata
  timestamp: string;
}

/**
 * Grading Queue Filters
 */
export interface GradingQueueFilters {
  assignedToMe?: boolean | undefined;
  status?: OverallGradingStatus[] | undefined;
  cohort?: string[] | undefined;
  exam?: string[] | undefined;
  isFlagged?: boolean | undefined;
  isOverdue?: boolean | undefined;
  searchQuery?: string | undefined;
}

/**
 * Session detail filters
 */
export interface SessionDetailFilters {
  status?: OverallGradingStatus[] | undefined;
  assignedTeacher?: string | undefined;
  isFlagged?: boolean | undefined;
  isOverdue?: boolean | undefined;
  searchQuery?: string | undefined;
}

/**
 * Student Result - The final result package released to student
 */
export interface StudentResult {
  id: string;
  submissionId: string;
  studentId: string;
  studentName: string;
  
  // Release status
  releaseStatus: ReleaseStatus;
  releasedAt?: string | undefined;
  releasedBy?: string | undefined;
  scheduledReleaseDate?: string | undefined;
  
  // Overall scores
  overallBand: number;
  sectionBands: {
    listening: number;
    reading: number;
    writing: number;
    speaking: number;
  };
  
  // Section breakdowns
  listeningResult?: ListeningResult | undefined;
  readingResult?: ReadingResult | undefined;
  writingResults: {
    task1?: WritingResult | undefined;
    task2?: WritingResult | undefined;
  };
  speakingResult?: SpeakingResult | undefined;
  
  // Teacher summary
  teacherSummary: {
    strengths: string[];
    improvementPriorities: string[];
    recommendedPractice: string[];
  };
  
  // Versioning for revised results
  version: number;
  previousVersionId?: string | undefined;
  revisionReason?: string | undefined;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Listening section result
 */
export interface ListeningResult {
  rawScore: number;
  maxScore: number;
  band: number;
  bandExplanation: string;
  questionBreakdown: ObjectiveQuestionResult[];
}

/**
 * Reading section result
 */
export interface ReadingResult {
  rawScore: number;
  maxScore: number;
  band: number;
  bandExplanation: string;
  questionBreakdown: ObjectiveQuestionResult[];
}

/**
 * Writing task result with annotations
 */
export interface WritingResult {
  taskId: string;
  taskLabel: string;
  prompt: string;
  studentText: string;
  wordCount: number;
  
  // Rubric scores
  rubricScores: {
    taskResponse: number;
    coherence: number;
    lexical: number;
    grammar: number;
  };
  
  // Annotations (student-visible only)
  annotations: WritingAnnotation[];
  drawings: DrawingAnnotation[];
  
  // Feedback
  criterionFeedback: {
    taskResponse?: string | undefined;
    coherence?: string | undefined;
    lexical?: string | undefined;
    grammar?: string | undefined;
  };
}

/**
 * Speaking result
 */
export interface SpeakingResult {
  overallBand: number;
  rubricScores: {
    fluency: number;
    lexical: number;
    grammar: number;
    pronunciation: number;
  };
  criterionFeedback: {
    fluency?: string | undefined;
    lexical?: string | undefined;
    grammar?: string | undefined;
    pronunciation?: string | undefined;
  };
  timestampComments: TimestampComment[];
}

/**
 * Timestamp comment for speaking
 */
export interface TimestampComment {
  timestamp: number; // in seconds
  comment: string;
  visibility: CommentVisibility;
}

/**
 * Release workflow action
 */
export type ReleaseAction = 
  | 'mark_grading_complete'
  | 'mark_ready_to_release'
  | 'release_now'
  | 'schedule_release'
  | 'reopen_result'
  | 'revise_result';

/**
 * Release event for audit trail
 */
export interface ReleaseEvent {
  id: string;
  resultId: string;
  action: ReleaseAction;
  actor: string;
  actorName: string;
  timestamp: string;
  fromStatus?: ReleaseStatus | undefined;
  toStatus?: ReleaseStatus | undefined;
  payload?: Record<string, unknown> | undefined;
}

/**
 * Grading checklist for completion tracking
 */
export interface GradingChecklist {
  listeningReviewed: boolean;
  readingReviewed: boolean;
  writingTask1Reviewed: boolean;
  writingTask2Reviewed: boolean;
  speakingReviewed: boolean;
  overallFeedbackWritten: boolean;
  rubricComplete: boolean;
  annotationsComplete: boolean;
}

/**
 * Comment bank for reusable grading comments
 */
export interface CommentBankItem {
  id: string;
  category: 'grammar' | 'vocabulary' | 'coherence' | 'task_response' | 'general';
  label: string;
  text: string;
  isStudentVisible: boolean;
  createdBy: string;
  createdAt: string;
  usageCount: number;
}

/**
 * Annotation tool state
 */
export interface AnnotationToolState {
  activeTool: 'select' | 'highlight' | 'underline' | 'strike_through' | 'freehand' | 'arrow' | 'circle' | 'comment';
  color: string;
  strokeWidth: number;
  visibility: CommentVisibility;
}
