/**
 * Shared SAT Study-mode and answer-key contract.
 *
 * This is the single frontend type/schema boundary for the policy a teacher
 * saves on one activity (a classroom assignment or a Standard Practice
 * schedule) and for the immutable snapshot bound to one admitted attempt.
 * Mirrors `backend/go/internal/satlearning/contracts.go`; the two files must
 * agree on names, defaults, and numeric bounds.
 *
 * Invariants:
 * - `requiredCompletions` is a whole number in 1..2147483647.
 * - `revision` is a nonnegative safe JSON integer; the server owns increments.
 * - Study cannot be enabled without at least one permitted capability.
 * - Answer keys cannot be released through a hidden report.
 * - A Test attempt always binds zero study capabilities, whatever the live
 *   policy says.
 */

export type SatAttemptMode = "test" | "study";

export type SatStudyPermissions = {
  enabled: boolean;
  requiredCompletions: number;
  revealAnswers: boolean;
  untimed: boolean;
};

export type SatActivityPolicy = {
  revision: number;
  reportVisible: boolean;
  includeAnswerKeyInPdf: boolean;
  unlimitedRetakes?: boolean;
  pauseOnLeave?: boolean;
  study: SatStudyPermissions;
};

export type SatStudyCapabilities = {
  revealAnswers: boolean;
  untimed: boolean;
};

export type SatStudyEligibilityReason =
  | "disabled"
  | "completion_required"
  | "active_attempt"
  | "starts_closed"
  | null;

export type SatStudyEligibility = {
  completedTestAttempts: number;
  requiredCompletions: number;
  eligible: boolean;
  canStart: boolean;
  reason: SatStudyEligibilityReason;
  capabilities: SatStudyCapabilities;
};

export type SatAttemptLearning = {
  mode: SatAttemptMode;
  policyRevision: number;
  capabilities: SatStudyCapabilities;
};

/**
 * One authorized current-question key projection. `label` is the delivered
 * choice letter for single choice and empty for student-produced responses;
 * `text` is the choice text or one accepted response representation.
 */
export type SatAnswerKeyAnswer = {
  label: string;
  text: string;
};

export type SatAnswerKey = {
  examQuestionId: string;
  moduleId: string;
  responseRevision: number;
  kind: "single_choice" | "student_produced_response";
  correctAnswers: SatAnswerKeyAnswer[];
  result: "correct" | "incorrect" | "unanswered";
};

export const SAT_STUDY_DEFAULT_COMPLETIONS = 1;
export const SAT_STUDY_MAX_COMPLETIONS = 2147483647;
export const SAT_POLICY_MAX_REVISION = Number.MAX_SAFE_INTEGER;

export const SAT_ACTIVITY_POLICY_DEFAULTS: SatActivityPolicy = {
  revision: 0,
  reportVisible: false,
  includeAnswerKeyInPdf: false,
  study: {
    enabled: false,
    requiredCompletions: SAT_STUDY_DEFAULT_COMPLETIONS,
    revealAnswers: true,
    untimed: true,
  },
};

