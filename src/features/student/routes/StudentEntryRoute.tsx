import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuthSession } from '../../auth/authSession';
import { studentAttemptRepository } from '@services/studentAttemptRepository';

interface EntryFormData {
  wcode: string;
  email: string;
  studentName: string;
}

const LAST_WCODE_STORAGE_PREFIX = 'ielts-student-last-wcode:';
const PROFILE_STORAGE_PREFIX = 'ielts-student-profile:';

function validateWcode(wcode: string): boolean {
  return /^W[0-9]{6}$/.test(wcode);
}

function validateEmail(email: string): boolean {
  return /^[^@]+@[^@]+\.[^@]+$/.test(email);
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
  profile: { studentName: string; email: string },
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
): { studentName: string; email: string } | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(`${PROFILE_STORAGE_PREFIX}${scheduleId}:${wcode}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { studentName?: unknown; email?: unknown };
    const studentName = typeof parsed.studentName === 'string' ? parsed.studentName.trim() : '';
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';

    if (!studentName || !email) {
      return null;
    }

    return { studentName, email };
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
      return queryWcode.trim().toUpperCase();
    }

    return loadLastWcode(scheduleId) ?? '';
  }, [scheduleId, searchParams]);

  const [formData, setFormData] = useState<EntryFormData>({
    wcode: initialWcode,
    email:
      scheduleId && validateWcode(initialWcode)
        ? loadCandidateProfile(scheduleId, initialWcode)?.email ?? ''
        : '',
    studentName:
      scheduleId && validateWcode(initialWcode)
        ? loadCandidateProfile(scheduleId, initialWcode)?.studentName ?? ''
        : '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof EntryFormData, string>>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!scheduleId) {
      return;
    }

    const normalizedWcode = initialWcode.trim().toUpperCase();
    if (!normalizedWcode || !validateWcode(normalizedWcode)) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const attempts = await studentAttemptRepository.getAttemptsByScheduleId(scheduleId);
        const activeAttempt = attempts.find(
          (candidate) =>
            candidate.phase !== 'post-exam' &&
            candidate.candidateId.trim().toUpperCase() === normalizedWcode,
        );

        if (activeAttempt && !cancelled) {
          navigate(`/student/${scheduleId}/${normalizedWcode}`, { replace: true });
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

    if (field === 'wcode' && value && !validateWcode(value)) {
      setErrors((prev) => ({
        ...prev,
        wcode: 'Wcode must be in format W followed by 6 digits (e.g., W250334)',
      }));
    }

    if (field === 'email' && value && !validateEmail(value)) {
      setErrors((prev) => ({
        ...prev,
        email: 'Invalid email format',
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedWcode = formData.wcode.trim().toUpperCase();
    const normalizedEmail = formData.email.trim();
    const normalizedName = formData.studentName.trim();

    const newErrors: Partial<Record<keyof EntryFormData, string>> = {};

    if (!normalizedWcode || !validateWcode(normalizedWcode)) {
      newErrors.wcode = 'Wcode is required and must be in format W followed by 6 digits';
    }

    if (!normalizedEmail || !validateEmail(normalizedEmail)) {
      newErrors.email = 'Email is required and must be valid';
    }

    if (!normalizedName) {
      newErrors.studentName = 'Name is required';
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

    try {
      await studentEntry({
        scheduleId,
        wcode: normalizedWcode,
        email: normalizedEmail,
        studentName: normalizedName,
      });

      storeLastWcode(scheduleId, normalizedWcode);
      storeCandidateProfile(scheduleId, normalizedWcode, {
        studentName: normalizedName,
        email: normalizedEmail,
      });
      navigate(`/student/${scheduleId}/${normalizedWcode}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Check-in failed. Please try again.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Exam Check-in</h1>

        {submitError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="wcode" className="block text-sm font-medium text-gray-700 mb-2">
              Wcode
            </label>
            <input
              id="wcode"
              type="text"
              value={formData.wcode}
              onChange={(e) => handleInputChange('wcode', e.target.value.toUpperCase())}
              placeholder="W250334"
              className={`w-full px-3 py-2 border rounded-md ${
                errors.wcode ? 'border-red-300' : 'border-gray-300'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.wcode && <p className="mt-1 text-sm text-red-600">{errors.wcode}</p>}
            <p className="mt-1 text-xs text-gray-500">
              Format: W followed by 6 digits (e.g., W250334)
            </p>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              placeholder="student@example.com"
              className={`w-full px-3 py-2 border rounded-md ${
                errors.email ? 'border-red-300' : 'border-gray-300'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
          </div>

          <div>
            <label htmlFor="studentName" className="block text-sm font-medium text-gray-700 mb-2">
              Full Name
            </label>
            <input
              id="studentName"
              type="text"
              value={formData.studentName}
              onChange={(e) => handleInputChange('studentName', e.target.value)}
              placeholder="John Doe"
              className={`w-full px-3 py-2 border rounded-md ${
                errors.studentName ? 'border-red-300' : 'border-gray-300'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.studentName && (
              <p className="mt-1 text-sm text-red-600">{errors.studentName}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Checking in...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
