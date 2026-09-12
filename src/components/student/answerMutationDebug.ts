import { logInfo } from '../../app/error/errorLogger';

const ANSWER_MUTATION_DEBUG_KEY = 'student.answerMutationDebug';
const ANSWER_MUTATION_DEBUG_TAG = '[DEBUG-a4f2]';

// WP7 (privacy-safe observability): answer content must never reach logs or
// telemetry. Fields are redacted by NAME, deeply and conservatively, before
// anything is handed to logInfo. Only stage + identifier/reason metadata
// survive; every other scalar payload is replaced with '[redacted]'.
const REDACTED = '[redacted]';
const SENSITIVE_KEY_PATTERN = /answer|value|response|text|payload/i;

// Allowlist of metadata keys whose scalar values are safe to keep.
// IDs-ONLY contract: these keys carry identifiers and bounded reason/literal
// codes — never free text and never answer content:
// - questionId/writeId/blockId/slotId: question/write/block/slot identifiers
//   (StudentApp.handleAnswerChange passes the questionId map key;
//   QuestionRenderer passes block.id/slotId identifiers; writeIds are
//   system-generated).
// - reason: failure-reason CODES only (single tokens such as
//   VERSION_COLLISION / version_collision / quarantine_archive_failed).
//   Free text is redacted fail-closed (see REASON_CODE_PATTERN).
// - stage/blockType/interactionType/arrayUpdateMode: bounded literals
//   (interactionType/arrayUpdateMode are bounded by the
//   StudentAnswerMutationMeta shape in src/types/studentAttempt.ts; the meta
//   free-text field slotValue is redacted by NAME via /value/).
// - slotIndex/slotCount: numbers.
const METADATA_KEY_ALLOWLIST = new Set([
  'stage',
  'questionId',
  'writeId',
  'blockType',
  'blockId',
  'slotIndex',
  'slotId',
  'slotCount',
  'reason',
  'interactionType',
  'arrayUpdateMode',
]);

// `reason` codes are single tokens; anything with whitespace/control
// characters is free text, not a code.
const REASON_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;

// Expected stage literals (both emit call sites pass literals today:
// StudentApp.tsx handleAnswerChange, QuestionRenderer.tsx
// updateIndexedAnswer). Unknown stages are still logged but stripped of
// control characters/newlines so a stage value can never split log lines.
const STAGE_ALLOWLIST = new Set([
  'StudentApp.handleAnswerChange',
  'QuestionRenderer.updateIndexedAnswer',
]);

function sanitizeStage(stage: string): string {
  if (STAGE_ALLOWLIST.has(stage)) {
    return stage;
  }
  // eslint-disable-next-line no-control-regex -- stripping C0 controls is the point.
  return String(stage).replace(/[\x00-\x1F\x7F\u2028\u2029]/g, '');
}

function readStorageFlag(storage: Storage): boolean {
  try {
    const value = storage.getItem(ANSWER_MUTATION_DEBUG_KEY);
    return value === '1' || value === 'true' || value === 'on';
  } catch {
    return false;
  }
}

export function isAnswerMutationDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return readStorageFlag(window.localStorage) || readStorageFlag(window.sessionStorage);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function sanitizeValue(key: string, value: unknown, depth: number): unknown {
  if (depth > 10) {
    return REDACTED;
  }
  if (isSensitiveKey(key)) {
    return REDACTED;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return REDACTED;
  }
  if (typeof value === 'object') {
    if (value instanceof Date || value instanceof RegExp) {
      return REDACTED;
    }
    const out: Record<string, unknown> = {};
    for (const [entryKey, entry] of Object.entries(value as Record<string, unknown>)) {
      out[entryKey] = sanitizeValue(entryKey, entry, depth + 1);
    }
    return out;
  }
  // Scalar payload: keep it only for allowlisted metadata keys; every other
  // carrier (including numbers/booleans under unknown keys) is redacted so a
  // renamed answer field can never leak student work into logs.
  if (METADATA_KEY_ALLOWLIST.has(key)) {
    // `reason` keeps codes only; free text under the allowlisted `reason`
    // key fails closed. Other allowlisted keys are proven IDs-only /
    // bounded literals by caller shape (see METADATA_KEY_ALLOWLIST).
    if (key === 'reason' && typeof value === 'string' && !REASON_CODE_PATTERN.test(value)) {
      return REDACTED;
    }
    return value;
  }
  return REDACTED;
}

export function sanitizeAnswerMutationDebugContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    sanitized[key] = sanitizeValue(key, value, 0);
  }
  return sanitized;
}

export function emitAnswerMutationDebugLog(
  stage: string,
  context: Record<string, unknown>,
): void {
  if (!isAnswerMutationDebugEnabled()) {
    return;
  }

  logInfo(`${ANSWER_MUTATION_DEBUG_TAG} ${sanitizeStage(stage)}`, sanitizeAnswerMutationDebugContext(context));
}
