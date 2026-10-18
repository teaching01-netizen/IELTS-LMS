/**
 * Trusted server configuration. Every value is read from the environment
 * once at startup; request bodies can never override these limits.
 */

export interface PortalConfig {
  host: string;
  port: number;
  dataDir: string;
  webRoot: string;
  publicOrigin: string | null;
  trustProxyHops: number;
  secureCookies: boolean;
  operator: {
    username: string;
    passwordHash: string;
  };
  sessionHours: number;
  preflightTtlMinutes: number;
  productionEnabled: boolean;
  retentionDays: number;
  maxQueuedRuns: number;
  logLimitBytes: number;
  artifactLimitBytes: number;
  minFreeBytes: number;
  maxStagingCandidates: number;
  imageRevision: string;
  targetsJson: string | null;
  credentialsJson: string | null;
  testDbAdminUrl: string | null;
  testDbHost: string | null;
  testDbPort: number;
  testDbUserPrefix: string;
  stagingPrepared: boolean;
  stagingCapacity: number;
  suiteTimeoutGraceSeconds: number;
  gracefulStopSeconds: number;
  forceStopSeconds: number;
}

export type EnvLike = Record<string, string | undefined>;

function intValue(env: EnvLike, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function boolValue(env: EnvLike, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be true or false.`);
}

function requireHttpsOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`${name} must use https (http is permitted only for loopback).`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not embed credentials.`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an origin without a path, query, or fragment.`);
  }
  return url.origin;
}

export function loadConfig(env: EnvLike = process.env): PortalConfig {
  const productionEnabled = boolValue(env, 'PORTAL_PRODUCTION_ENABLED', false);
  const passwordHash = env['PORTAL_OPERATOR_PASSWORD_HASH']?.trim() ?? '';
  const username = env['PORTAL_OPERATOR_USERNAME']?.trim() ?? '';
  const publicOriginRaw = env['PORTAL_PUBLIC_ORIGIN']?.trim() ?? '';

  if (productionEnabled) {
    if (!username) throw new Error('PORTAL_OPERATOR_USERNAME is required when production is enabled.');
    if (!passwordHash) throw new Error('PORTAL_OPERATOR_PASSWORD_HASH is required when production is enabled.');
    if (!publicOriginRaw) throw new Error('PORTAL_PUBLIC_ORIGIN is required when production is enabled.');
  }

  return {
    host: env['HOST']?.trim() || '0.0.0.0',
    port: intValue(env, 'PORT', 3366, 1, 65535),
    dataDir: env['PORTAL_DATA_DIR']?.trim() || '.generated/test-portal',
    webRoot: env['PORTAL_WEB_ROOT']?.trim() || 'load-runner/portal-web',
    publicOrigin: publicOriginRaw ? requireHttpsOrigin(publicOriginRaw, 'PORTAL_PUBLIC_ORIGIN') : null,
    trustProxyHops: intValue(env, 'PORTAL_TRUST_PROXY_HOPS', 1, 0, 10),
    secureCookies: boolValue(env, 'PORTAL_SECURE_COOKIES', publicOriginRaw.startsWith('https://')),
    operator: { username, passwordHash },
    sessionHours: intValue(env, 'PORTAL_SESSION_HOURS', 8, 1, 24),
    preflightTtlMinutes: intValue(env, 'PORTAL_PREFLIGHT_TTL_MINUTES', 10, 1, 60),
    productionEnabled,
    retentionDays: intValue(env, 'PORTAL_RETENTION_DAYS', 14, 1, 90),
    maxQueuedRuns: intValue(env, 'PORTAL_MAX_QUEUED_RUNS', 20, 1, 100),
    logLimitBytes: intValue(env, 'PORTAL_LOG_LIMIT_BYTES', 100 * 1024 * 1024, 1024 * 1024, 10 * 1024 * 1024 * 1024),
    artifactLimitBytes: intValue(
      env,
      'PORTAL_ARTIFACT_LIMIT_BYTES',
      1024 * 1024 * 1024,
      1024 * 1024,
      100 * 1024 * 1024 * 1024,
    ),
    minFreeBytes: intValue(env, 'PORTAL_MIN_FREE_BYTES', 256 * 1024 * 1024, 0, 1024 * 1024 * 1024 * 1024),
    maxStagingCandidates: intValue(env, 'PORTAL_MAX_STAGING_CANDIDATES', 400, 1, 10_000),
    imageRevision: env['PORTAL_IMAGE_REVISION']?.trim() || 'dev',
    targetsJson: env['PORTAL_TARGETS_JSON']?.trim() || null,
    credentialsJson: env['PORTAL_CREDENTIALS_JSON']?.trim() || null,
    testDbAdminUrl: env['PORTAL_TEST_DB_ADMIN_URL']?.trim() || null,
    testDbHost: env['PORTAL_TEST_DB_HOST']?.trim() || null,
    testDbPort: intValue(env, 'PORTAL_TEST_DB_PORT', 3306, 1, 65535),
    testDbUserPrefix: env['PORTAL_TEST_DB_USER_PREFIX']?.trim() || 'portal_test',
    stagingPrepared: boolValue(env, 'PORTAL_STAGING_PREPARED', false),
    stagingCapacity: intValue(env, 'PORTAL_STAGING_CAPACITY', 400, 1, 10_000),
    suiteTimeoutGraceSeconds: intValue(env, 'PORTAL_SUITE_TIMEOUT_GRACE_SECONDS', 300, 0, 3600),
    gracefulStopSeconds: intValue(env, 'PORTAL_GRACEFUL_STOP_SECONDS', 10, 1, 60),
    forceStopSeconds: intValue(env, 'PORTAL_FORCE_STOP_SECONDS', 5, 1, 60),
  };
}
