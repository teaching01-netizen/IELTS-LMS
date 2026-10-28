import { lazy, Suspense, useEffect } from "react";
import { Navigate, createBrowserRouter, useNavigate, useNavigation, useSearchParams, useLocation } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import { AppLoadingSkeleton } from "../../components/ui/AppLoadingSkeleton";
import { SatListSkeleton } from "../../products/sat/ui/SatPage";
import { ErrorSurface } from "../../components/ui/ErrorSurface";
import { LoadingSurface } from "../../components/ui/LoadingSurface";
import { ActivateAccountPage } from "../../features/auth/ActivateAccountPage";
import { LoginPage } from "../../features/auth/LoginPage";
import { PasswordResetCompletePage } from "../../features/auth/PasswordResetCompletePage";
import { PasswordResetRequestPage } from "../../features/auth/PasswordResetRequestPage";
import { RequireAuth } from "../../features/auth/RequireAuth";
import { resolvePostLoginPath, useAuthSession } from "../../features/auth/authSession";
import { RouteErrorBoundary } from "../../routes/RouteErrorBoundary";

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
const StudentDeviceRecoveryRoute = lazy(() => import('../../features/student/routes/StudentDeviceRecoveryRoute').then(module => ({ default: module.StudentDeviceRecoveryRoute })));

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
const SatResultsRoute = lazy(() =>
  import("../../products/sat/routes/SatResultsRoute").then((module) => ({ default: module.SatResultsRoute }))
);
const SatFormResponsesRoute = lazy(() =>
  import("../../products/sat/routes/SatFormResponsesRoute").then((module) => ({ default: module.SatFormResponsesRoute }))
);
const SatResultDetailRoute = lazy(() =>
  import("../../products/sat/routes/SatResultDetailRoute").then((module) => ({ default: module.SatResultDetailRoute }))
);
const SatAttemptAnswersRoute = lazy(() =>
  import("../../products/sat/routes/SatAttemptAnswersRoute").then((module) => ({ default: module.SatAttemptAnswersRoute }))
);
const SatScoreConversionRoute = lazy(() =>
  import("../../products/sat/routes/SatScoreConversionRoute").then((module) => ({ default: module.SatScoreConversionRoute }))
);
const SatAnsweredPrintRoute = lazy(() =>
  import("../../features/student-delivery/routes/SatAnsweredPrintRoute").then((module) => ({ default: module.SatAnsweredPrintRoute }))
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

const DevSatFormsRoute = lazy(() =>
  import("./dev/SatFormsDebugRoute").then((module) => ({
    default: module.SatFormsDebugRoute,
  }))
);
const DevSatAuthoringRoute = lazy(() =>
  import("./dev/SatAuthoringDebugRoute").then((module) => ({
    default: module.SatAuthoringDebugRoute,
  }))
);

function RouteLoadingFallback() {
  return <AppLoadingSkeleton />;
}

/**
 * SAT workspace chunk fallback: staff skin (NOT the admin grey skeleton).
 * Used ONLY on /sat/* lazy boundaries so code-split loads never flash
 * IELTS chrome inside the SAT workspace. Everywhere else keeps
 * RouteLoadingFallback. Single live region via SatListSkeleton.
 */
function SatRouteLoadingFallback() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-14 pt-7 sm:px-6 md:pt-10 lg:px-10">
      <div className="flex min-h-[60vh] flex-col justify-center">
        <SatListSkeleton rows={5} label="Loading SAT workspace" />
      </div>
    </div>
  );
}

function NotFoundRoute() {
  const navigate = useNavigate();
  return (
    <ErrorSurface
      title="Route Not Found"
      description="This path is not part of the active route tree."
      actionLabel="Home"
      onAction={() => navigate("/")}
      secondaryActionLabel="Login"
      secondaryOnAction={() => navigate("/login")}
    />
  );
}

function AdminIndexRedirect() {
  const { session, status } = useAuthSession();
  const [searchParams] = useSearchParams();
  if (status === "loading") {
    return <LoadingSurface label="Loading Session..." />;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Navigate
      to={resolvePostLoginPath(session.user.role, searchParams.get("next"))}
      replace
    />
  );
}

function SatIndexRedirect() {
  const { session, status } = useAuthSession();
  const [searchParams] = useSearchParams();
  if (status === "loading") return <LoadingSurface label="Loading Session..." />;
  if (!session) return <Navigate to="/login" replace />;
  // S3-M3: preserve ?next= when the role allows it; otherwise keep the
  // existing SAT workspace defaults (not the generic role landing path).
  const next = searchParams.get("next");
  const fallback =
    session.user.role === "proctor"
      ? "/sat/sessions"
      : session.user.role === "grader"
        ? "/sat/results"
        : "/sat/exams";
  const resolved = resolvePostLoginPath(session.user.role, next);
  return <Navigate to={next && resolved === next ? next : fallback} replace />;
}

