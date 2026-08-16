import {
  addBrowserGlobalViolations,
  addImportViolations,
  featureName,
  isBrowserBoundaryPackage,
  isFrameworkPackage,
  isPathUnder,
  sortViolations,
  type ArchitectureViolation,
  type SourceImport,
} from './architectureScanner';

function isDomainFile(file: string): boolean {
  return isPathUnder(file, 'src/features') && file.includes('/domain/');
}

function isApplicationOrDomainFile(file: string): boolean {
  return isPathUnder(file, 'src/features') && (file.includes('/domain/') || file.includes('/application/'));
}

function isFeaturePublicInterface(file: string): boolean {
  return /(?:^|\/)src\/features\/[^/]+\/(api|routes)\//.test(file);
}

export function collectLayerDependencyViolations(
  sourceFiles: readonly string[],
): readonly ArchitectureViolation[] {
  const violations = addImportViolations('layer-dependencies', sourceFiles, (file, sourceImport) => {
    const target = sourceImport.target;
    if (!target) {
      return null;
    }
    if (
      isPathUnder(file, 'src/shared') &&
      (isPathUnder(target, 'src/app') ||
        isPathUnder(target, 'src/features') ||
        isPathUnder(target, 'src/services'))
    ) {
      return target;
    }
    if (isPathUnder(file, 'src/features') && isPathUnder(target, 'src/app')) {
      return target;
    }
    if (isPathUnder(file, 'src/app') && isPathUnder(target, 'src/services')) {
      return target;
    }
    return null;
  });
  return sortViolations(violations);
}

export function collectFeatureIsolationViolations(
  sourceFiles: readonly string[],
): readonly ArchitectureViolation[] {
  const violations = addImportViolations('feature-isolation', sourceFiles, (file, sourceImport) => {
    const owner = featureName(file);
    const targetOwner = sourceImport.target ? featureName(sourceImport.target) : null;
    return owner &&
      targetOwner &&
      owner !== targetOwner &&
      sourceImport.target &&
      !isFeaturePublicInterface(sourceImport.target)
      ? sourceImport.target
      : null;
  });
  return sortViolations(violations);
}

export function collectDomainPurityViolations(
  sourceFiles: readonly string[],
): readonly ArchitectureViolation[] {
  const violations = addImportViolations('domain-purity', sourceFiles, (file, sourceImport) => {
    if (!isDomainFile(file)) {
      return null;
    }
    if (
      isFrameworkPackage(sourceImport.specifier) ||
      (sourceImport.target &&
        (isPathUnder(sourceImport.target, 'src/app') ||
          isPathUnder(sourceImport.target, 'src/components') ||
          isPathUnder(sourceImport.target, 'src/services')))
    ) {
      return sourceImport.target ?? `package:${sourceImport.specifier}`;
    }
    return null;
  });
  return sortViolations(violations);
}

export function collectLegacyServiceViolations(
  sourceFiles: readonly string[],
): readonly ArchitectureViolation[] {
  const violations = addImportViolations('legacy-services', sourceFiles, (file, sourceImport) => {
    const target = sourceImport.target;
    if (!target || !isPathUnder(target, 'src/services') || isPathUnder(file, 'src/services')) {
      return null;
    }
    const approvedAdapter =
      isPathUnder(file, 'src/features/auth/infrastructure') ||
      isPathUnder(file, 'src/features/student/infrastructure') ||
      isPathUnder(file, 'src/features/proctor/infrastructure') ||
      isPathUnder(file, 'src/features/exam-authoring/infrastructure') ||
      isPathUnder(file, 'src/features/scheduling/infrastructure') ||
      isPathUnder(file, 'src/features/content-library/infrastructure') ||
      isPathUnder(file, 'src/features/grading/infrastructure') ||
      isPathUnder(file, 'src/features/answer-history/infrastructure');
    return approvedAdapter ? null : target;
  });
  return sortViolations(violations);
}

export function collectForbiddenBrowserBoundaryViolations(
  sourceFiles: readonly string[],
): readonly ArchitectureViolation[] {
  const violations = addImportViolations(
    'forbidden-browser-boundaries',
    sourceFiles,
    (file, sourceImport: SourceImport) => {
      if (!isApplicationOrDomainFile(file)) {
        return null;
      }
      return isBrowserBoundaryPackage(sourceImport.specifier)
        ? `package:${sourceImport.specifier}`
        : null;
    },
  );
  violations.push(
    ...addBrowserGlobalViolations(
      'forbidden-browser-boundaries',
      sourceFiles,
      isApplicationOrDomainFile,
    ),
  );
  return sortViolations(violations);
}
