import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const scopeRoots = [
  'src/features/student',
  'src/features/builder',
  'src/features/proctor',
  'src/features/admin',
  'src/components/student/providers',
  'src/app/data',
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

function walk(rootRelativePath: string): string[] {
  const rootAbsolutePath = path.resolve(rootRelativePath);
  if (!fs.existsSync(rootAbsolutePath)) {
    return [];
  }

  const files: string[] = [];
  const entries = fs.readdirSync(rootAbsolutePath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootAbsolutePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path.relative(process.cwd(), absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const extension = path.extname(entry.name);
    if (!sourceFileExtensions.has(extension)) {
      continue;
    }
    files.push(path.relative(process.cwd(), absolutePath).replaceAll(path.sep, '/'));
  }
  return files;
}

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
  const scannedFiles = scopeRoots.flatMap((root) => walk(root));
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
});
