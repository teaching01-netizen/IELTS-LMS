/**
 * Grading Repository - Data Access Layer
 * 
 * This abstraction handles all grading data persistence operations.
 * UI components should never access localStorage directly.
 * This allows easy migration to a backend API later.
 */

import {
  GradingSession,
  StudentSubmission,
  SectionSubmission,
  WritingTaskSubmission,
  ReviewDraft,
  ReviewEvent,
  StudentResult,
  ReleaseEvent
} from '../types/grading';

const STORAGE_KEY_SESSIONS = 'ielts_grading_sessions';
const STORAGE_KEY_SUBMISSIONS = 'ielts_student_submissions';
const STORAGE_KEY_SECTION_SUBMISSIONS = 'ielts_section_submissions';
const STORAGE_KEY_WRITING_SUBMISSIONS = 'ielts_writing_submissions';
const STORAGE_KEY_REVIEW_DRAFTS = 'ielts_review_drafts';
const STORAGE_KEY_REVIEW_EVENTS = 'ielts_review_events';
const STORAGE_KEY_STUDENT_RESULTS = 'ielts_student_results';
const STORAGE_KEY_RELEASE_EVENTS = 'ielts_release_events';

/**
 * Repository interface for grading data operations
 */
export interface IGradingRepository {
  // Grading Session operations
  getAllSessions(): Promise<GradingSession[]>;
  getSessionById(id: string): Promise<GradingSession | null>;
  getSessionsBySchedule(scheduleId: string): Promise<GradingSession[]>;
  saveSession(session: GradingSession): Promise<void>;
  deleteSession(id: string): Promise<void>;
  
  // Student Submission operations
  getAllSubmissions(): Promise<StudentSubmission[]>;
  getSubmissionById(id: string): Promise<StudentSubmission | null>;
  getSubmissionsBySession(sessionId: string): Promise<StudentSubmission[]>;
  getSubmissionsByStudent(studentId: string): Promise<StudentSubmission[]>;
  getSubmissionsByTeacher(teacherId: string): Promise<StudentSubmission[]>;
  saveSubmission(submission: StudentSubmission): Promise<void>;
  deleteSubmission(id: string): Promise<void>;
  
  // Section Submission operations
  getAllSectionSubmissions(): Promise<SectionSubmission[]>;
  getSectionSubmissionById(id: string): Promise<SectionSubmission | null>;
  getSectionSubmissionsBySubmissionId(submissionId: string): Promise<SectionSubmission[]>;
  saveSectionSubmission(section: SectionSubmission): Promise<void>;
  deleteSectionSubmission(id: string): Promise<void>;
  
  // Writing Task Submission operations
  getAllWritingSubmissions(): Promise<WritingTaskSubmission[]>;
  getWritingSubmissionById(id: string): Promise<WritingTaskSubmission | null>;
  getWritingSubmissionsBySectionSubmissionId(sectionSubmissionId: string): Promise<WritingTaskSubmission[]>;
  saveWritingSubmission(writing: WritingTaskSubmission): Promise<void>;
  deleteWritingSubmission(id: string): Promise<void>;
  
  // Review Draft operations
  getAllReviewDrafts(): Promise<ReviewDraft[]>;
  getReviewDraftById(id: string): Promise<ReviewDraft | null>;
  getReviewDraftBySubmission(submissionId: string): Promise<ReviewDraft | null>;
  saveReviewDraft(draft: ReviewDraft): Promise<void>;
  deleteReviewDraft(id: string): Promise<void>;
  
  // Review Event operations
  getReviewEvents(submissionId: string, limit?: number): Promise<ReviewEvent[]>;
  saveReviewEvent(event: ReviewEvent): Promise<void>;
  
  // Student Result operations
  getAllStudentResults(): Promise<StudentResult[]>;
  getStudentResultById(id: string): Promise<StudentResult | null>;
  getStudentResultsBySubmission(submissionId: string): Promise<StudentResult[]>;
  getStudentResultsByStudent(studentId: string): Promise<StudentResult[]>;
  saveStudentResult(result: StudentResult): Promise<void>;
  deleteStudentResult(id: string): Promise<void>;
  
  // Release Event operations
  getReleaseEvents(resultId: string, limit?: number): Promise<ReleaseEvent[]>;
  saveReleaseEvent(event: ReleaseEvent): Promise<void>;
  
  // Bulk operations
  clearAll(): Promise<void>;
}

/**
 * LocalStorage implementation of grading repository
 */
export class LocalStorageGradingRepository implements IGradingRepository {
  
  // Helper methods for localStorage
  private getItem<T>(key: string): T[] {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : [];
  }
  
