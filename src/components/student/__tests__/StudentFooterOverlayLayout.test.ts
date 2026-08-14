import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student footer normal-flow layout ownership', () => {
  const studentModuleDirectory = resolve(__dirname, '..');
  const layoutContractPath = resolve(
    studentModuleDirectory,
    'studentFooterOverlayLayout.ts',
  );

  it('does not retain the obsolete overlay clearance helper', () => {
    expect(existsSync(layoutContractPath)).toBe(false);
    const appCss = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');
    expect(appCss).not.toContain('--student-exam-footer-clearance');
  });

  it.each([
    'StudentQuestionPanel.tsx',
    'StudentReading.tsx',
    'StudentListening.tsx',
    'StudentWriting.tsx',
  ])('%s does not calculate clearance for a floating footer', (filename) => {
    const source = readFileSync(resolve(studentModuleDirectory, filename), 'utf8');
    expect(source).not.toContain('STUDENT_FOOTER_SCROLL_CLEARANCE_STYLE');
    expect(source).not.toContain('studentFooterOverlayLayout');
    expect(source).not.toContain('--student-exam-footer-clearance');
  });
});
