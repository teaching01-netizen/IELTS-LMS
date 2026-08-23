import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const scopeFiles = [
  'src/features/student/hooks/useStudentSessionRouteData.ts',
  'src/components/student/providers/StudentAttemptProvider.tsx',
  'src/features/admin/hooks/useAdminRootController.ts',
  'src/features/builder/hooks/useBuilderRouteController.ts',
  'src/features/builder/hooks/useConfigRouteController.ts',
  'src/features/proctor/hooks/useProctorRouteController.ts',
  'src/app/data/examQueries.ts',
  'src/app/data/proctorQueries.ts',
  'src/app/data/studentSessionQueries.ts',
];

const allowListPrefixes = [
  'src/features/student/infrastructure/',
  'src/features/builder/infrastructure/',
  'src/features/proctor/infrastructure/',
  'src/features/admin/infrastructure/',
  'src/services/',
];

const sourceFileExtensions = new Set(['.ts', '.tsx']);
const importPattern = /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;
const forbiddenImportPatterns = [
  /^@services\//,
  /^\.\.\/services\//,
  /^\.\.\/\.\.\/services\//,
  /^\.\.\/\.\.\/\.\.\/services\//,
  /^\.\.\/\.\.\/\.\.\/\.\.\/services\//,
];

type ImportViolation = {
  file: string;
  specifier: string;
};

function shouldSkipFile(relativePath: string): boolean {
  return relativePath.includes('/__tests__/') || relativePath.includes('.test.');
}

function isAllowListed(relativePath: string): boolean {
  return allowListPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function isForbiddenImport(specifier: string): boolean {
  return forbiddenImportPatterns.some((pattern) => pattern.test(specifier));
}

function collectViolations(): ImportViolation[] {
  const scannedFiles = scopeFiles
    .map((file) => file.replaceAll(path.sep, '/'))
    .filter((file) => sourceFileExtensions.has(path.extname(file)) && fs.existsSync(path.resolve(file)));
  const violations: ImportViolation[] = [];

  for (const relativePath of scannedFiles) {
    if (shouldSkipFile(relativePath) || isAllowListed(relativePath)) {
      continue;
    }
    const fileContent = fs.readFileSync(relativePath, 'utf8');
    for (const match of fileContent.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier || !isForbiddenImport(specifier)) {
        continue;
      }
      violations.push({ file: relativePath, specifier });
    }
  }

  return violations.sort((a, b) => `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`));
}

describe('frontend module boundaries', () => {
  it('blocks direct @services imports outside module infrastructure adapters', () => {
    const violations = collectViolations();
    expect(
      violations,
      violations.length === 0
        ? undefined
        : `Direct service imports must stay inside feature infrastructure adapters.\n${violations
            .map(({ file, specifier }) => `- ${file} -> ${specifier}`)
            .join('\n')}`,
    ).toEqual([]);
  });

  it('blocks raw API-client imports from feature modules', () => {
    // The HTTP transport is owned by src/services; features must consume
    // service functions instead of importing the shared client directly.
    const featuresRoot = path.resolve('src/features');
    const violations: ImportViolation[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!sourceFileExtensions.has(path.extname(entry.name))) {
          continue;
        }
        const relativePath = path.relative('.', full).replaceAll(path.sep, '/');
        if (shouldSkipFile(relativePath)) {
          continue;
        }
        const content = fs.readFileSync(full, 'utf-8');
        for (const match of content.matchAll(importPattern)) {
          const specifier = match[1] ?? '';
          if (/apiClient/.test(specifier) && specifier.includes('/app/api/')) {
            violations.push({ file: relativePath, specifier });
          }
        }
      }
    };

    walk(featuresRoot);
    expect(
      violations,
      violations.length === 0
        ? ''
        : `features must import transport only via src/services:\n${violations
            .map((v) => `  ${v.file} -> ${v.specifier}`)
            .join('\n')}`,
    ).toEqual([]);
  });
});
