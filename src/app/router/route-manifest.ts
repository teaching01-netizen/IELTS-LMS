/**
 * Route Manifest
 *
 * This manifest reflects the real active route tree. Student pre-check/lobby/exam/complete
 * are internal runtime phases inside `/student/:scheduleId/:studentId?`, not distinct child routes.
 */

export const routeManifest = {
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
    },
  },
  builder: {
    path: '/builder',
    children: {
      config: '/builder/:examId',
      builder: '/builder/:examId/builder',
      review: '/builder/:examId/review',
      preview: '/builder/:examId/preview',
    },
  },
  proctor: {
    path: '/proctor',
    children: {
      root: '/proctor',
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
} as const;

export type RoutePath = typeof routeManifest;
