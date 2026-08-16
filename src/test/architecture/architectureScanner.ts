import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

export type SourceImport = Readonly<{
  specifier: string;
  target: string | null;
}>;

export type ArchitectureRuleName =
  | 'layer-dependencies'
  | 'feature-isolation'
  | 'domain-purity'
  | 'legacy-services'
  | 'forbidden-browser-boundaries';

export type ArchitectureViolation = Readonly<{
  rule: ArchitectureRuleName;
  file: string;
  detail: string;
}>;

const sourceFileExtensions = new Set(['.ts', '.tsx']);
const moduleAliases = [
  { prefix: '@app/', root: 'src/app/' },
  { prefix: '@components/', root: 'src/components/' },
  { prefix: '@services/', root: 'src/services/' },
  { prefix: '@shared/', root: 'src/shared/' },
  { prefix: '@admin/', root: 'src/features/admin/' },
  { prefix: '@builder/', root: 'src/features/builder/' },
  { prefix: '@proctor/', root: 'src/features/proctor/' },
  { prefix: '@student/', root: 'src/features/student/' },
] as const;
const frameworkPackagePrefixes = [
  'react',
  'react-dom',
  'react-router-dom',
  '@tanstack/',
  'zustand',
] as const;
const browserBoundaryPackagePrefixes = ['react', 'react-dom', 'react-router-dom', '@tanstack/'] as const;
const browserGlobalPattern = /\b(window|document|navigator|localStorage|sessionStorage)\b/g;

function toProjectPath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replaceAll(path.sep, '/');
}

function normalizeImportTarget(absolutePath: string): string {
  return toProjectPath(absolutePath)
    .replace(/\.(?:tsx?|jsx?)$/, '')
    .replace(/\/index$/, '');
}

function isProductionSourceFile(relativePath: string): boolean {
  return (
    !relativePath.includes('/__tests__/') &&
    !relativePath.includes('.test.') &&
    !relativePath.includes('.stories.') &&
    !relativePath.startsWith('src/stories/') &&
    !relativePath.startsWith('src/test/')
  );
}

export function isPathUnder(file: string, root: string): boolean {
  return file === root || file.startsWith(`${root}/`);
}

export function featureName(file: string): string | null {
  const match = /^src\/features\/([^/]+)\//.exec(file);
  return match?.[1] ?? null;
}

function isPackageFromPrefixes(specifier: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) =>
    prefix.endsWith('/')
      ? specifier.startsWith(prefix)
      : specifier === prefix || specifier.startsWith(`${prefix}/`),
  );
}

export function isFrameworkPackage(specifier: string): boolean {
  return isPackageFromPrefixes(specifier, frameworkPackagePrefixes);
}

export function isBrowserBoundaryPackage(specifier: string): boolean {
  return isPackageFromPrefixes(specifier, browserBoundaryPackagePrefixes);
}

function resolveImportTarget(file: string, specifier: string): string | null {
  const alias = moduleAliases.find(
    ({ prefix }) => specifier.startsWith(prefix) || specifier === prefix.slice(0, -1),
  );
  if (alias) {
    const suffix = specifier.startsWith(alias.prefix)
      ? specifier.slice(alias.prefix.length)
      : '';
    return normalizeImportTarget(path.resolve(alias.root, suffix));
  }
  if (specifier.startsWith('@/')) {
    return normalizeImportTarget(path.resolve(specifier.slice(2)));
  }
  if (!specifier.startsWith('.')) {
    return null;
  }
  return normalizeImportTarget(path.resolve(path.dirname(path.resolve(file)), specifier));
}

function collectImportSpecifiers(node: ts.Node, specifiers: string[]): void {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    specifiers.push(node.moduleSpecifier.text);
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    specifiers.push(node.moduleSpecifier.text);
  }
  const firstArgument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1 &&
    firstArgument &&
    ts.isStringLiteral(firstArgument)
  ) {
    specifiers.push(firstArgument.text);
  }
  node.forEachChild((child) => collectImportSpecifiers(child, specifiers));
}

export function readImports(file: string): readonly SourceImport[] {
  const content = fs.readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const specifiers: string[] = [];
  collectImportSpecifiers(sourceFile, specifiers);
  return [...new Set(specifiers)].sort().map((specifier) => ({
    specifier,
    target: resolveImportTarget(file, specifier),
  }));
}

export function addImportViolations(
  rule: ArchitectureRuleName,
  sourceFiles: readonly string[],
  findDetail: (file: string, sourceImport: SourceImport) => string | null,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const file of sourceFiles) {
    for (const sourceImport of readImports(file)) {
      const detail = findDetail(file, sourceImport);
      if (detail) {
        violations.push({ rule, file, detail });
      }
    }
  }
  return violations;
}

export function addBrowserGlobalViolations(
  rule: ArchitectureRuleName,
  sourceFiles: readonly string[],
  isBoundaryFile: (file: string) => boolean,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const file of sourceFiles) {
    if (!isBoundaryFile(file)) {
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    const globals = new Set(
      [...content.matchAll(browserGlobalPattern)]
        .map((match) => match[1])
        .filter((name): name is string => typeof name === 'string'),
    );
    for (const name of [...globals].sort()) {
      violations.push({ rule, file, detail: `browser-global:${name}` });
    }
  }
  return violations;
}

export function sortViolations(violations: readonly ArchitectureViolation[]): ArchitectureViolation[] {
  return [...violations].sort((left, right) =>
    `${left.rule}|${left.file}|${left.detail}`.localeCompare(
      `${right.rule}|${right.file}|${right.detail}`,
    ),
  );
}

export function readProductionSourceFiles(root = 'src'): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const relativePath = toProjectPath(absolutePath);
      if (
        entry.isFile() &&
        sourceFileExtensions.has(path.extname(entry.name)) &&
        isProductionSourceFile(relativePath)
      ) {
        files.push(relativePath);
      }
    }
  };
  visit(path.resolve(root));
  return files.sort();
}
