import { existsSync, readFileSync } from 'node:fs';
import type { StepOutcome } from '../process-supervisor';
import type { CommandResultKind } from '../catalog';
import { emptyResult, type FailureKind, type NormalizedResult } from '../contracts';

/**
 * Result adapters interpret native framework output. They never infer a pass
 * from console text, a null exit code, or the presence of a file that failed
 * to parse: missing or malformed required evidence is an infrastructure
 * failure.
 */

export interface StepReportPaths {
  playwrightJson: string | null;
  k6Summary: string | null;
  browserSummary: string | null;
  goTestJson: string | null;
}

interface NativeOutcome {
  result: NormalizedResult;
  failureReason: string | null;
}

function failure(result: NormalizedResult, reason: string): NativeOutcome {
  return { result, failureReason: reason };
}

function failedResult(kind: FailureKind, reason: string): NativeOutcome {
  const result = emptyResult('failed');
  result.failureKind = kind;
  result.evidenceComplete = false;
  return failure(result, reason);
}

export function normalizeStepOutcome(
  outcome: StepOutcome,
  resultKind: CommandResultKind,
  reportPaths: StepReportPaths,
): NativeOutcome {
  if (outcome.spawnError) {
    return failedResult('infrastructure', `spawn failed: ${outcome.spawnError}`);
  }
  if (outcome.timedOut) {
    return failedResult('infrastructure', `step exceeded its deadline (${outcome.label})`);
  }
  if (outcome.cancelled) {
    const result = emptyResult('cancelled');
    result.failureKind = null;
    return failure(result, 'cancelled');
  }
  if (outcome.cleanupUnverified) {
    return failedResult('infrastructure', 'process cleanup could not be verified');
  }
  if (outcome.signal !== null) {
    return failedResult('infrastructure', `terminated by signal ${outcome.signal}`);
  }
  if (outcome.exitCode === null) {
    return failedResult('infrastructure', 'process exited without a status code');
  }

  switch (resultKind) {
    case 'gofmt': {
      const result = emptyResult(outcome.exitCode === 0 ? 'passed' : 'failed');
      result.evidenceComplete = true;
      if (outcome.exitCode !== 0) {
        result.failureKind = 'infrastructure';
        return failure(result, `gofmt exited with ${outcome.exitCode}`);
      }
      if (outcome.stdout.trim().length > 0) {
        result.outcome = 'failed';
        result.failureKind = 'assertion';
        return failure(result, `gofmt reported unformatted files:\n${outcome.stdout.trim().slice(0, 2000)}`);
      }
      return { result, failureReason: null };
    }
    case 'playwright':
      return normalizePlaywright(outcome, reportPaths.playwrightJson);
    case 'k6':
      return normalizeK6(outcome, reportPaths.k6Summary);
    case 'browser-summary':
      return normalizeBrowserSummary(outcome, reportPaths.browserSummary);
    case 'exit': {
      const result = emptyResult(outcome.exitCode === 0 ? 'passed' : 'failed');
      result.evidenceComplete = true;
      if (outcome.exitCode !== 0) {
        result.failureKind = 'assertion';
        return failure(result, `${outcome.command} exited with ${outcome.exitCode}`);
      }
      return { result, failureReason: null };
    }
    default: {
      const exhaustive: never = resultKind;
      return failedResult('infrastructure', `unknown result kind ${String(exhaustive)}`);
    }
  }
}

export function normalizePlaywright(outcome: StepOutcome, reportPath: string | null): NativeOutcome {
  if (outcome.exitCode !== 0) {
    const result = emptyResult('failed');
    result.failureKind = 'assertion';
    result.evidenceComplete = reportPath !== null && existsSync(reportPath);
    return failure(result, `playwright exited with ${outcome.exitCode}`);
  }
  if (!reportPath || !existsSync(reportPath)) {
    return failedResult('infrastructure', 'required Playwright JSON report is missing');
  }
  let report: {
    stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number };
    errors?: unknown[];
    suites?: unknown[];
  };
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as typeof report;
  } catch (error) {
    return failedResult('infrastructure', `Playwright report is malformed: ${String(error)}`);
  }
  const stats = report.stats ?? {};
  const expected = Number(stats.expected ?? 0);
  const unexpected = Number(stats.unexpected ?? 0);
  const flaky = Number(stats.flaky ?? 0);
  const skipped = Number(stats.skipped ?? 0);
  const executed = expected + unexpected + flaky;
  const result = emptyResult(unexpected === 0 && executed > 0 ? 'passed' : 'failed');
  result.executed = executed;
  result.passed = expected;
  result.failed = unexpected;
  result.skipped = skipped;
  result.evidenceComplete = true;
  result.thresholdFailures = Array.isArray(report.errors)
    ? report.errors.map((error, index) => `playwright error ${index + 1}: ${JSON.stringify(error).slice(0, 300)}`)
    : [];
  if (executed === 0) {
    return failure(result, 'Playwright executed zero tests');
  }
  if (unexpected > 0) {
    result.failureKind = 'assertion';
    return failure(result, `${unexpected} Playwright test(s) failed`);
  }
  return { result, failureReason: null };
}

