import { describe, expect, it } from 'vitest';
import { isStudentHighlightToolContextActive } from '../studentHighlightToolContext';

describe('isStudentHighlightToolContextActive', () => {
  it('allows only unblocked idle Reading and Listening exam contexts', () => {
    const base = { phase: 'exam', blockingReason: null, submitConfirmOpen: false, finalSubmitIdle: true } as const;
    expect(isStudentHighlightToolContextActive({ ...base, module: 'reading' })).toBe(true);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'listening' })).toBe(true);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'writing' })).toBe(false);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'reading', phase: 'post-exam' })).toBe(false);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'reading', blockingReason: 'proctor_paused' })).toBe(false);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'reading', submitConfirmOpen: true })).toBe(false);
    expect(isStudentHighlightToolContextActive({ ...base, module: 'reading', finalSubmitIdle: false })).toBe(false);
  });
});
