import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SatPageError, SatPageLoading } from '../ui/SatPage';
import { useAccessDistributionOverview } from '../../../features/exam-authoring/api/assessmentAccessLinkQueries';
import { useExamQuery } from '../../../features/exam-authoring/api/examQueries';
import { StudentLinksDashboard, type CreateRequest } from '../../../features/exam-authoring/ui/access-links/StudentLinksDashboard';
import { useAccessSessionBindings } from '../../../features/exam-authoring/ui/delivery/useAccessSessionBindings';
import { ExamPublishSheet } from '../../../features/exam-authoring/ui/publish/ExamPublishSheet';
import { ExamSettingsSheet } from '../../../features/exam-authoring/ui/settings/ExamSettingsSheet';
import {
  canViewExamResponses,
  examWorkspacePath,
  parseDeliveryCreate,
} from '../../../features/exam-authoring/ui/shell/examLifecycle';
import { useExamWorkspaceChrome } from '../../../features/exam-authoring/ui/shell/useExamWorkspaceChrome';
import { requestAuthoringDraftOnEntry } from '../../../features/exam-authoring/api/authoringEntryIntent';
import { parseIssueLink } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import type { AssessmentValidationIssue } from '../../../features/exam-authoring/contracts/assessment';
import { useOptionalAuthSession } from '../../../features/auth/api/authSession';
import {
  SatAuthoringCollaborationBoundary,
  useSatAuthoringCollaboration,
} from '../../../features/exam-authoring/realtime/coedit';
import { satListReturnTarget } from '../ui/useSatListReturn';

/**
 * Sessions: publication, session setup, student links and session entry for one
 * exam. (The route keeps its /access URL.)
 */
export function SatAccessRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const existingCollaboration = useSatAuthoringCollaboration();
  const examQuery = useExamQuery(examId ?? '');
  const distributionQuery = useAccessDistributionOverview(examId ?? '');
  const chrome = useExamWorkspaceChrome(examId ?? '');
  const role = useOptionalAuthSession()?.session?.user.role ?? null;
  const [publishOpen, setPublishOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // "?new=1&version=…" (from the publish success panel) opens the create form once,
  // pinned to the version that was just published, then the URL is cleaned up.
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(() => {
    const parsed = parseDeliveryCreate(searchParams);
    if (!parsed) return null;
    return { id: 1, ...(parsed === 'any' ? {} : parsed) };
  });
  useEffect(() => {
    if (searchParams.get('new')) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        for (const key of ['new', 'version', 'versionNumber', 'scope']) next.delete(key);
        return next;
      }, { replace: true });
    }
    // Run once on arrival: later changes to the query string are not requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const canRunSessions = canViewExamResponses(role);
  const session = useAccessSessionBindings({
    canRun: canRunSessions,
    onOpenRoom: (scheduleId) => {
      const linkId = distributionQuery.data?.links.find((link) => link.scheduleId === scheduleId)?.id ?? searchParams.get('link');
      const params = new URLSearchParams(linkId ? { link: linkId } : {});
      navigate(`/sat/sessions/${encodeURIComponent(scheduleId)}`, {
        state: { from: examId ? `${examWorkspacePath(examId, 'delivery')}${params.size ? `?${params}` : ''}` : '/sat/exams' },
      });
    },
    onOpenResults: (scheduleId) => navigate(examId ? `${examWorkspacePath(examId, 'responses')}?${new URLSearchParams({ access: scheduleId })}` : '/sat/results'),
  });
  if (!examId) {
    return <SatPageError title="Rooms could not load" description="A valid SAT exam is required." retryLabel="Back to Exams" onRetry={() => navigate('/sat/exams')} />;
  }

  if (examQuery.isLoading) return <SatPageLoading label="Opening Rooms…" />;
  if (examQuery.error || !examQuery.data) {
    return <SatPageError title="Rooms could not load" description={examQuery.error instanceof Error ? examQuery.error.message : 'The SAT exam is unavailable.'} retryLabel="Back to Exams" onRetry={() => navigate('/sat/exams')} />;
  }
  const exam = examQuery.data;
  if (exam.providerKey !== 'sat') {
    return <SatPageError title="This is not a SAT exam" description="Open this exam from its IELTS workspace instead." retryLabel="Back to Exams" onRetry={() => navigate('/sat/exams')} />;
  }

  const openIssue = (issue: AssessmentValidationIssue) => {
    const { questionId, field } = parseIssueLink(issue.path);
    if (!questionId && !field) return;
    const params = new URLSearchParams();
    if (questionId) params.set('question', questionId);
    if (field) params.set('field', field);
    requestAuthoringDraftOnEntry(exam.id);
    navigate(`${examWorkspacePath(exam.id, 'questions')}?${params.toString()}`);
  };

  const content = (
    <>
      <StudentLinksDashboard
        exam={exam}
        overview={distributionQuery.data ?? null}
        isLoading={distributionQuery.isLoading && !distributionQuery.data}
        error={distributionQuery.error instanceof Error ? distributionQuery.error.message : null}
        onRefresh={() => distributionQuery.refetch()}
        onBackToRelease={() => navigate(`/sat/exams/${exam.id}/release`)}
        createRequest={createRequest}
        selectedLinkId={searchParams.get('link')}
        onSelectionChange={(linkId) => setSearchParams((current) => {
          const next = new URLSearchParams(current);
          if (linkId) next.set('link', linkId);
          else next.delete('link');
          return next;
        }, { replace: true })}
        session={session}
        shell={{
          lifecycle: chrome.lifecycle,
          showResponses: chrome.showResponses,
          // Tabs are pages; Quick settings edits in place over Sessions.
          onSelectTab: (tab) => {
            if (tab !== 'delivery') navigate(examWorkspacePath(exam.id, tab));
          },
          onQuickSettings: () => setSettingsOpen(true),
          onBack: () => {
            const back = satListReturnTarget('/sat/exams');
            navigate(back.to, back.state ? { state: back.state } : undefined);
          },
          onPreview: () => navigate(`/sat/exams/${encodeURIComponent(exam.id)}/preview`),
          ...(exam.canPublish ? { onPublish: () => setPublishOpen(true) } : {}),
        }}
      />
      {publishOpen ? (
        <ExamPublishSheet
          examId={exam.id}
          open
          onClose={() => setPublishOpen(false)}
          onOpenIssue={openIssue}
          onOpenStudentAccess={(target) => {
            setPublishOpen(false);
            setCreateRequest({ id: Date.now(), ...(target ?? {}) });
          }}
        />
      ) : null}
      {settingsOpen ? <ExamSettingsSheet examId={exam.id} open onClose={() => setSettingsOpen(false)} onEditExam={() => navigate(examWorkspacePath(exam.id, 'questions'))} /> : null}
    </>
  );
  return existingCollaboration ? content : (
    <SatAuthoringCollaborationBoundary examId={exam.id}>
      {content}
    </SatAuthoringCollaborationBoundary>
  );
}