function withAuth(
  element: React.ReactNode,
  allowedRoles?: Array<"admin" | "builder" | "proctor" | "grader" | "student">
) {
  return <RequireAuth allowedRoles={allowedRoles}>{element}</RequireAuth>;
}

const loadExamSettingsRoute = () => import("../../features/exam-authoring/routes/ExamSettingsRoute");

/** Data-route chunks load before the workspace changes, preserving context. */
function SatWorkspaceRoot() {
  const navigation = useNavigation();
  const { pathname } = useLocation();
  useEffect(() => {
    if (/^\/sat\/exams\/[^/]+\/?$/.test(pathname)) void loadExamSettingsRoute().catch(() => {});
  }, [pathname]);
  const createdRoom = navigation.location?.state?.satCreatedRoom;
  const openingCreatedRoom = typeof createdRoom === "string"
    && navigation.location?.pathname === `/sat/sessions/${encodeURIComponent(createdRoom)}`;
  return (
    <>
      <SatRoot />
      {navigation.state !== "idle" ? (
        <p role="status" className="sat-product sat-staff-root sat-navigation-pending fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-surface)] px-4 py-2 text-[14px] text-[var(--sat-staff-text-secondary)] shadow-sm">
          {openingCreatedRoom ? "Room created. Opening your room…" : "Opening workspace…"}
        </p>
      ) : null}
    </>
  );
}

