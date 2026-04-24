import { lazy, Suspense } from 'react';
import { Navigate, createBrowserRouter, useParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { AppLoadingSkeleton } from '../components/ui/AppLoadingSkeleton';
import { ErrorSurface } from '../components/ui/ErrorSurface';
import { LoadingSurface } from '../components/ui/LoadingSurface';
import { ActivateAccountPage } from '../features/auth/ActivateAccountPage';
import { LoginPage } from '../features/auth/LoginPage';
import { PasswordResetCompletePage } from '../features/auth/PasswordResetCompletePage';
import { PasswordResetRequestPage } from '../features/auth/PasswordResetRequestPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { resolveRoleLandingPath, useAuthSession } from '../features/auth/authSession';

const AdminRoot = lazy(() =>
  import('../features/admin/routes/AdminRoot').then((module) => ({
    default: module.AdminRoot,
  })),
);
const AdminExamsRoute = lazy(() =>
  import('../features/admin/routes/ExamsRoute').then((module) => ({
    default: module.ExamsRoute,
  })),
);
const AdminLibraryRoute = lazy(() =>
  import('../features/admin/routes/LibraryRoute').then((module) => ({
    default: module.LibraryRoute,
  })),
);
const AdminSchedulingRoute = lazy(() =>
  import('../features/admin/routes/SchedulingRoute').then((module) => ({
    default: module.SchedulingRoute,
  })),
);
const AdminGradingRoute = lazy(() =>
  import('../features/admin/routes/GradingRoute').then((module) => ({
    default: module.GradingRoute,
  })),
);
const AdminResultsRoute = lazy(() =>
  import('../features/admin/routes/ResultsRoute').then((module) => ({
    default: module.ResultsRoute,
  })),
);
const AdminSettingsRoute = lazy(() =>
  import('../features/admin/routes/SettingsRoute').then((module) => ({
    default: module.SettingsRoute,
  })),
);
const BuilderRoot = lazy(() =>
  import('../features/builder/routes/BuilderRoot').then((module) => ({
    default: module.BuilderRoot,
  })),
);
const ExamConfigRoute = lazy(() =>
  import('../features/builder/routes/ExamConfigRoute').then((module) => ({
    default: module.ExamConfigRoute,
  })),
);
const ExamReviewRoute = lazy(() =>
  import('../features/builder/routes/ExamReviewRoute').then((module) => ({
    default: module.ExamReviewRoute,
  })),
);
const ExamPreviewRoute = lazy(() =>
  import('../features/builder/routes/ExamPreviewRoute').then((module) => ({
    default: module.ExamPreviewRoute,
  })),
);
const ProctorRoot = lazy(() =>
  import('../features/proctor/routes/ProctorRoot').then((module) => ({
    default: module.ProctorRoot,
  })),
);
const StudentSessionRoute = lazy(() =>
  import('../features/student/routes/StudentSessionRoute').then((module) => ({
    default: module.StudentSessionRoute,
  })),
);
const StudentRegistrationRoute = lazy(() =>
  import('../features/student/routes/StudentRegistrationRoute').then((module) => ({
    default: module.StudentRegistrationRoute,
  })),
);

function RouteLoadingFallback() {
  return <AppLoadingSkeleton />;
}

function NotFoundRoute() {
  return (
    <ErrorSurface
      title="Route Not Found"
      description="This path is not part of the active route tree."
    />
  );
}

function AdminIndexRedirect() {
  const { session, status } = useAuthSession();
  if (status === 'loading') {
    return <LoadingSurface label="Loading Session..." />;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={resolveRoleLandingPath(session.user.role)} replace />;
}

function StudentRegisterRedirect() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  return <Navigate to={`/student/${scheduleId}`} replace />;
}

function withAuth(element: React.ReactNode, allowedRoles?: Array<'admin' | 'builder' | 'proctor' | 'grader' | 'student'>) {
  return <RequireAuth allowedRoles={allowedRoles}>{element}</RequireAuth>;
}

export const appRoutes = [
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/activate',
    element: <ActivateAccountPage />,
  },
  {
    path: '/password/reset',
    element: <PasswordResetRequestPage />,
  },
  {
    path: '/password/reset/complete',
    element: <PasswordResetCompletePage />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <LoginPage />,
      },
      {
        path: 'admin',
        element: withAuth((
          <Suspense fallback={<RouteLoadingFallback />}>
            <AdminRoot />
          </Suspense>
        ), ['admin', 'builder', 'grader']),
        children: [
          {
            index: true,
            element: <AdminIndexRedirect />,
          },
          {
            path: 'exams',
            element: withAuth((
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminExamsRoute />
              </Suspense>
            ), ['admin', 'builder']),
          },
          {
            path: 'library',
            element: withAuth((
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminLibraryRoute />
              </Suspense>
            ), ['admin', 'builder']),
          },
          {
            path: 'scheduling',
            element: withAuth((
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminSchedulingRoute />
              </Suspense>
            ), ['admin', 'builder', 'grader']),
          },
          {
            path: 'grading',
            element: withAuth((
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminGradingRoute />
              </Suspense>
            ), ['admin', 'grader']),
          },
          {
            path: 'results',
            element: withAuth((
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminResultsRoute />
              </Suspense>
            ), ['admin', 'grader']),
          },
          {
            path: 'settings',
            element: withAuth((
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminSettingsRoute />
              </Suspense>
            ), ['admin', 'builder']),
          },
        ],
      },
      {
        path: 'builder/:examId',
        element: withAuth((
          <Suspense fallback={<RouteLoadingFallback />}>
            <ExamConfigRoute />
          </Suspense>
        ), ['admin', 'builder']),
      },
      {
        path: 'builder/:examId/builder',
        element: withAuth((
          <Suspense fallback={<RouteLoadingFallback />}>
            <BuilderRoot />
          </Suspense>
        ), ['admin', 'builder']),
      },
      {
        path: 'builder/:examId/review',
        element: withAuth((
          <Suspense fallback={<RouteLoadingFallback />}>
            <ExamReviewRoute />
          </Suspense>
        ), ['admin', 'builder']),
      },
      {
        path: 'builder/:examId/preview',
        element: withAuth((
          <Suspense fallback={<RouteLoadingFallback />}>
            <ExamPreviewRoute />
          </Suspense>
        ), ['admin', 'builder']),
      },
      {
        path: 'proctor',
        element: withAuth((
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProctorRoot />
          </Suspense>
        ), ['admin', 'proctor']),
      },
      {
        path: 'student/:scheduleId',
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentRegistrationRoute />
          </Suspense>
        ),
      },
      {
        path: 'student/:scheduleId/register',
        element: <StudentRegisterRedirect />,
      },
      {
        path: 'student/:scheduleId/:studentId',
        element: withAuth((
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentSessionRoute />
          </Suspense>
        ), ['admin', 'builder', 'proctor', 'grader', 'student']),
      },
      {
        path: '*',
        element: <NotFoundRoute />,
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
