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
    expect(getLeafPath('/admin/results')).toBe('results');
    expect(getLeafPath('/admin/settings')).toBe('settings');
  });

  it('treats student phases as internal runtime state', () => {
    expect(getLeafPath('/student/schedule-123')).toBe('student/:scheduleId');
    expect(getLeafPath('/student/schedule-123/precheck')).toBe('*');
    expect(getLeafPath('/student/schedule-123/lobby')).toBe('*');
    expect(getLeafPath('/student/schedule-123/exam')).toBe('*');
    expect(getLeafPath('/student/schedule-123/complete')).toBe('*');
  });

  it('hides proctor settings from the active route tree', () => {
    expect(getLeafPath('/proctor')).toBe('proctor');
    expect(getLeafPath('/proctor/settings')).toBe('*');
  });
});
