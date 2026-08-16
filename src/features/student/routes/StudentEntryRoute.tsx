import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuthSession, type StudentQueuedAdmission } from '../../auth/api/authSession';
import { studentAttemptRepository } from '@student/application/studentAttemptFacade';
import { commonSchemas } from '@shared/lib/validateApiResponse';

interface EntryFormData {
  wcode: string;
  email: string;
  studentName: string;
  nickname: string;
  ieltsCourse: string;
}

const LAST_WCODE_STORAGE_PREFIX = 'ielts-student-last-wcode:';
const PROFILE_STORAGE_PREFIX = 'ielts-student-profile:';

function normalizeAccessCode(value: string): string {
  const trimmed = value.trim();
  if (/^w\d{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed;
}

function buildStudentRoute(scheduleId: string, accessCode: string): string {
  return `/student/${scheduleId}/${encodeURIComponent(accessCode)}`;
}

function validateEmail(email: string): boolean {
  return commonSchemas.email.safeParse(email).success;
}

function loadLastWcode(scheduleId: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(`${LAST_WCODE_STORAGE_PREFIX}${scheduleId}`);
}

function storeLastWcode(scheduleId: string, wcode: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(`${LAST_WCODE_STORAGE_PREFIX}${scheduleId}`, wcode);
}

function storeCandidateProfile(
  scheduleId: string,
  wcode: string,
  profile: { studentName: string; email: string; nickname: string; ieltsCourse: string },
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    `${PROFILE_STORAGE_PREFIX}${scheduleId}:${wcode}`,
    JSON.stringify(profile),
  );
}

function loadCandidateProfile(
  scheduleId: string,
  wcode: string,
): { studentName: string; email: string; nickname: string; ieltsCourse: string } | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(`${PROFILE_STORAGE_PREFIX}${scheduleId}:${wcode}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      studentName?: unknown;
      email?: unknown;
      nickname?: unknown;
      ieltsCourse?: unknown;
    };
    const studentName = typeof parsed.studentName === 'string' ? parsed.studentName.trim() : '';
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';
    const nickname = typeof parsed.nickname === 'string' ? parsed.nickname.trim() : '';
    const ieltsCourse = typeof parsed.ieltsCourse === 'string' ? parsed.ieltsCourse.trim() : '';

    if (!studentName || !email || !nickname || !ieltsCourse) {
      return null;
    }

    return { studentName, email, nickname, ieltsCourse };
  } catch {
    return null;
  }
}

export function StudentEntryRoute() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { studentEntry } = useAuthSession();

  const initialWcode = useMemo(() => {
    if (!scheduleId) {
      return '';
    }

    const queryWcode = searchParams.get('wcode');
    if (queryWcode) {
      return normalizeAccessCode(queryWcode);
    }

    const stored = loadLastWcode(scheduleId);
    return stored ? normalizeAccessCode(stored) : '';
  }, [scheduleId, searchParams]);

  const [formData, setFormData] = useState<EntryFormData>({
    wcode: initialWcode,
    email:
      scheduleId && initialWcode
        ? loadCandidateProfile(scheduleId, initialWcode)?.email ?? ''
        : '',
    studentName:
      scheduleId && initialWcode
        ? loadCandidateProfile(scheduleId, initialWcode)?.studentName ?? ''
        : '',
    nickname:
      scheduleId && initialWcode
        ? loadCandidateProfile(scheduleId, initialWcode)?.nickname ?? ''
        : '',
    ieltsCourse:
      scheduleId && initialWcode
        ? loadCandidateProfile(scheduleId, initialWcode)?.ieltsCourse ?? ''
        : '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof EntryFormData, string>>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [queuedAdmission, setQueuedAdmission] = useState<StudentQueuedAdmission | null>(null);
  const [queuedPayload, setQueuedPayload] = useState<EntryFormData | null>(null);

  useEffect(() => {
    const profile = scheduleId && initialWcode
      ? loadCandidateProfile(scheduleId, initialWcode)
      : null;

    setFormData({
      wcode: initialWcode,
      email: profile?.email ?? '',
      studentName: profile?.studentName ?? '',
      nickname: profile?.nickname ?? '',
      ieltsCourse: profile?.ieltsCourse ?? '',
    });
    setErrors({});
    setSubmitError(null);
    setQueuedAdmission(null);
    setQueuedPayload(null);
  }, [initialWcode, scheduleId]);

  useEffect(() => {
    if (!scheduleId) {
      return;
    }

    const normalizedWcode = normalizeAccessCode(initialWcode);
    if (!normalizedWcode) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const attempts = await studentAttemptRepository.getAttemptsByScheduleId(scheduleId);
        const activeAttempt = attempts.find(
          (candidate) =>
            candidate.phase !== 'post-exam' &&
            normalizeAccessCode(candidate.candidateId) === normalizedWcode,
        );

        if (activeAttempt && !cancelled) {
          navigate(buildStudentRoute(scheduleId, normalizedWcode), { replace: true });
        }
      } catch {
        // Fall back to manual check-in.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialWcode, navigate, scheduleId]);

  const handleInputChange = (field: keyof EntryFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));

    if (field === 'email' && value && !validateEmail(value)) {
      setErrors((prev) => ({
        ...prev,
        email: 'Invalid email format',
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedWcode = normalizeAccessCode(formData.wcode);
    const normalizedEmail = formData.email.trim();
    const normalizedName = formData.studentName.trim();
    const normalizedNickname = formData.nickname.trim();
    const normalizedIeltsCourse = formData.ieltsCourse.trim();

    const newErrors: Partial<Record<keyof EntryFormData, string>> = {};

    if (!normalizedWcode) {
      newErrors.wcode = 'Wcode is required';
    }

    if (!normalizedEmail || !validateEmail(normalizedEmail)) {
      newErrors.email = 'Email is required and must be valid';
    }

    if (!normalizedName) {
      newErrors.studentName = 'Name is required';
    }

    if (!normalizedNickname) {
      newErrors.nickname = 'Nickname is required';
    } else if (normalizedNickname.length > 50) {
      newErrors.nickname = 'Nickname must be 50 characters or less';
    }

    if (!normalizedIeltsCourse) {
      newErrors.ieltsCourse = 'IELTS Course is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!scheduleId) {
      setSubmitError('Invalid schedule id');
      return;
    }

    setIsLoading(true);
    setSubmitError(null);
    setQueuedAdmission(null);

    try {
      const result = await studentEntry({
        scheduleId,
        wcode: normalizedWcode,
        email: normalizedEmail,
        studentName: normalizedName,
        nickname: normalizedNickname,
        ieltsCourse: normalizedIeltsCourse,
      });

      if ('state' in result && result.state === 'queued') {
        setQueuedAdmission(result);
        setQueuedPayload({
          wcode: normalizedWcode,
          email: normalizedEmail,
          studentName: normalizedName,
          nickname: normalizedNickname,
          ieltsCourse: normalizedIeltsCourse,
        });
        return;
      }

      storeLastWcode(scheduleId, normalizedWcode);
      storeCandidateProfile(scheduleId, normalizedWcode, {
        studentName: normalizedName,
        email: normalizedEmail,
        nickname: normalizedNickname,
        ieltsCourse: normalizedIeltsCourse,
      });
      navigate(buildStudentRoute(scheduleId, normalizedWcode));
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Check-in failed. Please try again.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!scheduleId || !queuedAdmission || !queuedPayload) {
      return;
    }

    let cancelled = false;
    const pollAfterMs = Math.max(300, queuedAdmission.pollAfterMs || 1500);
    const timer = window.setTimeout(async () => {
      try {
        const result = await studentEntry({
          scheduleId,
          wcode: queuedPayload.wcode,
          email: queuedPayload.email,
          studentName: queuedPayload.studentName,
          nickname: queuedPayload.nickname,
          ieltsCourse: queuedPayload.ieltsCourse,
        });
        if (cancelled) {
          return;
        }
        if ('state' in result && result.state === 'queued') {
          setQueuedAdmission(result);
          return;
        }

        storeLastWcode(scheduleId, queuedPayload.wcode);
        storeCandidateProfile(scheduleId, queuedPayload.wcode, {
          studentName: queuedPayload.studentName,
          email: queuedPayload.email,
          nickname: queuedPayload.nickname,
          ieltsCourse: queuedPayload.ieltsCourse,
        });
        navigate(buildStudentRoute(scheduleId, queuedPayload.wcode));
      } catch (error) {
        if (!cancelled) {
          setSubmitError(
            error instanceof Error ? error.message : 'Admission polling failed. Please retry.',
          );
        }
      }
    }, pollAfterMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [navigate, queuedAdmission, queuedPayload, scheduleId, studentEntry]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Exam Check-in</h1>

        {submitError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{submitError}</p>
          </div>
        )}

        {queuedAdmission && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-700">
              You are in queue. Position: {queuedAdmission.position}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="wcode" className="block text-sm font-medium text-gray-700 mb-2">
              Wcode
              <input
                id="wcode"
                type="text"
                value={formData.wcode}
                onChange={(e) => handleInputChange('wcode', e.target.value)}
                placeholder="Enter your wcode"
                aria-label="Wcode"
                disabled={isLoading || Boolean(queuedAdmission)}
                className={`mt-2 w-full px-3 py-2 border rounded-md ${
                  errors.wcode ? 'border-red-300' : 'border-gray-300'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </label>
            {errors.wcode && <p className="mt-1 text-sm text-red-600">{errors.wcode}</p>}
            <p className="mt-1 text-xs text-gray-500">Enter the wcode provided to you.</p>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="student@example.com"
                aria-label="Email"
                disabled={isLoading || Boolean(queuedAdmission)}
                className={`mt-2 w-full px-3 py-2 border rounded-md ${
                  errors.email ? 'border-red-300' : 'border-gray-300'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </label>
            {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
          </div>

          <div>
            <label htmlFor="studentName" className="block text-sm font-medium text-gray-700 mb-2">
              Full Name
              <input
                id="studentName"
                type="text"
                value={formData.studentName}
                onChange={(e) => handleInputChange('studentName', e.target.value)}
                placeholder="John Doe"
                aria-label="Full Name"
                disabled={isLoading || Boolean(queuedAdmission)}
                className={`mt-2 w-full px-3 py-2 border rounded-md ${
                  errors.studentName ? 'border-red-300' : 'border-gray-300'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </label>
            {errors.studentName && (
              <p className="mt-1 text-sm text-red-600">{errors.studentName}</p>
            )}
          </div>

          <div>
            <label htmlFor="nickname" className="block text-sm font-medium text-gray-700 mb-2">
              Nickname
              <input
                id="nickname"
                type="text"
                value={formData.nickname}
                onChange={(e) => handleInputChange('nickname', e.target.value)}
                placeholder="Nickname"
                aria-label="Nickname"
                disabled={isLoading || Boolean(queuedAdmission)}
                maxLength={50}
                className={`mt-2 w-full px-3 py-2 border rounded-md ${
                  errors.nickname ? 'border-red-300' : 'border-gray-300'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </label>
            {errors.nickname && <p className="mt-1 text-sm text-red-600">{errors.nickname}</p>}
          </div>

          <div>
            <label htmlFor="ieltsCourse" className="block text-sm font-medium text-gray-700 mb-2">
              IELTS Course
              <input
                id="ieltsCourse"
                type="text"
                value={formData.ieltsCourse}
                onChange={(e) => handleInputChange('ieltsCourse', e.target.value)}
                placeholder="IELTS Course"
                aria-label="IELTS Course"
                disabled={isLoading || Boolean(queuedAdmission)}
                className={`mt-2 w-full px-3 py-2 border rounded-md ${
                  errors.ieltsCourse ? 'border-red-300' : 'border-gray-300'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </label>
            {errors.ieltsCourse && (
              <p className="mt-1 text-sm text-red-600">{errors.ieltsCourse}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || Boolean(queuedAdmission)}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {queuedAdmission ? 'Waiting for Admission...' : isLoading ? 'Checking in...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
