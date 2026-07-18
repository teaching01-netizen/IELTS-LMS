import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student footer in-flow layout ownership', () => {
  const studentModuleDirectory = resolve(__dirname, '..');
  const layoutContractPath = resolve(
    studentModuleDirectory,
    'studentFooterOverlayLayout.ts',
  );

  it('does not maintain a fixed-overlay clearance contract', () => {
    expect(existsSync(layoutContractPath)).toBe(false);
  });

  it.each([
    'StudentQuestionPanel.tsx',
    'StudentReading.tsx',
    'StudentListening.tsx',
    'StudentWriting.tsx',
  ])('%s does not compensate for an overlay footer', (filename) => {
    const source = readFileSync(resolve(studentModuleDirectory, filename), 'utf8');
    expect(source).not.toContain('STUDENT_FOOTER_SCROLL_CLEARANCE_STYLE');
  });
});
