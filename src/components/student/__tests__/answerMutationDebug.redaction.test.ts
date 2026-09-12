import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logInfo } from '../../../app/error/errorLogger';
import {
  emitAnswerMutationDebugLog,
  isAnswerMutationDebugEnabled,
  sanitizeAnswerMutationDebugContext,
} from '../answerMutationDebug';

vi.mock('../../../app/error/errorLogger', () => ({
  logInfo: vi.fn(),
}));

const mockedLogInfo = vi.mocked(logInfo);
const DEBUG_KEY = 'student.answerMutationDebug';

function enableDebug(): void {
  window.localStorage.setItem(DEBUG_KEY, '1');
}

function disableDebug(): void {
  window.localStorage.removeItem(DEBUG_KEY);
  try {
    window.sessionStorage.removeItem(DEBUG_KEY);
  } catch {
    // sessionStorage may be unavailable in some jsdom setups; the
    // localStorage removal above is the meaningful gate reset.
  }
}

function loggedPayloadJson(): string {
  return JSON.stringify(mockedLogInfo.mock.calls);
}

describe('answerMutationDebug redaction (WP7)', () => {
  beforeEach(() => {
    disableDebug();
    mockedLogInfo.mockClear();
  });

  it('is gated: no logInfo call unless the debug flag is enabled', () => {
    expect(isAnswerMutationDebugEnabled()).toBe(false);
    emitAnswerMutationDebugLog('StudentApp.handleAnswerChange', {
      questionId: 'q-1',
      incomingAnswer: 'SECRET-ANSWER',
    });
    expect(mockedLogInfo).not.toHaveBeenCalled();
  });

  it('never leaks the StudentApp.handleAnswerChange answer values', () => {
    enableDebug();
    emitAnswerMutationDebugLog('StudentApp.handleAnswerChange', {
      questionId: 'q-1',
      incomingAnswer: 'SECRET-INCOMING-ANSWER-a4f2',
      currentValue: 'SECRET-CURRENT-VALUE-a4f2',
      resolvedAnswer: 'SECRET-RESOLVED-ANSWER-a4f2',
      mutationMeta: {
        interactionType: 'typing',
        slotValue: 'SECRET-SLOT-VALUE-a4f2',
      },
    });

    expect(mockedLogInfo).toHaveBeenCalledTimes(1);
    const payload = loggedPayloadJson();
    expect(payload).not.toContain('SECRET-INCOMING-ANSWER-a4f2');
    expect(payload).not.toContain('SECRET-CURRENT-VALUE-a4f2');
    expect(payload).not.toContain('SECRET-RESOLVED-ANSWER-a4f2');
    expect(payload).not.toContain('SECRET-SLOT-VALUE-a4f2');
    // Identifier metadata survives; the interaction kind is safe metadata too.
    expect(payload).toContain('q-1');
    expect(payload).toContain('typing');
  });

  it('never leaks the QuestionRenderer.updateIndexedAnswer slot values', () => {
    enableDebug();
    emitAnswerMutationDebugLog('QuestionRenderer.updateIndexedAnswer', {
      blockType: 'table-completion',
      blockId: 'b-1',
      slotIndex: 2,
      slotId: 'slot-2',
      slotCount: 5,
      slotValue: 'SECRET-SLOT-TEXT-a4f2',
      nextAnswer: ['a', 'SECRET-NEXT-ANSWER-a4f2', 'c'],
      currentAnswer: ['SECRET-CURRENT-ANSWER-a4f2'],
    });

    expect(mockedLogInfo).toHaveBeenCalledTimes(1);
    const payload = loggedPayloadJson();
    expect(payload).not.toContain('SECRET-SLOT-TEXT-a4f2');
    expect(payload).not.toContain('SECRET-NEXT-ANSWER-a4f2');
    expect(payload).not.toContain('SECRET-CURRENT-ANSWER-a4f2');
    // Slot identifiers survive redaction.
    expect(payload).toContain('slot-2');
  });

  it('redacts sensitive keys deeply, including renamed/nested carriers', () => {
    const sanitized = sanitizeAnswerMutationDebugContext({
      questionId: 'q-9',
      nested: {
        response: { text: 'SECRET-NESTED-TEXT-a4f2', count: 3 },
        payload: ['SECRET-PAYLOAD-ITEM-a4f2'],
      },
      writeId: 'w-1',
    });

    const payload = JSON.stringify(sanitized);
    expect(payload).not.toContain('SECRET-NESTED-TEXT-a4f2');
    expect(payload).not.toContain('SECRET-PAYLOAD-ITEM-a4f2');
    expect(sanitized).toMatchObject({ questionId: 'q-9', writeId: 'w-1' });
  });

  it('redacts string/array payloads under unknown keys (conservative default)', () => {
    const sanitized = sanitizeAnswerMutationDebugContext({
      questionId: 'q-3',
      renamedAnswerCarrier: 'SECRET-RENAMED-CARRIER-a4f2',
      someList: ['SECRET-LIST-CARRIER-a4f2'],
      reason: 'version_collision',
    });

    const payload = JSON.stringify(sanitized);
    expect(payload).not.toContain('SECRET-RENAMED-CARRIER-a4f2');
    expect(payload).not.toContain('SECRET-LIST-CARRIER-a4f2');
    expect(sanitized).toMatchObject({ questionId: 'q-3', reason: 'version_collision' });
  });

  it('keeps reason codes but redacts free text placed under the allowlisted reason key', () => {
    // IDs-only contract: `reason` carries single-token failure codes only.
    const codes = sanitizeAnswerMutationDebugContext({ reason: 'VERSION_COLLISION' });
    expect(codes).toMatchObject({ reason: 'VERSION_COLLISION' });

    const freeText = sanitizeAnswerMutationDebugContext({
      reason: 'student wrote SECRET-REASON-FREETEXT-a4f2 as the answer',
    });
    expect(JSON.stringify(freeText)).not.toContain('SECRET-REASON-FREETEXT-a4f2');
    expect(freeText).toMatchObject({ reason: '[redacted]' });

    const multiline = sanitizeAnswerMutationDebugContext({
      reason: 'line1\nSECRET-REASON-MULTILINE-a4f2',
    });
    expect(JSON.stringify(multiline)).not.toContain('SECRET-REASON-MULTILINE-a4f2');
    expect(multiline).toMatchObject({ reason: '[redacted]' });
  });

  it('keeps IDs-only allowlisted keys while redacting answer markers in sibling/meta fields', () => {
    // Statically safe by caller shape: StudentApp.handleAnswerChange passes
    // the questionId map key (identifier), QuestionRenderer passes block.id /
    // slotId identifiers, writeIds are system-generated; the bounded
    // StudentAnswerMutationMeta shape (src/types/studentAttempt.ts) limits
    // interactionType/arrayUpdateMode to literals and its only free-text
    // field (slotValue) is redacted by NAME via /value/.
    const sanitized = sanitizeAnswerMutationDebugContext({
      questionId: 'q-ids-only',
      writeId: 'w-ids-only',
      slotId: 'slot-ids-only',
      reason: 'quarantine_archive_failed',
      mutationMeta: {
        interactionType: 'typing',
        arrayUpdateMode: 'replace',
        slotValue: 'SECRET-META-SLOTVALUE-a4f2',
      },
      incomingAnswer: 'SECRET-SIBLING-ANSWER-a4f2',
    });

    const payload = JSON.stringify(sanitized);
    expect(payload).toContain('q-ids-only');
    expect(payload).toContain('w-ids-only');
    expect(payload).toContain('slot-ids-only');
    expect(payload).toContain('quarantine_archive_failed');
    expect(payload).toContain('typing');
    expect(payload).toContain('replace');
    expect(payload).not.toContain('SECRET-META-SLOTVALUE-a4f2');
    expect(payload).not.toContain('SECRET-SIBLING-ANSWER-a4f2');
  });

  it('sanitizes the stage parameter so it can never split log lines', () => {
    enableDebug();
    // Known literal call sites pass through unchanged (StudentApp.tsx ~597,
    // QuestionRenderer.tsx ~168).
    emitAnswerMutationDebugLog('StudentApp.handleAnswerChange', { questionId: 'q-stage' });
    expect(mockedLogInfo).toHaveBeenCalledTimes(1);
    expect(String(mockedLogInfo.mock.calls[0]?.[0])).toContain('StudentApp.handleAnswerChange');

    mockedLogInfo.mockClear();
    emitAnswerMutationDebugLog('evil\nSECRET-STAGE-MARKER-a4f2\rstage', { questionId: 'q-stage-2' });
    expect(mockedLogInfo).toHaveBeenCalledTimes(1);
    const message = String(mockedLogInfo.mock.calls[0]?.[0]);
    expect(message).not.toContain('\n');
    expect(message).not.toContain('\r');
    // eslint-disable-next-line no-control-regex -- asserting no C0 controls survive.
    expect(message).not.toMatch(/[\x00-\x1F\x7F]/);
    // The marker text itself is a label, not answer content: stripping (not
    // redaction) is the sufficient hardening since stage is developer-set.
    expect(message).toContain('SECRET-STAGE-MARKER-a4f2');
  });
});
