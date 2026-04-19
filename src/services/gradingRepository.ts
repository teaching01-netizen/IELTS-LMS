import { backendGet, isBackendNotFound } from './backendBridge';
import type {
  GradingSession,
  ReleaseEvent,
  ReviewDraft,
  ReviewEvent,
  SectionSubmission,
  StudentResult,
  StudentSubmission,
  WritingTaskSubmission,
} from '../types/grading';

const reviewDraftRevisions = new Map<string, number>();
const writingTaskSectionIndex = new Map<string, string>();

function normalizeTeacherSummary(value: unknown): NonNullable<ReviewDraft['teacherSummary']> {
  if (value && typeof value === 'object') {
    const payload = value as Record<string, unknown>;
    return {
      strengths: Array.isArray(payload['strengths']) ? (payload['strengths'] as string[]) : [],
      improvementPriorities: Array.isArray(payload['improvementPriorities'])
        ? (payload['improvementPriorities'] as string[])
        : [],
      recommendedPractice: Array.isArray(payload['recommendedPractice'])
        ? (payload['recommendedPractice'] as string[])
        : [],
    };
  }

  return {
    strengths: [],
    improvementPriorities: [],
    recommendedPractice: [],
  };
}

function normalizeStudentResultSummary(
  value: unknown,
): NonNullable<StudentResult['teacherSummary']> {
  const summary = normalizeTeacherSummary(value);
  return {
    strengths: summary.strengths,
    improvementPriorities: summary.improvementPriorities,
    recommendedPractice: summary.recommendedPractice,
  };
}

function normalizeSectionBands(value: unknown): StudentResult['sectionBands'] {
  if (value && typeof value === 'object') {
    const payload = value as Record<string, unknown>;
    return {
      listening: Number(payload['listening'] ?? 0),
      reading: Number(payload['reading'] ?? 0),
      writing: Number(payload['writing'] ?? 0),
      speaking: Number(payload['speaking'] ?? 0),
    };
  }

  return {
    listening: 0,
    reading: 0,
    writing: 0,
    speaking: 0,
  };
}

export function rememberReviewDraftRevision(id: string, revision: number | undefined): void {
  if (Number.isInteger(revision)) {
    reviewDraftRevisions.set(id, revision as number);
  }
}

export function getReviewDraftRevision(id: string): number | undefined {
  return reviewDraftRevisions.get(id);
}

export interface IGradingRepository {
  getAllSessions(): Promise<GradingSession[]>;
  getSessionById(id: string): Promise<GradingSession | null>;
  getSessionsBySchedule(scheduleId: string): Promise<GradingSession[]>;
  saveSession(session: GradingSession): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getAllSubmissions(): Promise<StudentSubmission[]>;
  getSubmissionById(id: string): Promise<StudentSubmission | null>;
  getSubmissionsBySession(sessionId: string): Promise<StudentSubmission[]>;
  getSubmissionsByStudent(studentId: string): Promise<StudentSubmission[]>;
  getSubmissionsByTeacher(teacherId: string): Promise<StudentSubmission[]>;
  saveSubmission(submission: StudentSubmission): Promise<void>;
  deleteSubmission(id: string): Promise<void>;
  getAllSectionSubmissions(): Promise<SectionSubmission[]>;
  getSectionSubmissionById(id: string): Promise<SectionSubmission | null>;
  getSectionSubmissionsBySubmissionId(submissionId: string): Promise<SectionSubmission[]>;
  saveSectionSubmission(section: SectionSubmission): Promise<void>;
  deleteSectionSubmission(id: string): Promise<void>;
  getAllWritingSubmissions(): Promise<WritingTaskSubmission[]>;
  getWritingSubmissionById(id: string): Promise<WritingTaskSubmission | null>;
  getWritingSubmissionsBySectionSubmissionId(
    sectionSubmissionId: string,
  ): Promise<WritingTaskSubmission[]>;
  getWritingSubmissionsBySubmissionId(submissionId: string): Promise<WritingTaskSubmission[]>;
  saveWritingSubmission(writing: WritingTaskSubmission): Promise<void>;
  deleteWritingSubmission(id: string): Promise<void>;
  getAllReviewDrafts(): Promise<ReviewDraft[]>;
  getReviewDraftById(id: string): Promise<ReviewDraft | null>;
  getReviewDraftBySubmission(submissionId: string): Promise<ReviewDraft | null>;
  saveReviewDraft(draft: ReviewDraft): Promise<void>;
  deleteReviewDraft(id: string): Promise<void>;
  getReviewEvents(submissionId: string, limit?: number): Promise<ReviewEvent[]>;
  saveReviewEvent(event: ReviewEvent): Promise<void>;
  getAllStudentResults(): Promise<StudentResult[]>;
  getStudentResultById(id: string): Promise<StudentResult | null>;
  getStudentResultsBySubmission(submissionId: string): Promise<StudentResult[]>;
  getStudentResultsByStudent(studentId: string): Promise<StudentResult[]>;
  saveStudentResult(result: StudentResult): Promise<void>;
  deleteStudentResult(id: string): Promise<void>;
  getReleaseEvents(resultId: string, limit?: number): Promise<ReleaseEvent[]>;
  saveReleaseEvent(event: ReleaseEvent): Promise<void>;
  clearAll(): Promise<void>;
}

