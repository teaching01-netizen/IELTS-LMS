/**
 * Public entry point for the ONE exam-screen visibility rule.
 *
 * Both delivery branches consume this module: the IELTS/ACT proctoring
 * provider (`components/student/providers`) and the SAT delivery branch
 * (`features/student-delivery`). `api/` is the only feature surface another
 * feature may import, which is exactly why the rule lives behind this barrel —
 * a second copy of the copy, or a second `visibilitychange` listener, is what
 * the architecture guards exist to prevent.
 *
 * The rule module it re-exports is pure (no React, no browser globals), so it
 * is also safe for a domain module like `satCopy` to reference the wording.
 */
export {
  EXAM_VISIBILITY_SOURCE,
  EXAM_VISIBILITY_VIOLATION_TYPE,
  EXAM_VISIBILITY_WARNING_ACKNOWLEDGE,
  EXAM_VISIBILITY_WARNING_MESSAGE,
  EXAM_VISIBILITY_WARNING_TITLE,
  createExamVisibilityIntegrityState,
  examVisibilityAuditDetail,
  reduceExamVisibilityIntegrity,
} from '../application/exam-session/examVisibilityIntegrity';
export type {
  ExamVisibilityExcursion,
  ExamVisibilityIntegrityResult,
  ExamVisibilityIntegrityState,
  ExamVisibilityTransition,
} from '../application/exam-session/examVisibilityIntegrity';
