import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuthSession } from "../../auth/api/authSession";
import { studentAttemptRepository } from "@student/application/studentAttemptFacade";
import {
  getStudentEntrySchedule,
  isStudentEntryScheduleBlockedError,
} from "../infrastructure/studentEntryGateway";
import { commonSchemas } from "@shared/lib/validateApiResponse";
import { entryQueueDelayMs, parseEntryQueueError } from "../infrastructure/studentEntryGateway";

interface EntryFormData {
  wcode: string;
  email: string;
  studentName: string;
  nickname: string;
  ieltsCourse: string;
}

const LAST_WCODE_STORAGE_PREFIX = "ielts-student-last-wcode:";
const PROFILE_STORAGE_PREFIX = "ielts-student-profile:";

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
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(`${LAST_WCODE_STORAGE_PREFIX}${scheduleId}`);
}

function storeLastWcode(scheduleId: string, wcode: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(`${LAST_WCODE_STORAGE_PREFIX}${scheduleId}`, wcode);
}

function storeCandidateProfile(
  scheduleId: string,
  wcode: string,
  profile: { studentName: string; email: string; nickname: string; ieltsCourse: string }
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    `${PROFILE_STORAGE_PREFIX}${scheduleId}:${wcode}`,
    JSON.stringify(profile)
  );
}

function loadCandidateProfile(
  scheduleId: string,
  wcode: string
): { studentName: string; email: string; nickname: string; ieltsCourse: string } | null {
  if (typeof window === "undefined") {
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
    const studentName = typeof parsed.studentName === "string" ? parsed.studentName.trim() : "";
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    const nickname = typeof parsed.nickname === "string" ? parsed.nickname.trim() : "";
    const ieltsCourse = typeof parsed.ieltsCourse === "string" ? parsed.ieltsCourse.trim() : "";

    if (!studentName || !email || !nickname || !ieltsCourse) {
      return null;
    }

    return { studentName, email, nickname, ieltsCourse };
  } catch {
    return null;
  }
}

const QUEUE_POLL_FLOOR_MS = 1000;

interface QueuePollFailure {
  message: string;
  attempts: number;
}

function queueEtaSeconds(retryAfterMs: number): number {
  const floored = Math.max(QUEUE_POLL_FLOOR_MS, retryAfterMs);
  return Math.max(1, Math.round(floored / 1000));
}

type ScheduleAvailability =
  | { state: "ready"; providerKey: "ielts" | "sat" | "act" }
  | { state: "unavailable"; title: string; description: string }
  | { state: "unknown" };

function scheduleStatusCopy(status: string): { title: string; description: string } {
  switch (status) {
    case "completed":
      return {
        title: "This exam has ended",
        description:
          "Entry for this schedule has closed. Ask your teacher if you still need access.",
      };
    case "cancelled":
      return {
        title: "This exam was cancelled",
        description: "Ask your teacher for a current check-in link.",
      };
    case "paused":
      return {
        title: "Entry is temporarily paused",
        description:
          "Your teacher can reopen entry for this schedule. You don\u2019t need a new URL.",
      };
    default:
      return {
        title: "This exam isn\u2019t open yet",
        description: "Come back when your teacher opens entry for this schedule.",
      };
  }
}

function scheduleBlockedCopy(): { title: string; description: string } {
  return {
    title: "This check-in link isn\u2019t available",
    description: "Ask your teacher for a current check-in link.",
  };
}

function isScheduleBlockedError(error: unknown): boolean {
  return isStudentEntryScheduleBlockedError(error);
}

async function loadScheduleAvailability(scheduleId: string): Promise<ScheduleAvailability> {
  try {
    const schedule = await getStudentEntrySchedule(scheduleId);
    // Registration is allowed before the proctor starts the runtime. The Go
    // registration transaction accepts both scheduled and live schedules;
    // only terminal/closed schedule states should hide the check-in form.
    if (
      schedule.status === "completed" ||
      schedule.status === "cancelled"
    ) {
      return { state: "unavailable", ...scheduleStatusCopy(schedule.status) };
    }
    return { state: "ready", providerKey: schedule.providerKey };
  } catch (error) {
    if (isScheduleBlockedError(error)) {
      return { state: "unavailable", ...scheduleBlockedCopy() };
    }
    return { state: "unknown" };
  }
}