  private setItem<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  }
  
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Grading Session operations
  async getAllSessions(): Promise<GradingSession[]> {
    return this.getItem<GradingSession>(STORAGE_KEY_SESSIONS);
  }
  
  async getSessionById(id: string): Promise<GradingSession | null> {
    const sessions = await this.getAllSessions();
    return sessions.find(s => s.id === id) || null;
  }
  
  async getSessionsBySchedule(scheduleId: string): Promise<GradingSession[]> {
    const sessions = await this.getAllSessions();
    return sessions.filter(s => s.scheduleId === scheduleId);
  }
  
  async saveSession(session: GradingSession): Promise<void> {
    const sessions = await this.getAllSessions();
    const index = sessions.findIndex(s => s.id === session.id);
    
    if (index >= 0) {
      sessions[index] = { ...session, updatedAt: new Date().toISOString() };
    } else {
      sessions.push(session);
    }
    
    this.setItem(STORAGE_KEY_SESSIONS, sessions);
  }
  
  async deleteSession(id: string): Promise<void> {
    const sessions = await this.getAllSessions();
    const filtered = sessions.filter(s => s.id !== id);
    this.setItem(STORAGE_KEY_SESSIONS, filtered);
  }
  
  // Student Submission operations
  async getAllSubmissions(): Promise<StudentSubmission[]> {
    return this.getItem<StudentSubmission>(STORAGE_KEY_SUBMISSIONS);
  }
  
  async getSubmissionById(id: string): Promise<StudentSubmission | null> {
    const submissions = await this.getAllSubmissions();
    return submissions.find(s => s.id === id) || null;
  }
  
  async getSubmissionsBySession(sessionId: string): Promise<StudentSubmission[]> {
    const submissions = await this.getAllSubmissions();
    return submissions.filter(s => s.scheduleId === sessionId);
  }
  
  async getSubmissionsByStudent(studentId: string): Promise<StudentSubmission[]> {
    const submissions = await this.getAllSubmissions();
    return submissions.filter(s => s.studentId === studentId);
  }
  
  async getSubmissionsByTeacher(teacherId: string): Promise<StudentSubmission[]> {
    const submissions = await this.getAllSubmissions();
    return submissions.filter(s => s.assignedTeacherId === teacherId);
  }
  
  async saveSubmission(submission: StudentSubmission): Promise<void> {
    const submissions = await this.getAllSubmissions();
    const index = submissions.findIndex(s => s.id === submission.id);
    
    if (index >= 0) {
      submissions[index] = { ...submission, updatedAt: new Date().toISOString() };
    } else {
      submissions.push(submission);
    }
    
    this.setItem(STORAGE_KEY_SUBMISSIONS, submissions);
  }
  
  async deleteSubmission(id: string): Promise<void> {
    const submissions = await this.getAllSubmissions();
    const filtered = submissions.filter(s => s.id !== id);
    this.setItem(STORAGE_KEY_SUBMISSIONS, filtered);
  }
  
  // Section Submission operations
  async getAllSectionSubmissions(): Promise<SectionSubmission[]> {
    return this.getItem<SectionSubmission>(STORAGE_KEY_SECTION_SUBMISSIONS);
  }
  
  async getSectionSubmissionById(id: string): Promise<SectionSubmission | null> {
    const sections = await this.getAllSectionSubmissions();
    return sections.find(s => s.id === id) || null;
  }
  
  async getSectionSubmissionsBySubmissionId(submissionId: string): Promise<SectionSubmission[]> {
    const sections = await this.getAllSectionSubmissions();
    return sections.filter(s => s.submissionId === submissionId);
  }
  
  async saveSectionSubmission(section: SectionSubmission): Promise<void> {
    const sections = await this.getAllSectionSubmissions();
    const index = sections.findIndex(s => s.id === section.id);
    
    if (index >= 0) {
      sections[index] = section;
    } else {
      sections.push(section);
    }
    
    this.setItem(STORAGE_KEY_SECTION_SUBMISSIONS, sections);
  }
  
  async deleteSectionSubmission(id: string): Promise<void> {
    const sections = await this.getAllSectionSubmissions();
    const filtered = sections.filter(s => s.id !== id);
    this.setItem(STORAGE_KEY_SECTION_SUBMISSIONS, filtered);
  }
  
  // Writing Task Submission operations
  async getAllWritingSubmissions(): Promise<WritingTaskSubmission[]> {
    return this.getItem<WritingTaskSubmission>(STORAGE_KEY_WRITING_SUBMISSIONS);
  }
  
  async getWritingSubmissionById(id: string): Promise<WritingTaskSubmission | null> {
    const writings = await this.getAllWritingSubmissions();
    return writings.find(w => w.id === id) || null;
  }
  
  async getWritingSubmissionsBySectionSubmissionId(sectionSubmissionId: string): Promise<WritingTaskSubmission[]> {
    const writings = await this.getAllWritingSubmissions();
    return writings.filter(w => w.submissionId === sectionSubmissionId);
  }
  
  async saveWritingSubmission(writing: WritingTaskSubmission): Promise<void> {
    const writings = await this.getAllWritingSubmissions();
    const index = writings.findIndex(w => w.id === writing.id);
    
    if (index >= 0) {
      writings[index] = writing;
    } else {
      writings.push(writing);
    }
    
    this.setItem(STORAGE_KEY_WRITING_SUBMISSIONS, writings);
  }
  
  async deleteWritingSubmission(id: string): Promise<void> {
    const writings = await this.getAllWritingSubmissions();
    const filtered = writings.filter(w => w.id !== id);
    this.setItem(STORAGE_KEY_WRITING_SUBMISSIONS, filtered);
  }
  
  // Review Draft operations
  async getAllReviewDrafts(): Promise<ReviewDraft[]> {
    return this.getItem<ReviewDraft>(STORAGE_KEY_REVIEW_DRAFTS);
  }
  
  async getReviewDraftById(id: string): Promise<ReviewDraft | null> {
    const drafts = await this.getAllReviewDrafts();
    return drafts.find(d => d.id === id) || null;
  }
  
  async getReviewDraftBySubmission(submissionId: string): Promise<ReviewDraft | null> {
    const drafts = await this.getAllReviewDrafts();
    return drafts.find(d => d.submissionId === submissionId) || null;
  }
  
  async saveReviewDraft(draft: ReviewDraft): Promise<void> {
    const drafts = await this.getAllReviewDrafts();
    const index = drafts.findIndex(d => d.id === draft.id);
    
    if (index >= 0) {
      drafts[index] = { ...draft, updatedAt: new Date().toISOString() };
    } else {
      drafts.push(draft);
    }
    
    this.setItem(STORAGE_KEY_REVIEW_DRAFTS, drafts);
  }
  
  async deleteReviewDraft(id: string): Promise<void> {
    const drafts = await this.getAllReviewDrafts();
    const filtered = drafts.filter(d => d.id !== id);
    this.setItem(STORAGE_KEY_REVIEW_DRAFTS, filtered);
  }
  
  // Review Event operations
  async getReviewEvents(submissionId: string, limit = 100): Promise<ReviewEvent[]> {
    const events = this.getItem<ReviewEvent>(STORAGE_KEY_REVIEW_EVENTS);
    return events
      .filter(e => e.submissionId === submissionId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }
  
  async saveReviewEvent(event: ReviewEvent): Promise<void> {
    const events = this.getItem<ReviewEvent>(STORAGE_KEY_REVIEW_EVENTS);
    events.push(event);
    this.setItem(STORAGE_KEY_REVIEW_EVENTS, events);
  }
  
  // Student Result operations
  async getAllStudentResults(): Promise<StudentResult[]> {
    return this.getItem<StudentResult>(STORAGE_KEY_STUDENT_RESULTS);
  }
  
  async getStudentResultById(id: string): Promise<StudentResult | null> {
    const results = await this.getAllStudentResults();
    return results.find(r => r.id === id) || null;
  }
  
  async getStudentResultsBySubmission(submissionId: string): Promise<StudentResult[]> {
    const results = await this.getAllStudentResults();
    return results.filter(r => r.submissionId === submissionId);
  }
  
  async getStudentResultsByStudent(studentId: string): Promise<StudentResult[]> {
    const results = await this.getAllStudentResults();
    return results.filter(r => r.studentId === studentId);
  }
  
  async saveStudentResult(result: StudentResult): Promise<void> {
    const results = await this.getAllStudentResults();
    const index = results.findIndex(r => r.id === result.id);
    
    if (index >= 0) {
      results[index] = { ...result, updatedAt: new Date().toISOString() };
    } else {
      results.push(result);
    }
    
    this.setItem(STORAGE_KEY_STUDENT_RESULTS, results);
  }
  
  async deleteStudentResult(id: string): Promise<void> {
    const results = await this.getAllStudentResults();
    const filtered = results.filter(r => r.id !== id);
    this.setItem(STORAGE_KEY_STUDENT_RESULTS, filtered);
  }
  
  async clearAll(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY_SESSIONS);
    localStorage.removeItem(STORAGE_KEY_SUBMISSIONS);
    localStorage.removeItem(STORAGE_KEY_SECTION_SUBMISSIONS);
    localStorage.removeItem(STORAGE_KEY_WRITING_SUBMISSIONS);
    localStorage.removeItem(STORAGE_KEY_REVIEW_DRAFTS);
    localStorage.removeItem(STORAGE_KEY_REVIEW_EVENTS);
    localStorage.removeItem(STORAGE_KEY_STUDENT_RESULTS);
    localStorage.removeItem(STORAGE_KEY_RELEASE_EVENTS);
  }
  
  // Release Event operations
  async getReleaseEvents(resultId: string, limit = 100): Promise<ReleaseEvent[]> {
    const events = this.getItem<ReleaseEvent>(STORAGE_KEY_RELEASE_EVENTS);
    return events
      .filter(e => e.resultId === resultId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }
  
  async saveReleaseEvent(event: ReleaseEvent): Promise<void> {
    const events = this.getItem<ReleaseEvent>(STORAGE_KEY_RELEASE_EVENTS);
    events.push(event);
    this.setItem(STORAGE_KEY_RELEASE_EVENTS, events);
  }
}

/**
 * Singleton instance for app-wide use
 */
export const gradingRepository = new LocalStorageGradingRepository();
