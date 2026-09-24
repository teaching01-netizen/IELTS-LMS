import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { appRoutes } from '../index';

function getLeafPath(pathname: string) {
  const matches = matchRoutes(appRoutes, pathname);
  return matches?.at(-1)?.route.path ?? null;
}

describe('route contracts', () => {
  it('keeps admin child routes as real routes', () => {
    expect(getLeafPath('/admin')).toBe(null);
    expect(getLeafPath('/admin/exams')).toBe('exams');
    expect(getLeafPath('/admin/scheduling')).toBe('scheduling');
    expect(getLeafPath('/admin/grading')).toBe('grading');
    expect(getLeafPath('/admin/answer-history/sub-123')).toBe('answer-history/:submissionId');
    expect(getLeafPath('/admin/results')).toBe('results');
    expect(getLeafPath('/admin/settings')).toBe('settings');
  });

  it('exposes Digital SAT as its own product route tree', () => {
    expect(getLeafPath('/sat')).toBe(null);
    expect(getLeafPath('/sat/exams')).toBe('exams');
    expect(getLeafPath('/sat/sessions')).toBe('sessions');
    expect(getLeafPath('/sat/results')).toBe('results');
    expect(getLeafPath('/sat/results/result-1')).toBe('results/:resultId');
    expect(getLeafPath('/sat/results/attempts/attempt-1')).toBe('results/attempts/:attemptId');
    // Exam detail/release/preview/access are nested under the /sat parent,
    // so leaf paths are relative (same full URLs as the manifest entries).
    expect(getLeafPath('/sat/exams/exam-1')).toBe('exams/:examId');
    expect(getLeafPath('/sat/exams/exam-1/release')).toBe('exams/:examId/release');
    expect(getLeafPath('/sat/exams/exam-1/preview')).toBe('exams/:examId/preview');
    expect(getLeafPath('/sat/exams/exam-1/access')).toBe('exams/:examId/access');
    // Session room is nested under the /sat parent, so the leaf path is
    // relative (same URL /sat/sessions/:scheduleId as the manifest entry).
    expect(getLeafPath('/sat/sessions/session-1')).toBe('sessions/:scheduleId');
  });

  it('treats student phases as internal runtime state', () => {
    expect(getLeafPath('/student/schedule-123')).toBe('student/:scheduleId');
    expect(getLeafPath('/student/schedule-123/register')).toBe('student/:scheduleId/register');
    expect(getLeafPath('/student/schedule-123/W250334')).toBe('student/:scheduleId/:studentId');
    expect(getLeafPath('/student/schedule-123/precheck')).toBe('student/:scheduleId/:studentId');
    expect(getLeafPath('/student/schedule-123/W250334/precheck')).toBe('*');
    expect(getLeafPath('/student/schedule-123/W250334/lobby')).toBe('*');
    expect(getLeafPath('/student/schedule-123/W250334/exam')).toBe('*');
    expect(getLeafPath('/student/schedule-123/W250334/complete')).toBe('*');
  });

  it('hides proctor settings from the active route tree', () => {
    expect(getLeafPath('/proctor')).toBe('proctor');
    expect(getLeafPath('/proctor/answer-history/attempt-1')).toBe('proctor/answer-history/:attemptId');
    expect(getLeafPath('/proctor/settings')).toBe('*');
  });

  it('exposes builder preview as a real route', () => {
    expect(getLeafPath('/builder/exam-123/preview')).toBe('builder/:examId/preview');
  });

  it('exposes builder answer key overview as a real route', () => {
    expect(getLeafPath('/builder/exam-123/answer-key')).toBe('builder/:examId/answer-key');
  });
});