export function StudentEntryRoute() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { studentEntry } = useAuthSession();

  // S3-C8/M1: direct entry branches by provider. A SAT schedule requires
  // only code + name + email (nickname/IELTS course are hidden and omitted
  // from the payload). Detection prefers the fetched schedule provider and
  // falls back to an explicit ?provider=sat override.
  const providerOverride = searchParams.get("provider") === "sat" ? "sat" : null;
  const [scheduleAvailability, setScheduleAvailability] = useState<ScheduleAvailability>({
    state: "unknown",
  });

  useEffect(() => {
    if (!scheduleId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const availability = await loadScheduleAvailability(scheduleId);
      if (!cancelled) {
        setScheduleAvailability(availability);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduleId]);

  const isSatSchedule =
    scheduleAvailability.state === "ready" && scheduleAvailability.providerKey === "sat";
  const isSat = providerOverride === "sat" || isSatSchedule;
  const courseLabel =
    scheduleAvailability.state === "ready" && scheduleAvailability.providerKey === "act"
      ? "Course"
      : "IELTS Course";
  const availabilityGate =
    scheduleAvailability.state === "unavailable" ? scheduleAvailability : null;

  const initialWcode = useMemo(() => {
    if (!scheduleId) {
      return "";
    }

    const queryWcode = searchParams.get("wcode");
    if (queryWcode) {
      return normalizeAccessCode(queryWcode);
    }

    const stored = loadLastWcode(scheduleId);
    return stored ? normalizeAccessCode(stored) : "";
  }, [scheduleId, searchParams]);

  const [formData, setFormData] = useState<EntryFormData>(
    () => ({
        wcode: initialWcode,
        email:
          scheduleId && initialWcode
            ? (loadCandidateProfile(scheduleId, initialWcode)?.email ?? "")
            : "",
        studentName:
          scheduleId && initialWcode
            ? (loadCandidateProfile(scheduleId, initialWcode)?.studentName ?? "")
            : "",
        nickname:
          scheduleId && initialWcode
            ? (loadCandidateProfile(scheduleId, initialWcode)?.nickname ?? "")
            : "",
        ieltsCourse:
          scheduleId && initialWcode
            ? (loadCandidateProfile(scheduleId, initialWcode)?.ieltsCourse ?? "")
            : "",
      })
  );
  const [errors, setErrors] = useState<Partial<Record<keyof EntryFormData, string>>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [queuedAdmission, setQueuedAdmission] = useState(false);
  const [queuedPayload, setQueuedPayload] = useState<EntryFormData | null>(null);
  const [queueRetryAfterMs, setQueueRetryAfterMs] = useState(QUEUE_POLL_FLOOR_MS);
  const submittingRef = useRef(false);
  const [queuePollFailure, setQueuePollFailure] = useState<QueuePollFailure | null>(null);
  const pollAttemptsRef = useRef(0);

  const mountSnapshotRef = useRef({
    initialWcode,
    scheduleId,
  });
  useEffect(() => {
    // Skip reset while the mounted schedule/wcode still matches the initial
    // form. Any in-place schedule/wcode change resets the retry payload and
    // queue state. Snapshot comparison keeps this correct under StrictMode
    // double-effect invocation.
    const snapshot = mountSnapshotRef.current;
    if (scheduleId === snapshot.scheduleId && initialWcode === snapshot.initialWcode) {
      return;
    }
    const profile =
      scheduleId && initialWcode ? loadCandidateProfile(scheduleId, initialWcode) : null;

    setFormData({
      wcode: initialWcode,
      email: profile?.email ?? "",
      studentName: profile?.studentName ?? "",
      nickname: profile?.nickname ?? "",
      ieltsCourse: profile?.ieltsCourse ?? "",
    });
    setErrors({});
    setSubmitError(null);
    setQueuedAdmission(false);
    setQueuedPayload(null);
    setQueueRetryAfterMs(QUEUE_POLL_FLOOR_MS);
    setQueuePollFailure(null);
    pollAttemptsRef.current = 0;
    mountSnapshotRef.current = { initialWcode, scheduleId };
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
            candidate.phase !== "post-exam" &&
            normalizeAccessCode(candidate.candidateId) === normalizedWcode
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
    setErrors((prev) => ({ ...prev, [field]: "" }));

    if (field === "email" && value && !validateEmail(value)) {
      setErrors((prev) => ({
        ...prev,
        email: "Invalid email format",
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
      newErrors.wcode = "Code is required";
    }

    if (!normalizedEmail || !validateEmail(normalizedEmail)) {
      newErrors.email = "Email is required and must be valid";
    }

    if (!normalizedName) {
      newErrors.studentName = "Name is required";
    }

    if (!isSat) {
      if (!normalizedNickname) {
        newErrors.nickname = "Nickname is required";
      } else if (normalizedNickname.length > 50) {
        newErrors.nickname = "Nickname must be 50 characters or less";
      }

      if (!normalizedIeltsCourse) {
        newErrors.ieltsCourse = `${courseLabel} is required`;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!scheduleId) {
      setSubmitError("Invalid schedule id");
      return;
    }

    if (isLoading || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsLoading(true);
    setSubmitError(null);
    setQueuedAdmission(false);
    setQueuedPayload(null);
    setQueueRetryAfterMs(QUEUE_POLL_FLOOR_MS);
    setQueuePollFailure(null);

    try {
      const result = await studentEntry({
        scheduleId,
        wcode: normalizedWcode,
        email: normalizedEmail,
        studentName: normalizedName,
        ...(isSat ? {} : { nickname: normalizedNickname, ieltsCourse: normalizedIeltsCourse }),
      });

      if ("state" in result && result.state === "queued") {
        const payload = {
          wcode: normalizedWcode,
          email: normalizedEmail,
          studentName: normalizedName,
          nickname: normalizedNickname,
          ieltsCourse: normalizedIeltsCourse,
        };
        pollAttemptsRef.current = 0;
        setQueuedAdmission(true);
        setQueuedPayload(payload);
        setQueueRetryAfterMs(entryQueueDelayMs(Math.ceil(result.pollAfterMs / 1000)));
        return;
      }

      setQueuedAdmission(false);
      setQueuedPayload(null);
      storeLastWcode(scheduleId, normalizedWcode);
      storeCandidateProfile(scheduleId, normalizedWcode, {
        studentName: normalizedName,
        email: normalizedEmail,
        nickname: normalizedNickname,
        ieltsCourse: normalizedIeltsCourse,
      });
      navigate(buildStudentRoute(scheduleId, normalizedWcode));
    } catch (error) {
      // Plan C3/D3: ENTRY_GATE 429s are bounded retry, not a server-owned
      // queue. Keep the submitted payload in memory and retry at the
      // server's Retry-After (jittered, never tight). Anything else surfaces.
      const queue = parseEntryQueueError(error);
      if (queue.queued) {
        const payload = {
          wcode: normalizedWcode,
          email: normalizedEmail,
          studentName: normalizedName,
          nickname: normalizedNickname,
          ieltsCourse: normalizedIeltsCourse,
        };
        pollAttemptsRef.current = 0;
        setQueuedAdmission(true);
        setQueuedPayload(payload);
        setQueueRetryAfterMs(entryQueueDelayMs(queue.retryAfterSecs));
        setSubmitError(null);
      } else {
        setSubmitError(error instanceof Error ? error.message : "Check-in failed. Please try again.");
      }
    } finally {
      submittingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleRetryQueue = () => {
    if (isLoading || !scheduleId || !queuedPayload) {
      return;
    }
    setSubmitError(null);
    setQueuePollFailure(null);
    setQueuedAdmission(true);
    setQueueRetryAfterMs(QUEUE_POLL_FLOOR_MS);
  };

  const handleLeaveQueue = () => {
    pollAttemptsRef.current = 0;
    setQueuedAdmission(false);
    setQueuedPayload(null);
    setQueueRetryAfterMs(QUEUE_POLL_FLOOR_MS);
    setQueuePollFailure(null);
    setSubmitError(null);
  };

  useEffect(() => {
    if (!scheduleId || !queuedAdmission || !queuedPayload || queuePollFailure) {
      return;
    }

    let cancelled = false;
    const pollAfterMs = Math.max(QUEUE_POLL_FLOOR_MS, queueRetryAfterMs);
    const timer = window.setTimeout(async () => {
      pollAttemptsRef.current += 1;
      try {
        const result = await studentEntry({
          scheduleId,
          wcode: queuedPayload.wcode,
          email: queuedPayload.email,
          studentName: queuedPayload.studentName,
          ...(isSat
            ? {}
            : { nickname: queuedPayload.nickname, ieltsCourse: queuedPayload.ieltsCourse }),
        });
        if (cancelled) {
          return;
        }
        if ("state" in result && result.state === "queued") {
          setQueuedAdmission(true);
          setQueueRetryAfterMs(entryQueueDelayMs(Math.ceil(result.pollAfterMs / 1000)));
          return;
        }

        setQueuedAdmission(false);
        setQueuedPayload(null);
        setQueuePollFailure(null);
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
          const queue = parseEntryQueueError(error);
          if (queue.queued) {
            setQueuedAdmission(true);
            setQueueRetryAfterMs(entryQueueDelayMs(queue.retryAfterSecs));
            setQueuePollFailure(null);
            setSubmitError(null);
            return;
          }
          const message =
            error instanceof Error ? error.message : "Admission retry failed. Please retry.";
          // A non-rate-limit poll failure must not dead-lock the form. Clear
          // the blocking retry state but keep the last submitted payload so
          // Retry can resume and Leave can discard it.
          setQueuedAdmission(false);
          setQueuePollFailure({ message, attempts: pollAttemptsRef.current });
          setSubmitError(message);
        }
      }
    }, pollAfterMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    isSat,
    navigate,
    queuePollFailure,
    queueRetryAfterMs,
    queuedAdmission,
    queuedPayload,
    scheduleId,
    studentEntry,
  ]);

  if (availabilityGate && !queuedAdmission && !queuePollFailure) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{availabilityGate.title}</h1>
          <p className="text-sm text-gray-600">{availabilityGate.description}</p>
        </div>
      </div>
    );
  }

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
          <div aria-live="polite" className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-700">
              High traffic; retrying in {queueEtaSeconds(queueRetryAfterMs)} seconds.
            </p>
            <p className="mt-1 text-xs text-blue-600">
              We&apos;ll retry automatically. You can leave and try again later.
            </p>
            <button
              type="button"
              onClick={handleLeaveQueue}
              className="mt-2 text-xs font-medium text-blue-700 underline hover:text-blue-900"
            >
              Leave and edit
            </button>
          </div>
        )}

        {queuePollFailure && (
          <div
            aria-live="polite"
            className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-md"
          >
            <p className="text-sm font-medium text-amber-800">
              Retry failed after {queuePollFailure.attempts}{" "}
              {queuePollFailure.attempts === 1 ? "attempt" : "attempts"}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              {queuePollFailure.message} Your details are still here — retry to try again or
              leave to edit the form.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleRetryQueue}
                className="bg-blue-600 text-white text-sm py-1.5 px-3 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={handleLeaveQueue}
                className="bg-white text-sm py-1.5 px-3 rounded-md border border-gray-300 hover:bg-gray-50"
              >
                Leave and edit
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="wcode" className="block text-sm font-medium text-gray-700 mb-2">
              Code
              <input
                id="wcode"
                type="text"
                value={formData.wcode}
                onChange={(e) => handleInputChange("wcode", e.target.value)}
                placeholder="Enter any code"
                aria-label="Code"
                disabled={isLoading || Boolean(queuedAdmission)}
                className={`mt-2 w-full px-3 py-2 border rounded-md ${
                  errors.wcode ? "border-red-300" : "border-gray-300"
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </label>
            {errors.wcode && <p className="mt-1 text-sm text-red-600">{errors.wcode}</p>}
            <p className="mt-1 text-xs text-gray-500">Enter any code for this exam.</p>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange("email", e.target.value)}
                placeholder="student@example.com"
                aria-label="Email"
                disabled={isLoading || Boolean(queuedAdmission)}
                className={`mt-2 w-full px-3 py-2 border rounded-md ${
                  errors.email ? "border-red-300" : "border-gray-300"
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
                onChange={(e) => handleInputChange("studentName", e.target.value)}
                placeholder="John Doe"
                aria-label="Full Name"
                disabled={isLoading || Boolean(queuedAdmission)}
                className={`mt-2 w-full px-3 py-2 border rounded-md ${
                  errors.studentName ? "border-red-300" : "border-gray-300"
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </label>
            {errors.studentName && (
              <p className="mt-1 text-sm text-red-600">{errors.studentName}</p>
            )}
          </div>

          {!isSat && (
            <>
              <div>
                <label htmlFor="nickname" className="block text-sm font-medium text-gray-700 mb-2">
                  Nickname
                  <input
                    id="nickname"
                    type="text"
                    value={formData.nickname}
                    onChange={(e) => handleInputChange("nickname", e.target.value)}
                    placeholder="Nickname"
                    aria-label="Nickname"
                    disabled={isLoading || Boolean(queuedAdmission)}
                    maxLength={50}
                    className={`mt-2 w-full px-3 py-2 border rounded-md ${
                      errors.nickname ? "border-red-300" : "border-gray-300"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </label>
                {errors.nickname && <p className="mt-1 text-sm text-red-600">{errors.nickname}</p>}
              </div>
              <div>
                <label
                  htmlFor="ieltsCourse"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  {courseLabel}
                  <input
                    id="ieltsCourse"
                    type="text"
                    value={formData.ieltsCourse}
                    onChange={(e) => handleInputChange("ieltsCourse", e.target.value)}
                    placeholder={courseLabel}
                    aria-label={courseLabel}
                    disabled={isLoading || Boolean(queuedAdmission)}
                    className={`mt-2 w-full px-3 py-2 border rounded-md ${
                      errors.ieltsCourse ? "border-red-300" : "border-gray-300"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </label>
                {errors.ieltsCourse && (
                  <p className="mt-1 text-sm text-red-600">{errors.ieltsCourse}</p>
                )}
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={isLoading || Boolean(queuedAdmission)}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {queuedAdmission
              ? "Waiting for Admission..."
              : isLoading
                ? "Checking in..."
                : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
