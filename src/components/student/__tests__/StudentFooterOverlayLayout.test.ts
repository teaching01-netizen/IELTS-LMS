import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student footer overlay layout ownership', () => {
  const studentModuleDirectory = resolve(__dirname, '..');
  const layoutContractPath = resolve(
    studentModuleDirectory,
    'studentFooterOverlayLayout.ts',
  );

  it('keeps end clearance in one shared scroll-owner contract', () => {
    expect(existsSync(layoutContractPath)).toBe(true);
    const contract = readFileSync(layoutContractPath, 'utf8');
    expect(contract).toContain('STUDENT_FOOTER_SCROLL_CLEARANCE_STYLE');
    expect(contract).toMatch(
      /paddingBottom:\s*'var\(--student-exam-footer-clearance\)'/,
    );
    expect(contract).toMatch(
      /scrollPaddingBottom:\s*'var\(--student-exam-footer-clearance\)'/,
    );
  });

  it.each([
    'StudentQuestionPanel.tsx',
    'StudentReading.tsx',
    'StudentListening.tsx',
    'StudentWriting.tsx',
  ])('%s consumes the shared scroll clearance', (filename) => {
    const source = readFileSync(resolve(studentModuleDirectory, filename), 'utf8');
    expect(source).toContain('STUDENT_FOOTER_SCROLL_CLEARANCE_STYLE');
  });
});
