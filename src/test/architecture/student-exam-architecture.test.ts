import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const requiredArchitectureFiles = [
  'src/features/student/domain/exam-session/studentExamPhase.ts',
  'src/features/student/domain/exam-session/deriveStudentPhase.ts',
  'src/features/student/domain/exam-session/runtimeReconciliation.ts',
  'src/features/student/domain/exam-session/blockingPolicy.ts',
  'src/features/student/domain/exam-session/submissionPolicy.ts',
  'src/features/student/application/exam-session/studentExamStoreFactory.ts',
  'src/features/student/application/exam-session/studentExamStore.ts',
  'src/features/student/application/exam-session/createStudentExamSession.ts',
  'src/features/student/application/exam-session/answerCommands.ts',
  'src/features/student/application/exam-session/navigationCommands.ts',
  'src/features/student/application/exam-session/reconcileServerSnapshot.ts',
  'src/features/student/application/exam-session/studentSessionBootstrap.ts',
  'src/features/student/application/exam-session/StudentAttemptController.ts',
  'src/features/student/application/exam-session/submissionCommands.ts',
  'src/features/student/contracts/exam-session/StudentAttemptStore.ts',
  'src/features/student/contracts/exam-session/StudentDurabilityPort.ts',
  'src/features/student/contracts/exam-session/StudentPlatformMonitor.ts',
  'src/features/student/contracts/exam-session/StudentPlatformPort.ts',
  'src/features/student/contracts/exam-session/StudentRealtimePort.ts',
  'src/features/student/infrastructure/exam-session/studentRealtimeCoordinator.ts',
  'src/features/student/infrastructure/exam-session/studentMutationOutboxAdapter.ts',
  'src/features/student/infrastructure/exam-session/studentAttemptDurabilityAdapter.ts',
  'src/features/student/infrastructure/exam-session/platform/BrowserNetworkMonitor.ts',
  'src/features/student/infrastructure/exam-session/platform/BrowserVisibilityMonitor.ts',
  'src/features/student/hooks/exam-session/StudentExamSessionProvider.tsx',
  'src/features/student/hooks/exam-session/useExamBlocking.ts',
];

const sourceExtensions = new Set(['.ts', '.tsx']);
const forbiddenDomainImports = [
  /from ['"]react(?:\/|['"])/,
  /from ['"]react-dom(?:\/|['"])/,
  /from ['"]@tanstack\//,
  /from ['"]@services\//,
  /from ['"](?:\.\.\/)+services\//,
  /from ['"](?:\.\.\/)+components\//,
];
const browserGlobalUsage = /\b(?:window|document|navigator|localStorage|sessionStorage)\s*\./;
const intentionalCompatibilityAdapters = new Set([
  'src/components/student/providers/StudentAttemptProvider.tsx',
]);
const forbiddenApplicationImports = [
  /from ['"]react(?:\/|['"])/,
  /from ['"]react-dom(?:\/|['"])/,
  /from ['"]@components\//,
  /from ['"](?:\.\.\/)+components\//,
];

function readSourceFiles(root: string): string[] {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    const absolutePath = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...readSourceFiles(path.relative(process.cwd(), absolutePath)));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(path.relative(process.cwd(), absolutePath).replaceAll(path.sep, '/'));
    }
  }
  return files;
}

function isTestSourceFile(file: string): boolean {
  return file.includes('/__tests__/') || file.includes('.test.');
}

describe('student exam architecture', () => {
  it('contains the planned domain/application/port/coordinator seams', () => {
    const missing = requiredArchitectureFiles.filter((file) => !fs.existsSync(path.resolve(file)));
    expect(missing).toEqual([]);
  });

  it('keeps domain code independent of UI, services, and browser globals', () => {
    const violations: string[] = [];
    for (const file of readSourceFiles('src/features/student/domain')) {
      if (isTestSourceFile(file)) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      if (forbiddenDomainImports.some((pattern) => pattern.test(source))) {
        violations.push(`${file}: forbidden import`);
      }
      if (browserGlobalUsage.test(source)) {
        violations.push(`${file}: browser global`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps application code independent of React UI and browser globals', () => {
    const violations: string[] = [];
    for (const file of readSourceFiles('src/features/student/application')) {
      if (isTestSourceFile(file)) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      if (forbiddenApplicationImports.some((pattern) => pattern.test(source))) {
        violations.push(`${file}: forbidden UI import`);
      }
      if (browserGlobalUsage.test(source)) {
        violations.push(`${file}: browser global`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not make StudentApp correctness depend on DOM event synthesis', () => {
    const files = [
      'src/components/student/StudentApp.tsx',
      'src/components/student/useStudentSubmissionOrchestration.ts',
    ];
    const forbiddenPatterns = [
      /querySelectorAll\s*\(/,
      /dispatchEvent\s*\(\s*new\s+Event\s*\(\s*['"](?:input|change)['"]/,
      /dispatchEvent\s*\(\s*new\s+FocusEvent\s*\(\s*['"]blur['"]/,
      /fetch\s*\(/,
    ];
    const violations = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return forbiddenPatterns.some((pattern) => pattern.test(source)) ? [file] : [];
    });
    expect(violations).toEqual([]);
  });

  it('keeps student UI files off global service internals', () => {
    const violations: string[] = [];
    for (const file of readSourceFiles('src/components/student')) {
      if (isTestSourceFile(file)) {
        continue;
      }
      if (intentionalCompatibilityAdapters.has(file)) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      if (
        /from ['"]@services\//.test(source) ||
        /from ['"](?:\.\.\/)+services\//.test(source) ||
        /studentAttemptRepository|studentMutationOutbox|indexedDB/i.test(source)
      ) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps student routes on feature facades rather than service internals', () => {
    const violations: string[] = [];
    for (const file of readSourceFiles('src/features/student/routes')) {
      if (isTestSourceFile(file)) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      if (/from ['"]@services\//.test(source) || /from ['"](?:\.\.\/)+services\//.test(source)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
