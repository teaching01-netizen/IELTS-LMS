import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { Request } from 'express';
import type { PortalConfig } from './config';
import { PortalError } from './contracts';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = 'portal_session';
export const CSRF_HEADER = 'x-portal-csrf';

interface SessionRecord {
  operatorId: string;
  csrfToken: string;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthenticatedSession {
  operatorId: string;
  csrfToken: string;
  expiresAt: string;
}

/** Hash a portal operator password for PORTAL_OPERATOR_PASSWORD_HASH. */
export function hashPortalPassword(password: string): string {
  if (password.length < 12) throw new Error('Portal operator password must be at least 12 characters.');
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export function verifyPortalPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  if (n > 1 << 20 || r > 32 || p > 16) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64');
    expected = Buffer.from(parts[5] ?? '', 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly sweeper: NodeJS.Timeout;

  constructor(ttlHours: number) {
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    this.sweeper = setInterval(() => this.sweep(), 5 * 60 * 1000);
    this.sweeper.unref();
  }

  create(operatorId: string, now = Date.now()): { token: string; session: AuthenticatedSession } {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const record: SessionRecord = {
      operatorId,
      csrfToken,
      issuedAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(hashToken(token), record);
    return {
      token,
      session: {
        operatorId,
        csrfToken,
        expiresAt: new Date(record.expiresAt).toISOString(),
      },
    };
  }

  get(token: string | null, now = Date.now()): { operatorId: string; csrfToken: string; expiresAt: number } | null {
    if (!token) return null;
    const key = hashToken(token);
    const record = this.sessions.get(key);
    if (!record) return null;
    if (record.expiresAt <= now) {
      this.sessions.delete(key);
      return null;
    }
    return { operatorId: record.operatorId, csrfToken: record.csrfToken, expiresAt: record.expiresAt };
  }

  revoke(token: string | null): void {
    if (token) this.sessions.delete(hashToken(token));
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  private sweep(now = Date.now()): void {
    for (const [key, record] of this.sessions) {
      if (record.expiresAt <= now) this.sessions.delete(key);
    }
  }
}

interface ThrottleEntry {
  failures: number;
  windowStart: number;
  blockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, ThrottleEntry>();
  private readonly maxEntries: number;
  readonly windowMs: number;
  readonly maxFailures: number;
  readonly lockoutMs: number;

  constructor(options?: { maxEntries?: number; windowMs?: number; maxFailures?: number; lockoutMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 10_000;
    this.windowMs = options?.windowMs ?? 15 * 60 * 1000;
    this.maxFailures = options?.maxFailures ?? 5;
    this.lockoutMs = options?.lockoutMs ?? 15 * 60 * 1000;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true, retryAfterSeconds: 0 };
    if (entry.blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    if (now - entry.windowStart > this.windowMs) {
      this.entries.delete(key);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(key: string, now = Date.now()): void {
    this.evictIfNeeded(now);
    const existing = this.entries.get(key);
    if (!existing || now - existing.windowStart > this.windowMs) {
      this.entries.set(key, { failures: 1, windowStart: now, blockedUntil: 0 });
      return;
    }
    existing.failures += 1;
    if (existing.failures >= this.maxFailures) {
      existing.blockedUntil = now + this.lockoutMs;
    }
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  private evictIfNeeded(now: number): void {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (entry.blockedUntil <= now && now - entry.windowStart > this.windowMs) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function sessionTokenFromRequest(req: Request): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;
}

export function requireSession(store: SessionStore, req: Request): AuthenticatedSession {
  const record = store.get(sessionTokenFromRequest(req));
  if (!record) {
    throw new PortalError(401, 'UNAUTHENTICATED', 'Sign in to the test portal.');
  }
  return {
    operatorId: record.operatorId,
    csrfToken: record.csrfToken,
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

function tokenEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Hosted deployments require an exact Origin on every authenticated
 * mutation. Without a configured public origin (local development), a
 * missing Origin is tolerated for non-browser clients, but a supplied Origin
 * must still match the request host.
 */
export function assertTrustedOrigin(req: Request, config: PortalConfig): void {
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  if (config.publicOrigin) {
    if (!origin) {
      throw new PortalError(403, 'FORBIDDEN', 'Missing Origin header.');
    }
    if (origin !== config.publicOrigin) {
      throw new PortalError(403, 'FORBIDDEN', 'Origin is not allowed.');
    }
    return;
  }
  if (origin) {
    const expected = `${req.protocol}://${req.get('host') ?? ''}`;
    if (origin !== expected) {
      throw new PortalError(403, 'FORBIDDEN', 'Origin is not allowed.');
    }
    return;
  }
  if (fetchSite === 'cross-site') {
    throw new PortalError(403, 'FORBIDDEN', 'Cross-site request denied.');
  }
}

export function assertCsrf(req: Request, session: AuthenticatedSession): void {
  const supplied = req.get(CSRF_HEADER);
  if (!supplied || !tokenEquals(supplied, session.csrfToken)) {
    throw new PortalError(403, 'FORBIDDEN', 'Invalid CSRF token.');
  }
}

export function trustedClientIdentity(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function setSessionCookie(
  res: { setHeader: (name: string, value: string | string[]) => void },
  token: string,
  config: PortalConfig,
): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${config.sessionHours * 60 * 60}`,
  ];
  if (config.secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: { setHeader: (name: string, value: string | string[]) => void }, config: PortalConfig): void {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (config.secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