export type SatPolicyValidation =
  | { ok: true; value: SatActivityPolicy }
  | { ok: false; message: string; field: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isSafeWholeNumber(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function invalid(field: string, message: string): SatPolicyValidation {
  return { ok: false, field, message };
}

/**
 * Validate and normalize a policy write. The result is canonical: hidden
 * reports force PDF keys off, so no caller can request key material behind a
 * closed report. Disabled Study keeps its preference values, and the revision
 * is echoed for optimistic concurrency (the server ignores caller-supplied
 * revisions on create).
 */
export function normalizeSatActivityPolicy(input: unknown): SatPolicyValidation {
  if (!isRecord(input)) {
    return invalid("policy", "Choose a valid learning policy.");
  }
  const candidate = input as {
    revision?: unknown;
    reportVisible?: unknown;
    includeAnswerKeyInPdf?: unknown;
    unlimitedRetakes?: unknown;
    pauseOnLeave?: unknown;
    study?: unknown;
  };
  const revision = candidate.revision;
  if (!isSafeWholeNumber(revision, 0, SAT_POLICY_MAX_REVISION)) {
    return invalid("revision", "The policy revision must be a nonnegative whole number.");
  }
  if (!isBoolean(candidate.reportVisible)) {
    return invalid("reportVisible", "Choose whether students can see their report.");
  }
  if (!isBoolean(candidate.includeAnswerKeyInPdf)) {
    return invalid("includeAnswerKeyInPdf", "Choose whether the PDF includes answer keys.");
  }
  if (candidate.unlimitedRetakes !== undefined && !isBoolean(candidate.unlimitedRetakes)) {
    return invalid("unlimitedRetakes", "Choose whether timed retakes are unlimited.");
  }
  if (candidate.pauseOnLeave !== undefined && !isBoolean(candidate.pauseOnLeave)) {
    return invalid("pauseOnLeave", "Choose whether students can pause and leave.");
  }
  const studyRaw = candidate.study;
  if (!isRecord(studyRaw)) {
    return invalid("study", "Choose the Study mode settings.");
  }
  const study = studyRaw as {
    enabled?: unknown;
    revealAnswers?: unknown;
    untimed?: unknown;
    requiredCompletions?: unknown;
  };
  if (!isBoolean(study.enabled)) {
    return invalid("study.enabled", "Choose whether Study mode is allowed.");
  }
  if (!isBoolean(study.revealAnswers)) {
    return invalid("study.revealAnswers", "Choose whether students can reveal answers.");
  }
  if (!isBoolean(study.untimed)) {
    return invalid("study.untimed", "Choose whether Study mode removes the time limit.");
  }
  if (!isSafeWholeNumber(study.requiredCompletions, 1, SAT_STUDY_MAX_COMPLETIONS)) {
    return invalid(
      "study.requiredCompletions",
      `Unlock after a whole number of completed attempts between 1 and ${SAT_STUDY_MAX_COMPLETIONS}.`
    );
  }
  if (study.enabled && !study.revealAnswers && !study.untimed) {
    return invalid(
      "study",
      "Allow students to reveal answers, remove the time limit, or turn Study mode off."
    );
  }
  const reportVisible = candidate.reportVisible;
  return {
    ok: true,
    value: {
      revision,
      reportVisible,
      ...(candidate.unlimitedRetakes === undefined ? {} : { unlimitedRetakes: candidate.unlimitedRetakes }),
      ...(candidate.pauseOnLeave === undefined ? {} : { pauseOnLeave: candidate.pauseOnLeave }),
      // A hidden report can never release keys, even if the client kept a
      // stale checkbox state from before the report was turned off.
      includeAnswerKeyInPdf: reportVisible ? candidate.includeAnswerKeyInPdf : false,
      study: {
        enabled: study.enabled,
        requiredCompletions: study.requiredCompletions,
        revealAnswers: study.revealAnswers,
        untimed: study.untimed,
      },
    },
  };
}

/** Capabilities a Study start would receive under this policy. */
export function satStudyCapabilities(policy: SatActivityPolicy): SatStudyCapabilities {
  if (!policy.study.enabled) {
    return { revealAnswers: false, untimed: false };
  }
  return {
    revealAnswers: policy.study.revealAnswers === true,
    untimed: policy.study.untimed === true,
  };
}

/**
 * Project measured eligibility. `completedTestAttempts` must come from the
 * server; a failed read is an error state, never zero. `eligible` answers the
 * threshold question while `canStart` also reflects the start window and an
 * already-active attempt. Capabilities describe a new Study start and are
 * withheld until the threshold is met.
 */
export function deriveSatStudyEligibility(args: {
  policy: SatActivityPolicy;
  completedTestAttempts: number;
  activeAttempt: boolean;
  startsOpen: boolean;
}): SatStudyEligibility {
  const { policy, completedTestAttempts, activeAttempt, startsOpen } = args;
  const requiredCompletions = policy.study.requiredCompletions;
  const base = {
    completedTestAttempts,
    requiredCompletions,
    capabilities: { revealAnswers: false, untimed: false } as SatStudyCapabilities,
  };
  if (!policy.study.enabled) {
    return { ...base, eligible: false, canStart: false, reason: "disabled" };
  }
  const eligible = completedTestAttempts >= requiredCompletions;
  if (!eligible) {
    return { ...base, eligible: false, canStart: false, reason: "completion_required" };
  }
  const capabilities = satStudyCapabilities(policy);
  if (activeAttempt) {
    return { ...base, eligible: true, canStart: false, reason: "active_attempt", capabilities };
  }
  if (!startsOpen) {
    return { ...base, eligible: true, canStart: false, reason: "starts_closed", capabilities };
  }
  return { ...base, eligible: true, canStart: true, reason: null, capabilities };
}

/** Every Test admission binds the same answer-free, untimed-free snapshot. */
export function testAttemptLearning(policyRevision: number): SatAttemptLearning {
  return {
    mode: "test",
    policyRevision,
    capabilities: { revealAnswers: false, untimed: false },
  };
}

/** Study admission binds the capabilities the teacher enabled at admission. */
export function studyAttemptLearning(
  policy: SatActivityPolicy,
  policyRevision = policy.revision
): SatAttemptLearning {
  return {
    mode: "study",
    policyRevision,
    capabilities: satStudyCapabilities(policy),
  };
}

/** Minimal shape check for a server answer-key projection. */
export function isSatAnswerKey(value: unknown): value is SatAnswerKey {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<SatAnswerKey>;
  if (typeof candidate.examQuestionId !== "string" || candidate.examQuestionId === "") return false;
  if (typeof candidate.moduleId !== "string") return false;
  if (!isSafeWholeNumber(candidate.responseRevision, 0, SAT_POLICY_MAX_REVISION)) return false;
  if (candidate.kind !== "single_choice" && candidate.kind !== "student_produced_response") {
    return false;
  }
  if (
    candidate.result !== "correct" &&
    candidate.result !== "incorrect" &&
    candidate.result !== "unanswered"
  ) {
    return false;
  }
  if (!Array.isArray(candidate.correctAnswers)) return false;
  return candidate.correctAnswers.every(
    (answer) =>
      isRecord(answer) &&
      typeof (answer as SatAnswerKeyAnswer).label === "string" &&
      typeof (answer as SatAnswerKeyAnswer).text === "string" &&
      ((answer as SatAnswerKeyAnswer).text !== "" ||
        candidate.kind === "student_produced_response")
  );
}
