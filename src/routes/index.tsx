import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { ErrorSurface } from '../components/ui/ErrorSurface';
import { LoginPage } from '../features/auth/LoginPage';

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

function RouteLoadingFallback() {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="h-16 border-b border-gray-200 bg-white px-6">
        <div className="h-8 w-32 bg-gray-200 rounded animate-pulse"></div>
      </div>
      <div className="flex-1 p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="h-8 w-64 bg-gray-200 rounded animate-pulse"></div>
          <div className="flex gap-4 h-10">
            <div className="h-10 w-48 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
          </div>
          <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
            <div className="h-12 border-b border-gray-100 bg-gray-50">
              <div className="h-4 w-full mx-4 mt-4 bg-gray-200 rounded animate-pulse"></div>
            </div>
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, index) => (
                <div
                  key={index}
                  className="h-12 bg-gray-100 rounded animate-pulse"
                  style={{ animationDelay: `${index * 0.1}s` }}
                ></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotFoundRoute() {
  return (
    <ErrorSurface
      title="Route Not Found"
      description="This path is not part of the active route tree."
    />
  );
}

export const appRoutes = [
  {
    path: '/login',
    element: <LoginPage />,
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
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <AdminRoot />
          </Suspense>
        ),
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminExamsRoute />
              </Suspense>
            ),
          },
          {
            path: 'exams',
            element: (
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminExamsRoute />
              </Suspense>
            ),
          },
          {
            path: 'library',
            element: (
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminLibraryRoute />
              </Suspense>
            ),
          },
          {
            path: 'scheduling',
            element: (
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminSchedulingRoute />
              </Suspense>
            ),
          },
          {
            path: 'grading',
            element: (
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminGradingRoute />
              </Suspense>
            ),
          },
          {
            path: 'results',
            element: (
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminResultsRoute />
              </Suspense>
            ),
          },
          {
            path: 'settings',
            element: (
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminSettingsRoute />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: 'builder/:examId',
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <ExamConfigRoute />
          </Suspense>
        ),
      },
      {
        path: 'builder/:examId/builder',
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <BuilderRoot />
          </Suspense>
        ),
      },
      {
        path: 'builder/:examId/review',
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <ExamReviewRoute />
          </Suspense>
        ),
      },
      {
        path: 'proctor',
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProctorRoot />
          </Suspense>
        ),
      },
      {
        path: 'student/:scheduleId',
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentSessionRoute />
          </Suspense>
        ),
      },
      {
        path: '*',
        element: <NotFoundRoute />,
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
