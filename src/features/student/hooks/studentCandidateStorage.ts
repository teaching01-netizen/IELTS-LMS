const PROFILE_STORAGE_PREFIX = 'ielts-student-profile:';

export interface StoredCandidateProfile {
  candidateName?: string;
  candidateEmail?: string;
}

export function normalizeCandidateId(studentId?: string): string | null {
  if (!studentId) {
    return null;
  }

  const normalized = studentId.trim();
  if (!normalized) {
    return null;
  }
  if (/^w\d{6}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  return normalized;
}

export function buildStudentKey(scheduleId: string, candidateId: string): string {
  return `student-${scheduleId}-${candidateId}`;
}

export function loadStoredCandidateProfile(
  scheduleId: string,
  candidateId: string,
): StoredCandidateProfile | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(`${PROFILE_STORAGE_PREFIX}${scheduleId}:${candidateId}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { studentName?: unknown; email?: unknown };
    const studentName = typeof parsed.studentName === 'string' ? parsed.studentName.trim() : '';
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';

    const profile: StoredCandidateProfile = {};
    if (studentName) {
      profile.candidateName = studentName;
    }
    if (email) {
      profile.candidateEmail = email;
    }
    return profile;
  } catch {
    return null;
  }
}

export function createCandidateProfile(
  candidateId: string,
  stored: StoredCandidateProfile | null,
): { candidateId: string; candidateName: string; candidateEmail: string } {
  return {
    candidateId,
    candidateName: stored?.candidateName ?? 'Unknown Candidate',
    candidateEmail: stored?.candidateEmail ?? '',
  };
}
