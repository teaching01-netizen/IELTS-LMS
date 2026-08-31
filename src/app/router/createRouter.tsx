import { lazy, Suspense } from "react";
import { Navigate, createBrowserRouter, useParams } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import { AppLoadingSkeleton } from "../../components/ui/AppLoadingSkeleton";
import { ErrorSurface } from "../../components/ui/ErrorSurface";
import { LoadingSurface } from "../../components/ui/LoadingSurface";
import { ActivateAccountPage } from "../../features/auth/ActivateAccountPage";
import { LoginPage } from "../../features/auth/LoginPage";
import { PasswordResetCompletePage } from "../../features/auth/PasswordResetCompletePage";
import { PasswordResetRequestPage } from "../../features/auth/PasswordResetRequestPage";
import { RequireAuth } from "../../features/auth/RequireAuth";
import { resolveRoleLandingPath, useAuthSession } from "../../features/auth/authSession";

const AdminRoot = lazy(() =>
  import("../../features/admin/routes/AdminRoot").then((module) => ({
    default: module.AdminRoot,
  }))
);
const AdminExamsRoute = lazy(() =>
  import("../../features/exam-authoring/routes/ExamsRoute").then((module) => ({
    default: module.ExamsRoute,
  }))
);
const AdminLibraryRoute = lazy(() =>
  import("../../features/content-library/routes/LibraryRoute").then((module) => ({
    default: module.LibraryRoute,
  }))
);
const AdminSchedulingRoute = lazy(() =>
  import("../../features/scheduling/routes/SchedulingRoute").then((module) => ({
    default: module.SchedulingRoute,
  }))
);
const AdminGradingRoute = lazy(() =>
  import("../../features/grading/routes/GradingRoute").then((module) => ({
    default: module.GradingRoute,
  }))
);
const AdminResultsRoute = lazy(() =>
  import("../../features/results/routes/ResultsRoute").then((module) => ({
    default: module.ResultsRoute,
  }))
);
const AdminSettingsRoute = lazy(() =>
  import("../../features/preferences/routes/SettingsRoute").then((module) => ({
    default: module.SettingsRoute,
  }))
);
const AdminAnswerHistoryRoute = lazy(() =>
  import("../../features/answer-history/routes/AnswerHistoryRoute").then((module) => ({
    default: module.AdminAnswerHistoryRoute,
  }))
);
const BuilderRoot = lazy(() =>
  import("../../features/builder/routes/BuilderRoot").then((module) => ({
    default: module.BuilderRoot,
  }))
);
const ProviderBuilderRoute = lazy(() =>
  import("../../features/exam-authoring/routes/ProviderBuilderRoute").then((module) => ({
    default: module.ProviderBuilderRoute,
  }))
);
const ProviderReviewRoute = lazy(() =>
  import("../../features/exam-authoring/routes/ProviderReviewRoute").then((module) => ({
    default: module.ProviderReviewRoute,
  }))
);
const ProviderPreviewRoute = lazy(() =>
  import("../../features/exam-authoring/routes/ProviderPreviewRoute").then((module) => ({
    default: module.ProviderPreviewRoute,
  }))
);
const ExamAnswerKeyRoute = lazy(() =>
  import("../../features/builder/routes/ExamAnswerKeyRoute").then((module) => ({
    default: module.ExamAnswerKeyRoute,
  }))
);
const ProctorRoot = lazy(() =>
  import("../../features/proctoring/routes/ProctorRoot").then((module) => ({
    default: module.ProctorRoot,
  }))
);
const ProctorAnswerHistoryRoute = lazy(() =>
  import("../../features/answer-history/routes/AnswerHistoryRoute").then((module) => ({
    default: module.ProctorAnswerHistoryRoute,
  }))
);
const StudentSessionRoute = lazy(() =>
  import("../../features/student-delivery/routes/StudentSessionRoute").then((module) => ({
    default: module.StudentSessionRoute,
  }))
);
const StudentRegistrationRoute = lazy(() =>
  import("../../features/student-delivery/routes/StudentRegistrationRoute").then((module) => ({
    default: module.StudentRegistrationRoute,
  }))
);
const StudentAccessLinkEntryRoute = lazy(() =>
  import("../../features/student-delivery/routes/StudentAccessLinkEntryRoute").then((module) => ({
    default: module.StudentAccessLinkEntryRoute,
  }))
);

const SatRoot = lazy(() =>
  import("../../products/sat/SatRoot").then((module) => ({ default: module.SatRoot }))
);
const SatExamLibraryRoute = lazy(() =>
  import("../../products/sat/routes/SatExamLibraryRoute").then((module) => ({ default: module.SatExamLibraryRoute }))
);
const SatSessionsRoute = lazy(() =>
  import("../../products/sat/routes/SatSessionsRoute").then((module) => ({ default: module.SatSessionsRoute }))
);
const SatSessionRoomRoute = lazy(() =>
  import("../../products/sat/routes/SatSessionRoomRoute").then((module) => ({ default: module.SatSessionRoomRoute }))
);
const SatResultsRoute = lazy(() =>
  import("../../products/sat/routes/SatResultsRoute").then((module) => ({ default: module.SatResultsRoute }))
);
const SatResultDetailRoute = lazy(() =>
  import("../../products/sat/routes/SatResultDetailRoute").then((module) => ({ default: module.SatResultDetailRoute }))
);
const SatAccessRoute = lazy(() =>
  import("../../products/sat/routes/SatAccessRoute").then((module) => ({ default: module.SatAccessRoute }))
);

