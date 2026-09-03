import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function selectPrettierFiles(paths: readonly string[]): string[] {
  return paths.filter((filePath) => /^src\/.*\.(ts|tsx)$/.test(filePath));
}

function readGitHubEvent(eventPath: string | undefined): Record<string, unknown> {
  if (!eventPath || !fs.existsSync(eventPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(eventPath, 'utf8')) as Record<string, unknown>;
}

function pullRequestSha(
  event: Record<string, unknown>,
  side: 'base' | 'head',
): string | undefined {
  const pullRequest = event['pull_request'];
  if (!pullRequest || typeof pullRequest !== 'object') {
    return undefined;
  }

  const sha = (pullRequest as Record<string, unknown>)[side];
  if (!sha || typeof sha !== 'object') {
    return undefined;
  }

  const value = (sha as Record<string, unknown>)['sha'];
  return typeof value === 'string' ? value : undefined;
}

export function resolvePrettierRange(
  env: Record<string, string | undefined> = process.env,
  event: Record<string, unknown> = readGitHubEvent(env['GITHUB_EVENT_PATH']),
): { base: string; head: string } {
  const baseRef = env['GITHUB_BASE_REF'];
  if (baseRef) {
    return { base: `origin/${baseRef}`, head: 'HEAD' };
  }

  const base =
    pullRequestSha(event, 'base') ??
    event['before'] ??
    env['GITHUB_EVENT_BEFORE'] ??
    env['PRETTIER_BASE_SHA'];
  const head =
    pullRequestSha(event, 'head') ??
    event['after'] ??
    env['GITHUB_SHA'] ??
    env['PRETTIER_HEAD_SHA'];

  if (typeof head !== 'string' || head.length === 0) {
    throw new Error('Unable to determine the commit to check for Prettier.');
  }

  if (typeof base !== 'string' || base.length === 0 || /^0+$/.test(base)) {
    return { base: `${head}^`, head };
  }

  return { base, head };
}

function changedSourceFiles(range: { base: string; head: string }): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', range.base, range.head, '--', 'src'],
    { encoding: 'utf8' },
  );

  return selectPrettierFiles(output.split('\n').filter(Boolean));
}

export function main(): void {
  const files = changedSourceFiles(resolvePrettierRange());
  if (files.length === 0) {
    console.log('No changed TypeScript source files require a Prettier check.');
    return;
  }

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    npx,
    ['--no-install', 'prettier', '--check', ...files, '--config', '.prettierrc'],
    { stdio: 'inherit' },
  );

  process.exitCode = result.status ?? 1;
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  main();
}
