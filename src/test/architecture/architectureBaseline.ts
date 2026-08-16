import fs from 'node:fs';
import path from 'node:path';
import type { ArchitectureViolation } from './architectureScanner';

export const ARCHITECTURE_BASELINE_PATH = 'src/test/architecture/architecture-baseline.json';

export type ArchitectureBaseline = Readonly<{
  version: 1;
  violations: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadArchitectureBaseline(): ArchitectureBaseline {
  const raw: unknown = JSON.parse(fs.readFileSync(path.resolve(ARCHITECTURE_BASELINE_PATH), 'utf8'));
  if (
    !isRecord(raw) ||
    raw['version'] !== 1 ||
    !Array.isArray(raw['violations']) ||
    !raw['violations'].every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new Error(`Invalid architecture baseline: ${ARCHITECTURE_BASELINE_PATH}`);
  }
  return { version: 1, violations: raw['violations'] };
}

export function architectureViolationKey(violation: ArchitectureViolation): string {
  return `${violation.rule}|${violation.file}|${violation.detail}`;
}

export function findNewArchitectureViolations(
  violations: readonly ArchitectureViolation[],
  baseline: ArchitectureBaseline,
): readonly ArchitectureViolation[] {
  const baselineKeys = new Set(baseline.violations);
  return violations.filter((violation) => !baselineKeys.has(architectureViolationKey(violation)));
}

export function formatArchitectureViolations(
  violations: readonly ArchitectureViolation[],
): string | undefined {
  return violations.length === 0
    ? undefined
    : violations.map(({ rule, file, detail }) => `- [${rule}] ${file} -> ${detail}`).join('\n');
}
