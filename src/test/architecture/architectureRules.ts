import {
  addBrowserGlobalViolations,
  addImportViolations,
  featureName,
  isBrowserBoundaryPackage,
  isCollaborativeTransportPackage,
  isFrameworkPackage,
  isPathUnder,
  sortViolations,
  type ArchitectureViolation,
  type SourceImport,
} from './architectureScanner';

/** The one package allowed to know the collaborative transport. */
const COEDIT_PACKAGE_ROOT = 'src/features/exam-authoring/realtime/coedit';

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

/** The feature this boundary was audited for (plan Phase 10). */
const ASSESSMENT_AUTHORING_FEATURE = 'src/features/exam-authoring';

/**
 * A feature's INTERNAL directories.
 *
 * `api/` and `routes/` are deliberately absent: they are the feature's public
 * entry points and are the only paths anyone outside the feature may import.
 *
 * `ui/` is absent too, and that is a deliberate scope limit rather than an
 * endorsement: composing another feature's screen is a real (and repo-wide)
 * question, but naming it in this rule today would flag call sites whose only
 * fix is inventing a public entry point for a component — a product decision,
 * not a dependency cleanup. The three layers below are the ones the plan names
 * ("never UI → infrastructure"), and they can be repointed mechanically.
 */
const ASSESSMENT_AUTHORING_INTERNAL_LAYERS = [
  `${ASSESSMENT_AUTHORING_FEATURE}/application`,
  `${ASSESSMENT_AUTHORING_FEATURE}/domain`,
  `${ASSESSMENT_AUTHORING_FEATURE}/infrastructure`,
];

/**
 * UI → infrastructure, enforced (plan Phase 10).
 *
 * The layer and feature rules together let a legacy consumer reach PAST a
 * feature's public `api/` into its `infrastructure/`, `application/`, or `ui/`:
 * the layer rule does not describe feature internals, and the feature rule only
 * compares two files that are BOTH inside `src/features/`. So twenty-odd legacy
 * consumers imported the assessment-authoring infrastructure gateway directly,
 * which is exactly the edge the plan forbids ("never UI → infrastructure") and
 * exactly the edge that no guard could see.
 *
 * Scoped to the audited feature on purpose: other features' legacy consumers
 * are still mid-migration, and widening this rule today would mean writing a
 * baseline — which the architecture policy forbids. Add a feature here only
 * after its consumers have been repointed.
 */
export function collectFeatureInternalBoundaryViolations(
  sourceFiles: readonly string[],
): readonly ArchitectureViolation[] {
  const violations = addImportViolations(
    'feature-internal-boundary',
    sourceFiles,
    (file, sourceImport) => {
      const target = sourceImport.target;
      if (!target) {
        return null;
      }
      // A feature may always import its own internals.
      if (isPathUnder(file, ASSESSMENT_AUTHORING_FEATURE)) {
        return null;
      }
      return ASSESSMENT_AUTHORING_INTERNAL_LAYERS.some((layer) => isPathUnder(target, layer))
        ? target
        : null;
    },
  );
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
      isPathUnder(file, 'src/features/student-delivery/infrastructure') ||
      isPathUnder(file, 'src/features/proctor/infrastructure') ||
      isPathUnder(file, 'src/features/exam-authoring/infrastructure') ||
      isPathUnder(file, 'src/features/scheduling/infrastructure') ||
      isPathUnder(file, 'src/features/content-library/infrastructure') ||
      isPathUnder(file, 'src/features/grading/infrastructure') ||
      isPathUnder(file, 'src/features/results/infrastructure') ||
      isPathUnder(file, 'src/features/answer-history/infrastructure') ||
      isPathUnder(file, 'src/features/builder/infrastructure');
    return approvedAdapter ? null : target;
  });
  return sortViolations(violations);
}

export function collectCoeditTransportBoundaryViolations(
  sourceFiles: readonly string[],
): readonly ArchitectureViolation[] {
  const violations = addImportViolations(
    'coedit-transport-boundary',
    sourceFiles,
    (file, sourceImport) => {
      if (isPathUnder(file, COEDIT_PACKAGE_ROOT)) {
        return null;
      }
      return isCollaborativeTransportPackage(sourceImport.specifier)
        ? `package:${sourceImport.specifier}`
        : null;
    },
  );
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
