/**
 * Route Manifest
 *
 * This manifest reflects the real active route tree. Student pre-check/lobby/exam/complete
 * are internal runtime phases inside `/student/:scheduleId/:studentId?`, not distinct child routes.
 */

export const routeManifest = {
  auth: {
    path: '/login',
    children: {
      login: '/login',
      activate: '/activate',
      passwordReset: '/password/reset',
      passwordResetComplete: '/password/reset/complete',
    },
  },
  admin: {
    path: '/admin',
    children: {
      root: '/admin',
      exams: '/admin/exams',
      library: '/admin/library',
      scheduling: '/admin/scheduling',
      grading: '/admin/grading',
      results: '/admin/results',
      settings: '/admin/settings',
      answerHistory: '/admin/answer-history/:submissionId',
    },
  },
  sat: {
    path: '/sat',
    children: {
      root: '/sat',
      exams: '/sat/exams',
      sessions: '/sat/sessions',
      results: '/sat/results',
      resultDetail: '/sat/results/:resultId',
      attemptAnswers: '/sat/results/attempts/:attemptId',
      examDetail: '/sat/exams/:examId',
      examRelease: '/sat/exams/:examId/release',
      examPreview: '/sat/exams/:examId/preview',
      examAccess: '/sat/exams/:examId/access',
      sessionRoom: '/sat/sessions/:scheduleId',
    },
  },
  builder: {
    path: '/builder',
    children: {
      config: '/builder/:examId',
      builder: '/builder/:examId/builder',
      review: '/builder/:examId/review',
      preview: '/builder/:examId/preview',
      answerKey: '/builder/:examId/answer-key',
    },
  },
  proctor: {
    path: '/proctor',
    children: {
      root: '/proctor',
      answerHistory: '/proctor/answer-history/:attemptId',
    },
  },
  student: {
    path: '/student',
    children: {
      entry: '/student/:scheduleId',
      register: '/student/:scheduleId/register',
      session: '/student/:scheduleId/:studentId',
    },
  },
  join: {
    path: '/join',
    children: {
      entry: '/join/:accessLinkId',
    },
  },
} as const;

export type RoutePath = typeof routeManifest;