export function normalizeK6(outcome: StepOutcome, summaryPath: string | null): NativeOutcome {
  if (outcome.exitCode !== 0) {
    const result = emptyResult('failed');
    result.failureKind = 'assertion';
    result.evidenceComplete = summaryPath !== null && existsSync(summaryPath);
    return failure(result, `k6 exited with ${outcome.exitCode}`);
  }
  if (!summaryPath || !existsSync(summaryPath)) {
    return failedResult('infrastructure', 'required k6 summary export is missing');
  }
  let summary: {
    metrics?: Record<
      string,
      {
        values?: Record<string, unknown>;
        thresholds?: Record<string, { ok?: boolean }>;
      }
    >;
  };
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as typeof summary;
  } catch (error) {
    return failedResult('infrastructure', `k6 summary is malformed: ${String(error)}`);
  }
  const metrics = summary.metrics ?? {};
  const thresholdFailures: string[] = [];
  for (const [name, metric] of Object.entries(metrics)) {
    for (const [expression, threshold] of Object.entries(metric.thresholds ?? {})) {
      if (threshold && threshold.ok === false) thresholdFailures.push(`${name}: ${expression}`);
    }
  }
  const checks = metrics['checks']?.values ?? {};
  const passes = Number(checks['passes'] ?? 0);
  const fails = Number(checks['fails'] ?? 0);
  const iterations = Number(metrics['iterations']?.values?.['count'] ?? 0);
  const result = emptyResult('failed');
  result.executed = passes + fails;
  result.passed = passes;
  result.failed = fails;
  result.evidenceComplete = true;
  result.thresholdFailures = thresholdFailures;
  if (result.executed === 0 && iterations === 0) {
    return failure(result, 'k6 summary contains no checks or iterations');
  }
  result.configuredCandidates = iterations > 0 ? iterations : null;
  result.achievedCandidates = iterations > 0 ? iterations : null;
  const allOk = fails === 0 && thresholdFailures.length === 0 && Object.keys(metrics).length > 0;
  result.outcome = allOk ? 'passed' : 'failed';
  if (!allOk) {
    result.failureKind = fails > 0 ? 'assertion' : 'assertion';
    return failure(result, fails > 0 ? `${fails} k6 check(s) failed` : `k6 threshold(s) failed: ${thresholdFailures.join(', ')}`);
  }
  return { result, failureReason: null };
}

export function normalizeBrowserSummary(outcome: StepOutcome, summaryPath: string | null): NativeOutcome {
  const result = emptyResult('failed');
  if (outcome.exitCode !== 0) {
    result.failureKind = outcome.timedOut ? 'infrastructure' : 'assertion';
    result.evidenceComplete = summaryPath !== null && existsSync(summaryPath);
    return failure(result, `browser runner exited with ${outcome.exitCode}`);
  }
  if (!summaryPath || !existsSync(summaryPath)) {
    return failedResult('infrastructure', 'required browser run summary is missing');
  }
  let summary: {
    userCount?: number;
    passed?: number;
    failed?: number;
    aborted?: boolean;
    failures?: unknown[];
  };
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as typeof summary;
  } catch (error) {
    return failedResult('infrastructure', `browser summary is malformed: ${String(error)}`);
  }
  const userCount = Number(summary.userCount ?? 0);
  const passed = Number(summary.passed ?? 0);
  const failed = Number(summary.failed ?? Math.max(0, userCount - passed));
  result.executed = userCount;
  result.passed = passed;
  result.failed = failed;
  result.evidenceComplete = true;
  result.requestedCandidates = userCount;
  result.configuredCandidates = userCount;
  result.achievedCandidates = passed + failed;
  if (summary.aborted === true) {
    result.failureKind = 'assertion';
    return failure(result, 'browser runner reported an aborted run');
  }
  if (userCount === 0) {
    return failedResult('precondition', 'browser runner admitted zero candidates');
  }
  if (failed > 0 || passed !== userCount) {
    result.failureKind = 'assertion';
    const details = Array.isArray(summary.failures)
      ? summary.failures
          .slice(0, 5)
          .map((item) => JSON.stringify(item).slice(0, 300))
          .join(' | ')
      : '';
    return failure(result, `${failed} browser candidate(s) failed${details ? `: ${details}` : ''}`);
  }
  result.outcome = 'passed';
  return { result, failureReason: null };
}

export interface GoTestTally {
  passed: number;
  failed: number;
  skipped: number;
  failedTests: string[];
  skippedTests: string[];
}

/** Parse `go test -json` NDJSON output. */
export function tallyGoTestJson(raw: string): GoTestTally {
  const tally: GoTestTally = { passed: 0, failed: 0, skipped: 0, failedTests: [], skippedTests: [] };
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: { Action?: string; Test?: string; Package?: string };
    try {
      event = JSON.parse(trimmed) as typeof event;
    } catch {
      continue;
    }
    if (!event.Test) continue;
    switch (event.Action) {
      case 'pass':
        tally.passed += 1;
        break;
      case 'fail':
        tally.failed += 1;
        tally.failedTests.push(`${event.Package ?? '?'}.${event.Test}`);
        break;
      case 'skip':
        tally.skipped += 1;
        tally.skippedTests.push(`${event.Package ?? '?'}.${event.Test}`);
        break;
      default:
        break;
    }
  }
  return tally;
}

export function mergeResults(results: readonly NormalizedResult[]): NormalizedResult {
  const merged = emptyResult('passed');
  merged.evidenceComplete = results.every((result) => result.evidenceComplete);
  for (const result of results) {
    merged.executed += result.executed;
    merged.passed += result.passed;
    merged.failed += result.failed;
    merged.skipped += result.skipped;
    merged.thresholdFailures.push(...result.thresholdFailures);
    if (result.outcome === 'cancelled') merged.outcome = 'cancelled';
    else if (result.outcome === 'interrupted' && merged.outcome !== 'cancelled') merged.outcome = 'interrupted';
    else if (result.outcome === 'failed' && merged.outcome === 'passed') merged.outcome = 'failed';
    if (result.failureKind && !merged.failureKind) merged.failureKind = result.failureKind;
  }
  if (merged.outcome === 'passed' && !merged.evidenceComplete) merged.outcome = 'failed';
  return merged;
}