class BackendGradingRepository implements IGradingRepository {
  private readonly submissionBundleCache = new Map<string, any>();

  private mapSession(payload: any): GradingSession {
    return {
      id: payload.id,
      scheduleId: payload.scheduleId,
      examId: payload.examId,
      examTitle: payload.examTitle,
      publishedVersionId: payload.publishedVersionId,
      cohortName: payload.cohortName,
      institution: payload.institution ?? undefined,
      startTime: payload.startTime,
      endTime: payload.endTime,
      status: payload.status,
      totalStudents: payload.totalStudents,
      submittedCount: payload.submittedCount,
      pendingManualReviews: payload.pendingManualReviews,
      inProgressReviews: payload.inProgressReviews,
      finalizedReviews: payload.finalizedReviews,
      overdueReviews: payload.overdueReviews,
      assignedTeachers: Array.isArray(payload.assignedTeachers) ? payload.assignedTeachers : [],
      createdAt: payload.createdAt,
      createdBy: payload.createdBy,
      updatedAt: payload.updatedAt,
    };
  }

  private mapSubmission(payload: any): StudentSubmission {
    return {
      id: payload.id,
      submissionId: payload.id,
      scheduleId: payload.scheduleId,
      examId: payload.examId,
      publishedVersionId: payload.publishedVersionId,
      studentId: payload.studentId,
      studentName: payload.studentName,
      studentEmail: payload.studentEmail ?? undefined,
      cohortName: payload.cohortName,
      submittedAt: payload.submittedAt,
      timeSpentSeconds: payload.timeSpentSeconds,
      gradingStatus: payload.gradingStatus,
      assignedTeacherId: payload.assignedTeacherId ?? undefined,
      assignedTeacherName: payload.assignedTeacherName ?? undefined,
      isFlagged: payload.isFlagged,
      flagReason: payload.flagReason ?? undefined,
      isOverdue: payload.isOverdue,
      dueDate: payload.dueDate ?? undefined,
      sectionStatuses: payload.sectionStatuses,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  private mapSection(payload: any): SectionSubmission {
    return {
      id: payload.id,
      submissionId: payload.submissionId,
      section: payload.section,
      answers: payload.answers,
      autoGradingResults: payload.autoGradingResults ?? undefined,
      gradingStatus: payload.gradingStatus,
      reviewedBy: payload.reviewedBy ?? undefined,
      reviewedAt: payload.reviewedAt ?? undefined,
      finalizedBy: payload.finalizedBy ?? undefined,
      finalizedAt: payload.finalizedAt ?? undefined,
      submittedAt: payload.submittedAt,
    };
  }

  private mapWritingTask(payload: any): WritingTaskSubmission {
    if (typeof payload.sectionSubmissionId === 'string') {
      writingTaskSectionIndex.set(payload.id, payload.sectionSubmissionId);
    }

    return {
      id: payload.id,
      submissionId: payload.submissionId,
      taskId: payload.taskId,
      taskLabel: payload.taskLabel,
      prompt: payload.prompt,
      studentText: payload.studentText,
      wordCount: payload.wordCount,
      rubricAssessment: payload.rubricAssessment ?? undefined,
      annotations: payload.annotations ?? [],
      overallFeedback: payload.overallFeedback ?? undefined,
      studentVisibleNotes: payload.studentVisibleNotes ?? undefined,
      gradingStatus: payload.gradingStatus,
      submittedAt: payload.submittedAt,
      gradedBy: payload.gradedBy ?? undefined,
      gradedAt: payload.gradedAt ?? undefined,
      finalizedBy: payload.finalizedBy ?? undefined,
      finalizedAt: payload.finalizedAt ?? undefined,
    };
  }

  private mapReviewDraft(payload: any): ReviewDraft {
    rememberReviewDraftRevision(payload.id, payload.revision);

    return {
      id: payload.id,
      submissionId: payload.submissionId,
      studentId: payload.studentId,
      teacherId: payload.teacherId,
      releaseStatus: payload.releaseStatus,
      sectionDrafts: payload.sectionDrafts ?? {},
      annotations: payload.annotations ?? [],
      drawings: payload.drawings ?? [],
      overallFeedback: payload.overallFeedback ?? undefined,
      studentVisibleNotes: payload.studentVisibleNotes ?? undefined,
      internalNotes: payload.internalNotes ?? undefined,
      teacherSummary: normalizeTeacherSummary(payload.teacherSummary),
      checklist: payload.checklist ?? {},
      hasUnsavedChanges: payload.hasUnsavedChanges,
      lastAutoSaveAt: payload.lastAutoSaveAt ?? undefined,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  private mapStudentResult(payload: any): StudentResult {
    return {
      id: payload.id,
      submissionId: payload.submissionId,
      studentId: payload.studentId,
      studentName: payload.studentName,
      releaseStatus: payload.releaseStatus,
      releasedAt: payload.releasedAt ?? undefined,
      releasedBy: payload.releasedBy ?? undefined,
      scheduledReleaseDate: payload.scheduledReleaseDate ?? undefined,
      overallBand: payload.overallBand,
      sectionBands: normalizeSectionBands(payload.sectionBands),
      listeningResult: payload.listeningResult ?? undefined,
      readingResult: payload.readingResult ?? undefined,
      writingResults: payload.writingResults ?? {},
      speakingResult: payload.speakingResult ?? undefined,
      teacherSummary: normalizeStudentResultSummary(payload.teacherSummary),
      version: payload.version,
      previousVersionId: payload.previousVersionId ?? undefined,
      revisionReason: payload.revisionReason ?? undefined,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  private mapReleaseEvent(payload: any): ReleaseEvent {
    return {
      id: payload.id,
      resultId: payload.resultId,
      action: payload.action,
      actor: payload.actorId ?? payload.actor,
      actorName: payload.actorName ?? payload.actorId ?? 'Unknown',
      timestamp: payload.createdAt ?? payload.timestamp,
      payload: payload.payload ?? undefined,
    };
  }

  private async getSubmissionBundle(submissionId: string): Promise<any> {
    const cached = this.submissionBundleCache.get(submissionId);
    if (cached) {
      return cached;
    }

    const bundle = await backendGet<any>(`/v1/grading/submissions/${submissionId}`);
    this.submissionBundleCache.set(submissionId, bundle);
    return bundle;
  }

  async getAllSessions(): Promise<GradingSession[]> {
    return (await backendGet<any[]>('/v1/grading/sessions')).map((session) =>
      this.mapSession(session),
    );
  }

  async getSessionById(id: string): Promise<GradingSession | null> {
    try {
      const detail = await backendGet<any>(`/v1/grading/sessions/${id}`);
      return this.mapSession(detail.session);
    } catch (error) {
      if (isBackendNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async getSessionsBySchedule(scheduleId: string): Promise<GradingSession[]> {
    const session = await this.getSessionById(scheduleId);
    return session ? [session] : [];
  }

  async saveSession(_session: GradingSession): Promise<void> {}

  async deleteSession(_id: string): Promise<void> {}

  async getAllSubmissions(): Promise<StudentSubmission[]> {
    const sessions = await this.getAllSessions();
    const details = await Promise.all(
      sessions.map((session) => this.getSubmissionsBySession(session.id)),
    );
    return details.flat();
  }

  async getSubmissionById(id: string): Promise<StudentSubmission | null> {
    try {
      const bundle = await this.getSubmissionBundle(id);
      return this.mapSubmission(bundle.submission);
    } catch (error) {
      if (isBackendNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async getSubmissionsBySession(sessionId: string): Promise<StudentSubmission[]> {
    const detail = await backendGet<any>(`/v1/grading/sessions/${sessionId}`);
    return (detail.submissions ?? []).map((submission: any) => this.mapSubmission(submission));
  }

  async getSubmissionsByStudent(studentId: string): Promise<StudentSubmission[]> {
    return (await this.getAllSubmissions()).filter(
      (submission) => submission.studentId === studentId,
    );
  }

  async getSubmissionsByTeacher(teacherId: string): Promise<StudentSubmission[]> {
    return (await this.getAllSubmissions()).filter(
      (submission) => submission.assignedTeacherId === teacherId,
    );
  }

  async saveSubmission(_submission: StudentSubmission): Promise<void> {}

  async deleteSubmission(_id: string): Promise<void> {}

  async getAllSectionSubmissions(): Promise<SectionSubmission[]> {
    const submissions = await this.getAllSubmissions();
    const sections = await Promise.all(
      submissions.map((submission) => this.getSectionSubmissionsBySubmissionId(submission.id)),
    );
    return sections.flat();
  }

  async getSectionSubmissionById(id: string): Promise<SectionSubmission | null> {
    return (await this.getAllSectionSubmissions()).find((section) => section.id === id) ?? null;
  }

  async getSectionSubmissionsBySubmissionId(submissionId: string): Promise<SectionSubmission[]> {
    const bundle = await this.getSubmissionBundle(submissionId);
    return (bundle.sections ?? []).map((section: any) => this.mapSection(section));
  }

  async saveSectionSubmission(_section: SectionSubmission): Promise<void> {}

  async deleteSectionSubmission(_id: string): Promise<void> {}

  async getAllWritingSubmissions(): Promise<WritingTaskSubmission[]> {
    const submissions = await this.getAllSubmissions();
    const writingTasks = await Promise.all(
      submissions.map((submission) => this.getWritingSubmissionsBySubmissionId(submission.id)),
    );
    return writingTasks.flat();
  }

  async getWritingSubmissionById(id: string): Promise<WritingTaskSubmission | null> {
    return (await this.getAllWritingSubmissions()).find((writing) => writing.id === id) ?? null;
  }

  async getWritingSubmissionsBySectionSubmissionId(
    sectionSubmissionId: string,
  ): Promise<WritingTaskSubmission[]> {
    const tasks = await this.getAllWritingSubmissions();
    return tasks.filter((task) => writingTaskSectionIndex.get(task.id) === sectionSubmissionId);
  }

  async getWritingSubmissionsBySubmissionId(submissionId: string): Promise<WritingTaskSubmission[]> {
    const bundle = await this.getSubmissionBundle(submissionId);
    return (bundle.writingTasks ?? []).map((writing: any) => this.mapWritingTask(writing));
  }

  async saveWritingSubmission(_writing: WritingTaskSubmission): Promise<void> {}

  async deleteWritingSubmission(_id: string): Promise<void> {}

  async getAllReviewDrafts(): Promise<ReviewDraft[]> {
    const submissions = await this.getAllSubmissions();
    const drafts = await Promise.all(
      submissions.map((submission) => this.getReviewDraftBySubmission(submission.id)),
    );
    return drafts.filter((draft): draft is ReviewDraft => Boolean(draft));
  }

  async getReviewDraftById(id: string): Promise<ReviewDraft | null> {
    return (await this.getAllReviewDrafts()).find((draft) => draft.id === id) ?? null;
  }

  async getReviewDraftBySubmission(submissionId: string): Promise<ReviewDraft | null> {
    try {
      const bundle = await this.getSubmissionBundle(submissionId);
      if ('reviewDraft' in bundle) {
        return bundle.reviewDraft ? this.mapReviewDraft(bundle.reviewDraft) : null;
      }
    } catch (error) {
      if (!isBackendNotFound(error)) {
        throw error;
      }
      // ignore and fall through
    }

    try {
      const draft = await backendGet<any>(`/v1/grading/submissions/${submissionId}/review-draft`);
      return this.mapReviewDraft(draft);
    } catch (error) {
      if (isBackendNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async saveReviewDraft(draft: ReviewDraft): Promise<void> {
    const revision = (draft as unknown as { revision?: unknown }).revision;
    rememberReviewDraftRevision(draft.id, typeof revision === 'number' ? revision : undefined);
  }

  async deleteReviewDraft(_id: string): Promise<void> {}

  async getReviewEvents(_submissionId: string, _limit = 100): Promise<ReviewEvent[]> {
    return [];
  }

  async saveReviewEvent(_event: ReviewEvent): Promise<void> {}

  async getAllStudentResults(): Promise<StudentResult[]> {
    return (await backendGet<any[]>('/v1/results')).map((result) => this.mapStudentResult(result));
  }

  async getStudentResultById(id: string): Promise<StudentResult | null> {
    try {
      return this.mapStudentResult(await backendGet<any>(`/v1/results/${id}`));
    } catch (error) {
      if (isBackendNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async getStudentResultsBySubmission(submissionId: string): Promise<StudentResult[]> {
    return (await this.getAllStudentResults()).filter((result) => result.submissionId === submissionId);
  }

  async getStudentResultsByStudent(studentId: string): Promise<StudentResult[]> {
    return (await this.getAllStudentResults()).filter((result) => result.studentId === studentId);
  }

  async saveStudentResult(_result: StudentResult): Promise<void> {}

  async deleteStudentResult(_id: string): Promise<void> {}

  async getReleaseEvents(resultId: string, limit = 100): Promise<ReleaseEvent[]> {
    return (await backendGet<any[]>(`/v1/results/${resultId}/events`))
      .map((event) => this.mapReleaseEvent(event))
      .slice(0, limit);
  }

  async saveReleaseEvent(_event: ReleaseEvent): Promise<void> {}

  async clearAll(): Promise<void> {}
}

export const gradingRepository: IGradingRepository = new BackendGradingRepository();
