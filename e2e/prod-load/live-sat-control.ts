import path from 'node:path';
import { parseSatJoinUrl } from './sat-join-url';

export interface LiveSatControlConfig {
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
  const joinUrl = text(record, 'joinUrl', 'SAT_JOIN_URL');
  const parsedUrl = parseSatJoinUrl(joinUrl);
  if (parsedUrl.origin.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(parsedUrl.origin)) {
    throw new Error('SAT_JOIN_URL must use HTTPS except for localhost.');
  }

  const usersFileInput = text(record, 'usersFile', 'USERS_FILE');
  const root = path.resolve(workspaceRoot);
  const usersFile = path.resolve(root, usersFileInput);
  const relativePath = path.relative(root, usersFile);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
    throw new Error('USERS_FILE must be inside the workspace.');
  }

  return {
    joinUrl: parsedUrl.joinUrl,
    accessLinkId: parsedUrl.accessLinkId,
    usersFile,
    userCount: integer(record, 'userCount', 'USER_COUNT', 1, 500),
    userOffset: integer(record, 'userOffset', 'USER_OFFSET', 0, 100_000),
    maxConcurrentUsers: integer(record, 'maxConcurrentUsers', 'MAX_CONCURRENT_USERS', 1, 100),
    screenshotIntervalMs: integer(record, 'screenshotIntervalMs', 'SCREENSHOT_INTERVAL_MS', 250, 60_000),
    jpegQuality: integer(record, 'jpegQuality', 'JPEG_QUALITY', 10, 90),
    startTimeoutMs: integer(record, 'startTimeoutMs', 'START_TIMEOUT_MS', 10_000, 3_600_000),
    examTimeoutMs: integer(record, 'examTimeoutMs', 'EXAM_TIMEOUT_MS', 60_000, 14_400_000),
  };
}
