import { describe, expect, it } from 'vitest';
import { studentSessionTransport } from '../studentSessionTransport';

describe('studentSessionTransport', () => {
  it('builds session endpoints with candidate id', () => {
    expect(studentSessionTransport.paths.session('schedule-1', 'W001')).toBe(
      '/v1/student/sessions/schedule-1?candidateId=W001',
    );
    expect(studentSessionTransport.paths.staticSession('schedule-1', 'W001')).toBe(
      '/v1/student/sessions/schedule-1/static?candidateId=W001',
    );
    expect(studentSessionTransport.paths.liveSession('schedule-1', 'W001')).toBe(
      '/v1/student/sessions/schedule-1/live?candidateId=W001',
    );
  });

  it('builds credential refresh endpoint with required query params', () => {
    expect(
      studentSessionTransport.paths.credentialRefresh('schedule-1', 'W001', 'session-abc'),
    ).toBe(
      '/v1/student/sessions/schedule-1?candidateId=W001&refreshAttemptCredential=true&clientSessionId=session-abc',
    );
  });

  it('builds the cookie-authenticated resume endpoint without a candidate id', () => {
    expect(studentSessionTransport.paths.resume('schedule-1', 'session-abc')).toBe(
      '/v1/student/sessions/schedule-1?refreshAttemptCredential=true&clientSessionId=session-abc',
    );
    expect(studentSessionTransport.paths.resume('schedule-1')).toBe(
      '/v1/student/sessions/schedule-1?refreshAttemptCredential=true',
    );
  });

  it('builds heartbeat endpoint with optional response mode', () => {
    expect(studentSessionTransport.paths.heartbeat('schedule-1')).toBe(
      '/v1/student/sessions/schedule-1/heartbeat',
    );
    expect(studentSessionTransport.paths.heartbeat('schedule-1', 'ack')).toBe(
      '/v1/student/sessions/schedule-1/heartbeat?responseMode=ack',
    );
  });

  it('resolves candidate id from student key across supported formats', () => {
    expect(
      studentSessionTransport.resolveCandidateIdFromStudentKey(
        'schedule-1',
        'student-schedule-1-W001',
      ),
    ).toBe('W001');
    expect(studentSessionTransport.resolveCandidateIdFromStudentKey('schedule-1', 'foo-bar-W999')).toBe(
      'W999',
    );
    expect(studentSessionTransport.resolveCandidateIdFromStudentKey('schedule-1', '')).toBeNull();
  });

  it('returns null instead of throwing when runtime inputs are nullish', () => {
    expect(
      studentSessionTransport.resolveCandidateIdFromStudentKey(
        null as unknown as string,
        'student-schedule-1-W001',
      ),
    ).toBeNull();
    expect(
      studentSessionTransport.resolveCandidateIdFromStudentKey(
        'schedule-1',
        null as unknown as string,
      ),
    ).toBeNull();
  });
});
