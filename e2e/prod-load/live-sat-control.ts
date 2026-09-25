import path from 'node:path';
import { parseSatJoinUrl } from './sat-join-url';

export interface LiveSatControlConfig {
  runMode: 'headless' | 'headed' | 'k6';
  joinUrl: string;
  accessLinkId: string;
  usersFile: string;
  userCount: number;
  userOffset: number;
  maxConcurrentUsers: number;
  screenshotIntervalMs: number;
  jpegQuality: number;
  startTimeoutMs: number;
  examTimeoutMs: number;
  k6Students: number;
  k6StudentOffset: number;
  confirmK6Sat: boolean;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Settings must be submitted as a JSON object.');
  }
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function integer(
  record: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
  max: number,
): number {
  const raw = record[key];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

export function parseLiveSatControlConfig(input: unknown, workspaceRoot: string): LiveSatControlConfig {
  const record = recordOf(input);
  const root = path.resolve(workspaceRoot);
  const rawMode = record['runMode'] ?? 'headless';
  if (rawMode !== 'headless' && rawMode !== 'headed' && rawMode !== 'k6') throw new Error('RUN_MODE is invalid.');
  const runMode = rawMode;
  const confirmK6Sat = record['confirmK6Sat'] === true;
  if (runMode === 'k6' && !confirmK6Sat) throw new Error('Confirm that this is an isolated staging SAT schedule before starting k6.');

  let joinUrl = '';
  let accessLinkId = '';
  let usersFile = path.resolve(root, 'e2e/prod-load/live-users.500.csv');
  if (runMode !== 'k6') {
    const parsedUrl = parseSatJoinUrl(text(record, 'joinUrl', 'SAT_JOIN_URL'));
    if (parsedUrl.origin.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(parsedUrl.origin)) throw new Error('SAT_JOIN_URL must use HTTPS except for localhost.');
    joinUrl = parsedUrl.joinUrl;
    accessLinkId = parsedUrl.accessLinkId;
    const usersFileInput = text(record, 'usersFile', 'USERS_FILE');
    usersFile = path.resolve(root, usersFileInput);
    const relativePath = path.relative(root, usersFile);
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) throw new Error('USERS_FILE must be inside the workspace.');
  }

  return {
    runMode,
    joinUrl,
    accessLinkId,
    usersFile,
    userCount: runMode === 'k6' ? 1 : integer(record, 'userCount', 'USER_COUNT', 1, 500),
    userOffset: runMode === 'k6' ? 0 : integer(record, 'userOffset', 'USER_OFFSET', 0, 100_000),
    maxConcurrentUsers: integer(record, 'maxConcurrentUsers', 'MAX_CONCURRENT_USERS', 1, 100),
    screenshotIntervalMs: integer(record, 'screenshotIntervalMs', 'SCREENSHOT_INTERVAL_MS', 250, 60_000),
    jpegQuality: integer(record, 'jpegQuality', 'JPEG_QUALITY', 10, 90),
    startTimeoutMs: integer(record, 'startTimeoutMs', 'START_TIMEOUT_MS', 10_000, 3_600_000),
    examTimeoutMs: integer(record, 'examTimeoutMs', 'EXAM_TIMEOUT_MS', 60_000, 14_400_000),
    k6Students: runMode === 'k6' ? integer(record, 'k6Students', 'K6_STUDENTS', 1, 10_000) : 1,
    k6StudentOffset: runMode === 'k6' ? integer(record, 'k6StudentOffset', 'K6_STUDENT_OFFSET', 0, 100_000) : 0,
    confirmK6Sat,
  };
}