const baseRoutes = [
  {
    path: "/login",
    element: <LoginPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/activate",
    element: <ActivateAccountPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/password/reset",
    element: <PasswordResetRequestPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/password/reset/complete",
    element: <PasswordResetCompletePage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // Printed by the PDF renderer only; the payload lives on its loopback origin.
    path: "/print/sat-answered",
    element: (
      <Suspense fallback={null}>
        <SatAnsweredPrintRoute />
      </Suspense>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        errorElement: <RouteErrorBoundary />,
        element: <LoginPage />,
      },
      {
        path: "admin",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <AdminRoot />
          </Suspense>,
          ["admin", "builder", "grader"]
        ),
        children: [
          {
            index: true,
            errorElement: <RouteErrorBoundary />,
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
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<SatRouteLoadingFallback />}>
            <SatWorkspaceRoot />
          </Suspense>,
          ["admin", "builder", "proctor", "grader"]
        ),
        children: [
          { index: true, errorElement: <RouteErrorBoundary />, element: <SatIndexRedirect /> },
          {
            path: "exams",
            element: withAuth(
              <Suspense fallback={<SatRouteLoadingFallback />}><SatExamLibraryRoute /></Suspense>,
              ["admin", "builder"]
            ),
          },
          {
            path: "sessions",
            element: withAuth(
              <Suspense fallback={<SatRouteLoadingFallback />}><SatSessionsRoute /></Suspense>,
              ["admin", "proctor"]
            ),
          },
          {
            path: "results",
            element: withAuth(
              <Suspense fallback={<SatRouteLoadingFallback />}><SatResultsRoute /></Suspense>,
              ["admin", "grader", "proctor"]
            ),
          },
          {
            path: "forms",
            element: withAuth(
              <Suspense fallback={<SatRouteLoadingFallback />}><SatFormResponsesRoute /></Suspense>,
              ["admin", "proctor"]
            ),
          },
          {
            path: "results/attempts/:attemptId",
            element: withAuth(
              <Suspense fallback={<SatRouteLoadingFallback />}><SatAttemptAnswersRoute /></Suspense>,
              ["admin", "grader", "proctor"]
            ),
          },
          {
            path: "results/:resultId",
            element: withAuth(
              <Suspense fallback={<SatRouteLoadingFallback />}><SatResultDetailRoute /></Suspense>,
              ["admin", "grader", "proctor"]
            ),
          },
          {
            path: "score-conversion",
            element: withAuth(
              <Suspense fallback={<SatRouteLoadingFallback />}><SatScoreConversionRoute /></Suspense>,
              ["admin"]
            ),
          },
          {
            path: "sessions/:scheduleId",
            lazy: async () => {
              const { SatSessionRoomRoute } = await import("../../products/sat/routes/SatSessionRoomRoute");
              return { element: withAuth(<SatSessionRoomRoute />, ["admin", "proctor"]) };
            },
          },
          {
            path: "exams/:examId",
            errorElement: <RouteErrorBoundary />,
            lazy: async () => {
              const { ProviderBuilderRoute } = await import("../../features/exam-authoring/routes/ProviderBuilderRoute");
              return { element: withAuth(<ProviderBuilderRoute />, ["admin", "builder"]) };
            },
          },
          {
            path: "exams/:examId/release",
            errorElement: <RouteErrorBoundary />,
            lazy: async () => {
              const { ProviderReviewRoute } = await import("../../features/exam-authoring/routes/ProviderReviewRoute");
              return { element: withAuth(<ProviderReviewRoute />, ["admin", "builder"]) };
            },
          },
          {
            path: "exams/:examId/preview",
            errorElement: <RouteErrorBoundary />,
            lazy: async () => {
              const { ProviderPreviewRoute } = await import("../../features/exam-authoring/routes/ProviderPreviewRoute");
              return { element: withAuth(<ProviderPreviewRoute />, ["admin", "builder"]) };
            },
          },
          {
            path: "exams/:examId/access",
            errorElement: <RouteErrorBoundary />,
            lazy: async () => {
              const { SatAccessRoute } = await import("../../products/sat/routes/SatAccessRoute");
              return { element: withAuth(<SatAccessRoute />, ["admin", "builder"]) };
            },
          },
          {
            path: "exams/:examId/settings",
            errorElement: <RouteErrorBoundary />,
            lazy: async () => {
              const { ExamSettingsRoute } = await loadExamSettingsRoute();
              return { element: withAuth(<ExamSettingsRoute />, ["admin", "builder"]) };
            },
          },
          {
            // Results are admin/grader/proctor only; the builder role must not
            // gain read access to results through the exam workspace.
            path: "exams/:examId/responses",
            errorElement: <RouteErrorBoundary />,
            lazy: async () => {
              const { SatExamResponsesRoute } = await import("../../products/sat/routes/SatExamResponsesRoute");
              return { element: withAuth(<SatExamResponsesRoute />, ["admin"]) };
            },
          },
        ],
      },
      {
        path: "builder/:examId",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProviderBuilderRoute />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "builder/:examId/builder",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <BuilderRoot />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "builder/:examId/review",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProviderReviewRoute />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "builder/:examId/preview",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProviderPreviewRoute />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "builder/:examId/answer-key",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ExamAnswerKeyRoute />
          </Suspense>,
          ["admin", "builder"]
        ),
      },
      {
        path: "proctor",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProctorRoot />
          </Suspense>,
          ["admin", "proctor"]
        ),
      },
      {
        path: "proctor/answer-history/:attemptId",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <ProctorAnswerHistoryRoute />
          </Suspense>,
          ["admin", "proctor"]
        ),
      },
      {
        path: "join/:accessLinkId",
        errorElement: <RouteErrorBoundary />,
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentAccessLinkEntryRoute />
          </Suspense>
        ),
      },
      {
        path: "student/recover-original/:scheduleId/:attemptId",
 errorElement: <RouteErrorBoundary />,
 element: <Suspense fallback={<RouteLoadingFallback />}><StudentDeviceRecoveryRoute /></Suspense>,
 },
 {
 path: "student/recover/:grantId",
 errorElement: <RouteErrorBoundary />,
 element: <Suspense fallback={<RouteLoadingFallback />}><StudentDeviceRecoveryRoute /></Suspense>,
 },
 {
 path: "student/:scheduleId",
        errorElement: <RouteErrorBoundary />,
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentRegistrationRoute />
          </Suspense>
        ),
      },
      {
        path: "student/:scheduleId/register",
        errorElement: <RouteErrorBoundary />,
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentRegistrationRoute />
          </Suspense>
        ),
      },
      {
        path: "student/:scheduleId/:studentId",
        errorElement: <RouteErrorBoundary />,
        element: withAuth(
          <Suspense fallback={<RouteLoadingFallback />}>
            <StudentSessionRoute />
          </Suspense>,
          ["admin", "builder", "proctor", "grader", "student"]
        ),
      },
      {
        path: "*",
        errorElement: <RouteErrorBoundary />,
        element: <NotFoundRoute />,
      },
    ],
  },
];

const devRoutes = import.meta.env.DEV
  ? [
      {
        path: "/__dev/highlight-selection",
        errorElement: <RouteErrorBoundary />,
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <DevHighlightSelectionRoute />
          </Suspense>
        ),
      },
      {
        path: "/__dev/sat-accessibility",
        errorElement: <RouteErrorBoundary />,
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <DevSatAccessibilityRoute />
          </Suspense>
        ),
      },
      {
        path: "/__dev/sat-forms",
        errorElement: <RouteErrorBoundary />,
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <DevSatFormsRoute />
          </Suspense>
        ),
      },
      {
        path: "/__dev/sat-authoring",
        errorElement: <RouteErrorBoundary />,
        element: (
          <Suspense fallback={<RouteLoadingFallback />}>
            <DevSatAuthoringRoute />
          </Suspense>
        ),
      },
    ]
  : [];

export const appRoutes = [...devRoutes, ...baseRoutes];

export const router = createBrowserRouter(appRoutes);
