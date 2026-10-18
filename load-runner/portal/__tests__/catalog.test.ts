import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GO_TEST_FAMILY_COVERAGE,
  K6_COVERAGE,
  PACKAGE_SCRIPT_COVERAGE,
  PLAYWRIGHT_CONFIG_COVERAGE,
  STANDALONE_ONLY_COVERAGE,
  SUITE_ALIASES,
  SUITE_CATALOG,
  expandSelection,
  getSuite,
} from '../catalog';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('suite catalog', () => {
  it('has unique ids and resolves every alias', () => {
    const ids = SUITE_CATALOG.map((suite) => suite.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [alias, target] of Object.entries(SUITE_ALIASES)) {
      expect(getSuite(target), `alias ${alias} -> ${target}`).not.toBeNull();
    }
  });

  it('never exposes shell text or caller-supplied placeholders in commands', () => {
    for (const suite of SUITE_CATALOG) {
      for (const step of suite.steps) {
        const joined = [step.command, ...step.args].join(' ');
        expect(joined).not.toMatch(/\|\||&&|;|\$\(|`/);
        expect(step.command).not.toBe('sh');
        expect(step.command).not.toBe('bash');
      }
    }
  });

  it('classifies every root package script', () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const missing = Object.keys(packageJson.scripts).filter(
      (script) => PACKAGE_SCRIPT_COVERAGE[script] === undefined,
    );
    expect(missing).toEqual([]);
    for (const [script, coverage] of Object.entries(PACKAGE_SCRIPT_COVERAGE)) {
      expect(packageJson.scripts[script], `coverage references a removed script ${script}`).toBeDefined();
      if (coverage.suiteId) {
        expect(getSuite(coverage.suiteId), `unknown suite for ${script}`).not.toBeNull();
      }
    }
  });

  it('classifies every root Playwright config', () => {
    const configs = readdirSync(repoRoot).filter((entry) => /^playwright\..*\.config\.ts$/.test(entry));
    const missing = configs.filter((entry) => PLAYWRIGHT_CONFIG_COVERAGE[entry] === undefined);
    expect(missing).toEqual([]);
    for (const [config, coverage] of Object.entries(PLAYWRIGHT_CONFIG_COVERAGE)) {
      if (coverage.suiteId) expect(getSuite(coverage.suiteId)).not.toBeNull();
      expect(configs.includes(config) || config === 'playwright.config.ts').toBe(true);
    }
  });

  it('classifies every k6 scenario and helper', () => {
    const scripts: string[] = [];
    for (const entry of readdirSync(path.join(repoRoot, 'k6'), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) scripts.push(`k6/${entry.name}`);
    }
    for (const entry of readdirSync(path.join(repoRoot, 'k6', 'scale-proof'))) {
      if (entry.endsWith('.js')) scripts.push(`k6/scale-proof/${entry}`);
    }
    const missing = scripts.filter((script) => K6_COVERAGE[script] === undefined);
    expect(missing).toEqual([]);
  });

  it('covers the Go test family and the standalone-only scenario explicitly', () => {
    expect(GO_TEST_FAMILY_COVERAGE.suiteId).toBe('backend.go');
    expect(STANDALONE_ONLY_COVERAGE.classification).toBe('helper');
  });

  it('expands Run all to canonical suites and excludes legacy entries', () => {
    const expanded = expandSelection({ mode: 'all', suiteIds: [] });
    expect(expanded.unknownIds).toEqual([]);
    expect(expanded.excludedIds).toEqual([]);
    expect(expanded.suites.length).toBeGreaterThan(20);
    expect(expanded.suites.some((suite) => suite.id === 'legacy.remote')).toBe(false);
    expect(expanded.suites.some((suite) => suite.id === 'optional.build-storybook')).toBe(false);
  });

  it('reports unknown suites without silently dropping selection', () => {
    const expanded = expandSelection({ mode: 'selected', suiteIds: ['quality.frontend', 'nope.missing'] });
    expect(expanded.unknownIds).toEqual(['nope.missing']);
    expect(expanded.suites.map((suite) => suite.id)).toEqual(['quality.frontend']);
  });

  it('resolves aliases to canonical suites', () => {
    expect(getSuite('k6:start-exam'.replace(':', '.'))).toBeNull();
    expect(getSuite('prod.ielts.k6.start')?.id).toBe('prod.ielts.k6.start-exam');
    expect(getSuite('quality')?.id).toBe('quality.frontend');
  });
});