const DevHighlightSelectionRoute = lazy(() =>
  import("./dev/HighlightSelectionDebugRoute").then((module) => ({
    default: module.HighlightSelectionDebugRoute,
  }))
);

const DevSatAccessibilityRoute = lazy(() =>
  import("./dev/SatAccessibilityDebugRoute").then((module) => ({
    default: module.SatAccessibilityDebugRoute,
  }))
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
  if (status === "loading") {
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

function SatIndexRedirect() {
  const { session, status } = useAuthSession();
  if (status === "loading") return <LoadingSurface label="Loading Session..." />;
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.role === "proctor") return <Navigate to="/sat/sessions" replace />;
  if (session.user.role === "grader") return <Navigate to="/sat/results" replace />;
  return <Navigate to="/sat/exams" replace />;
}

function withAuth(
  element: React.ReactNode,
  allowedRoles?: Array<"admin" | "builder" | "proctor" | "grader" | "student">
) {
  return <RequireAuth allowedRoles={allowedRoles}>{element}</RequireAuth>;
}

const baseRoutes = [
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/activate",
    element: <ActivateAccountPage />,
  },
  {
    path: "/password/reset",
    element: <PasswordResetRequestPage />,
  },
  {
    path: "/password/reset/complete",
    element: <PasswordResetCompletePage />,
  },
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <LoginPage />,
      },
      {
        path: "admin",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <AdminRoot />
          </Suspense>,
          ["admin", "builder", "grader"]
        ),
        children: [
          {
            index: true,
            element: <AdminIndexRedirect />,
          },
          {
            path: "exams",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminExamsRoute />
              </Suspense>,
              ["admin", "builder"]
            ),
          },
          {
            path: "library",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminLibraryRoute />
              </Suspense>,
              ["admin", "builder"]
            ),
          },
          {
            path: "scheduling",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminSchedulingRoute />
              </Suspense>,
              ["admin", "builder", "grader"]
            ),
          },
          {
            path: "grading",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminGradingRoute />
              </Suspense>,
              ["admin", "grader"]
            ),
          },
          {
            path: "results",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminResultsRoute />
              </Suspense>,
              ["admin", "grader"]
            ),
          },
          {
            path: "settings",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminSettingsRoute />
              </Suspense>,
              ["admin", "builder"]
            ),
          },
          {
            path: "answer-history/:submissionId",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminAnswerHistoryRoute />
              </Suspense>,
              ["admin", "grader"]
            ),
          },
        ],
      },
      {
        path: "sat",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <SatRoot />
          </Suspense>,
          ["admin", "builder", "proctor", "grader"]
        ),
        children: [
          { index: true, element: <SatIndexRedirect /> },
          {
            path: "exams",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}><SatExamLibraryRoute /></Suspense>,
              ["admin", "builder"]
            ),
          },
          {
            path: "sessions",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}><SatSessionsRoute /></Suspense>,
              ["admin", "proctor"]
            ),
          },
          {
            path: "results",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}><SatResultsRoute /></Suspense>,
              ["admin", "grader", "proctor"]
            ),
          },
          {
            path: "results/:resultId",
            element: withAuth(
              <Suspense fallback={<RouteLoadingFallback />}><SatResultDetailRoute /></Suspense>,
              ["admin", "grader", "proctor"]
            ),
          },
        ],
      },
      {
        path: "sat/exams/:examId",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}><ProviderBuilderRoute /></Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "sat/exams/:examId/release",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}><ProviderReviewRoute /></Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "sat/exams/:examId/preview",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}><ProviderPreviewRoute /></Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "sat/exams/:examId/access",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}><SatAccessRoute /></Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "sat/sessions/:scheduleId",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}><SatSessionRoomRoute /></Suspense>,
          ["admin", "proctor"]
        ),
      },
      {
        path: "builder/:examId",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProviderBuilderRoute />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "builder/:examId/builder",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <BuilderRoot />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "builder/:examId/review",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProviderReviewRoute />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "builder/:examId/preview",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProviderPreviewRoute />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "builder/:examId/answer-key",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ExamAnswerKeyRoute />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "proctor",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProctorRoot />
          </Suspense>,
          ["admin", "proctor"]
        ),
      },
      {
        path: "proctor/answer-history/:attemptId",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProctorAnswerHistoryRoute />
          </Suspense>,
          ["admin", "proctor"]
        ),
      },
      {
        path: "join/:accessLinkId",
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentAccessLinkEntryRoute />
          </Suspense>
        ),
      },
      {
        path: "student/:scheduleId",
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentRegistrationRoute />
          </Suspense>
        ),
      },
      {
        path: "student/:scheduleId/register",
        element: <StudentRegisterRedirect />,
      },
      {
        path: "student/:scheduleId/:studentId",
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentSessionRoute />
          </Suspense>,
          ["admin", "builder", "proctor", "grader", "student"]
        ),
      },
      {
        path: "*",
        element: <NotFoundRoute />,
      },
    ],
  },
];

const devRoutes = import.meta.env.DEV
  ? [
      {
        path: "/__dev/highlight-selection",
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <DevHighlightSelectionRoute />
          </Suspense>
        ),
      },
      {
        path: "/__dev/sat-accessibility",
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <DevSatAccessibilityRoute />
          </Suspense>
        ),
      },
    ]
  : [];

export const appRoutes = [...devRoutes, ...baseRoutes];

export const router = createBrowserRouter(appRoutes);
