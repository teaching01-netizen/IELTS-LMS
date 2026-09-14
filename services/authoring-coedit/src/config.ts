/**
 * Validated environment configuration.
 *
 * Production-like deployments fail startup when dedicated secrets are missing
 * or unusable. Local development has matching built-in defaults so the
 * sidecar can be started without a second environment file.
 */
export const MIN_SECRET_BYTES = 32;
export const DEFAULT_PORT = 1235;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000;
export const DEFAULT_LOCK_TIMEOUT_SECONDS = 30;
export const FREEZE_LEASE_SECONDS = 30;
export const DEFAULT_ENVIRONMENT = "development";
export const DEFAULT_MYSQL_DSN = "mysql://root:root@127.0.0.1:3306/ielts_go_fresh";
export const DEFAULT_GO_BASE_URL = "http://127.0.0.1:4000";
// These defaults are intentionally development-only. The Go API uses the same
// values so a local sidecar can start without a second secret/configuration
// file; production-like environments still fail closed when they are absent.
export const DEFAULT_TOKEN_SECRET = "local-coedit-token-secret-not-for-production-2026";
export const DEFAULT_SERVICE_SECRET = "local-coedit-service-secret-not-for-production-2026";

export interface CoeditServiceConfig {
  environment: string;
  port: number;
  host: string;
  mysqlDsn: string;
  goBaseUrl: string;
  tokenSecret: string;
  serviceSecret: string;
  shutdownTimeoutMs: number;
  lockTimeoutSeconds: number;
  /** Allowed browser origin for the service; empty disables the check. */
  allowedOrigin: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = (env[name] ?? "").trim();
  if (!value) throw new ConfigError(`${name} is required.`);
  return value;
}

function productionLike(environment: string): boolean {
  return ["production", "prod", "staging", "stage", "preview"].includes(
    environment.trim().toLowerCase(),
  );
}

function valueOrLocalDefault(
  env: Record<string, string | undefined>,
  name: string,
  fallback: string,
  environment: string,
): string {
  const value = (env[name] ?? "").trim();
  if (value) return value;
  if (productionLike(environment)) return required(env, name);
  return fallback;
}

function secret(
  env: Record<string, string | undefined>,
  name: string,
  fallback: string,
  environment: string,
): string {
  const value = valueOrLocalDefault(env, name, fallback, environment);
  if (value.length < MIN_SECRET_BYTES) {
    throw new ConfigError(`${name} must be at least ${MIN_SECRET_BYTES} bytes.`);
  }
  return value;
}

function intOr(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = (env[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function absoluteUrl(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL.`);
  }
  if (!url.protocol || !url.host) {
    throw new ConfigError(`${name} must be an absolute URL.`);
  }
  return url.toString().replace(/\/$/, "");
}

export function loadConfig(env: Record<string, string | undefined> = process.env): CoeditServiceConfig {
  const environment =
    (env["AUTHORING_COEDIT_ENVIRONMENT"] ?? env["APP_ENV"] ?? env["ENVIRONMENT"] ?? "")
      .trim() || DEFAULT_ENVIRONMENT;
  const inheritedMysqlDsn = (env["DATABASE_URL"] ?? "").trim();
  const mysqlDsn = valueOrLocalDefault(
    env,
    "AUTHORING_COEDIT_MYSQL_DSN",
    inheritedMysqlDsn.startsWith("mysql://") ? inheritedMysqlDsn : DEFAULT_MYSQL_DSN,
    environment,
  );
  return {
    environment,
    port: intOr(env, "AUTHORING_COEDIT_PORT", DEFAULT_PORT),
    host: (env["AUTHORING_COEDIT_HOST"] ?? "").trim() || "0.0.0.0",
    mysqlDsn,
    goBaseUrl: absoluteUrl(
      valueOrLocalDefault(env, "AUTHORING_COEDIT_GO_BASE_URL", DEFAULT_GO_BASE_URL, environment),
      "AUTHORING_COEDIT_GO_BASE_URL",
    ),
    tokenSecret: secret(
      env,
      "AUTHORING_COEDIT_TOKEN_SECRET",
      DEFAULT_TOKEN_SECRET,
      environment,
    ),
    serviceSecret: secret(
      env,
      "AUTHORING_COEDIT_SERVICE_SECRET",
      DEFAULT_SERVICE_SECRET,
      environment,
    ),
    shutdownTimeoutMs: intOr(
      env,
      "AUTHORING_COEDIT_SHUTDOWN_TIMEOUT_MS",
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
    ),
    lockTimeoutSeconds: intOr(
      env,
      "AUTHORING_COEDIT_LOCK_TIMEOUT_SECONDS",
      DEFAULT_LOCK_TIMEOUT_SECONDS,
    ),
    allowedOrigin: (env["AUTHORING_COEDIT_ALLOWED_ORIGIN"] ?? "").trim(),
  };
}

/** Name of the environment-scoped advisory lock. */
export function singletonLockName(environment: string): string {
  return `authoring-coedit:${environment}`;
}
