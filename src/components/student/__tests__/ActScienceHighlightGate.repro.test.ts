import { describe, expect, it } from 'vitest';
import { isStudentHighlightToolContextActive } from '../studentHighlightToolContext';

describe('ACT science highlight gate', () => {
  const base = { phase: 'exam', blockingReason: null, submitConfirmOpen: false, finalSubmitIdle: true } as const;
  it('keeps highlight/erase mode alive in the ACT science module', () => {
    // Regression: science was missing from the capable-context allowlist, so the
    // StudentApp reset effect forced highlightToolMode back to 'off' on the next
    // render after the user enabled highlight or erase.
    expect(isStudentHighlightToolContextActive({ ...base, module: 'science' })).toBe(true);
  });

  it('still gates non-capable contexts', () => {
    expect(isStudentHighlightToolContextActive({ ...base, module: 'speaking' })).toBe(false);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'science', phase: 'post-exam' })).toBe(false);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'science', blockingReason: 'proctor_paused' })).toBe(false);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'science', submitConfirmOpen: true })).toBe(false);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'science', finalSubmitIdle: false })).toBe(false);
  });
});
