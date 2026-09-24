/**
 * Classification for Student Link (/join/:accessLinkId) entry failures.
 *
 * The bot grid must never report a dead exam window as a mystery timeout.
 * Every failure carries a scope that decides what the runner does next:
 *
 * - `run`   nobody can join this link/schedule (exams completed, link ended or
 *           paused, registration closed). Retrying is pointless: abort the run
 *           and tell the operator what to fix on the server.
 * - `user`  this roster row can never join (code owned by another student,
 *           missing student code) but the rest of the roster still can.
 * - `transient` admission is genuinely time-dependent (admission queue, burst
 *           shedding, blank first paint): retry with backoff.
 */

export type SatJoinFailureScope = 'run' | 'user' | 'transient';

export interface SatJoinFailure {
  code: string;
  scope: SatJoinFailureScope;
  hint: string;
}

export interface SatJoinFailureRule extends SatJoinFailure {
  pattern: RegExp;
}

export const SAT_JOIN_FAILURE_RULES: readonly SatJoinFailureRule[] = [
  {
    pattern: /registration is closed/i,
    code: 'SAT_SCHEDULE_REGISTRATION_CLOSED',
    scope: 'run',
    hint:
      'The schedule behind this Student Link is completed or cancelled. Entry is accepted only while exam_schedules.status is scheduled or live. Open (or create) a schedule for the exam, start the SAT session from the proctor UI, then rerun.',
  },
  {
    pattern: /no longer active/i,
    code: 'SAT_LINK_NOT_ACTIVE',
    scope: 'run',
    hint: 'Revoked or expired Student Link. Publish a current link for this exam and rerun with its /join/<accessLinkId> URL.',
  },
  {
    pattern: /this link has ended|link has ended|entry closed|registration has ended/i,
    code: 'SAT_LINK_ENDED',
    scope: 'run',
    hint: 'The Student Link is past its closesAt window. Publish a new link (or widen the window) and rerun.',
  },
  {
    pattern: /temporarily paused/i,
    code: 'SAT_LINK_PAUSED',
    scope: 'run',
    hint: 'A proctor paused entry for this link. Resume it (the same URL works again) and rerun.',
  },
  {
    pattern: /isn[’']?t open yet|not open yet/i,
    code: 'SAT_LINK_NOT_OPEN_YET',
    scope: 'run',
    hint: 'The link opens on a schedule. Rerun once its opensAt time has passed.',
  },
  {
    pattern: /already registered for this schedule|is locked for this registration/i,
    code: 'SAT_REGISTRATION_CONFLICT',
    scope: 'user',
    hint: 'The student code is already tied to a different name or email. Give this roster row its own student code (or restore the original name/email) and rerun.',
  },
  {
    pattern: /student code is required/i,
    code: 'SAT_STUDENT_CODE_REQUIRED',
    scope: 'user',
    hint: 'This link is student_code scoped but the roster row has no candidateId. Fill the candidateId column for this student.',
  },
];

export function classifySatJoinText(text: string): SatJoinFailure | null {
  const value = text ?? '';
  if (!value.trim()) return null;
  for (const rule of SAT_JOIN_FAILURE_RULES) {
    if (rule.pattern.test(value)) {
      return { code: rule.code, scope: rule.scope, hint: rule.hint };
    }
  }
  return null;
}

export class SatJoinError extends Error {
  readonly code: string;
  readonly scope: SatJoinFailureScope;
  readonly hint: string;

  constructor(failure: SatJoinFailure, detail: string) {
    super(`${failure.code}: ${detail}`);
    this.name = 'SatJoinError';
    this.code = failure.code;
    this.scope = failure.scope;
    this.hint = failure.hint;
  }
}

export function isSatJoinError(error: unknown): error is SatJoinError {
  return error instanceof SatJoinError;
}

/** Builds a satJoinError from page copy, or null when the copy is not decisive. */
export function satJoinErrorFromText(text: string, detail: string): SatJoinError | null {
  const failure = classifySatJoinText(text);
  return failure ? new SatJoinError(failure, detail) : null;
}

/** One-line operator guidance for an aborted run. */
export function satJoinFailureHint(error: SatJoinError): string {
  return `${error.code} — ${error.hint}`;
}
