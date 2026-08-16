import type {
  GradingQueueFilters,
  GradingSession,
  SessionDetailFilters,
  StudentSubmission,
} from '../types/grading';

export function mapScheduleStatusToGradingStatus(
  status: string,
): GradingSession['status'] {
  const map: Record<string, GradingSession['status']> = {
    scheduled: 'scheduled',
    live: 'live',
    completed: 'completed',
    cancelled: 'cancelled',
  };
  return map[status] || 'scheduled';
}

export function filterGradingSessions(
  sessions: GradingSession[],
  filters: GradingQueueFilters,
): GradingSession[] {
  let filtered = sessions;

  if (filters.cohort && filters.cohort.length > 0) {
    filtered = filtered.filter((session) => filters.cohort!.includes(session.cohortName));
  }

  if (filters.exam && filters.exam.length > 0) {
    filtered = filtered.filter((session) => filters.exam!.includes(session.examTitle));
  }

  if (typeof filters.recentDays === 'number' && filters.recentDays > 0) {
    const cutoff = Date.now() - filters.recentDays * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((session) => {
      const startTime = Date.parse(session.startTime);
      return Number.isFinite(startTime) && startTime >= cutoff;
    });
  }

  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (session) =>
        session.examTitle.toLowerCase().includes(query) ||
        session.cohortName.toLowerCase().includes(query),
    );
  }

  return filtered;
}

export function filterStudentSubmissions(
  submissions: StudentSubmission[],
  filters: SessionDetailFilters,
): StudentSubmission[] {
  let filtered = submissions;

  if (filters.status && filters.status.length > 0) {
    filtered = filtered.filter((submission) =>
      filters.status!.includes(submission.gradingStatus),
    );
  }

  if (filters.assignedTeacher) {
    filtered = filtered.filter(
      (submission) => submission.assignedTeacherId === filters.assignedTeacher,
    );
  }

  if (filters.isFlagged !== undefined) {
    filtered = filtered.filter((submission) => submission.isFlagged === filters.isFlagged);
  }

  if (filters.isOverdue !== undefined) {
    filtered = filtered.filter((submission) => submission.isOverdue === filters.isOverdue);
  }

  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (submission) =>
        submission.studentName.toLowerCase().includes(query) ||
        submission.studentEmail?.toLowerCase().includes(query),
    );
  }

  return filtered;
}
