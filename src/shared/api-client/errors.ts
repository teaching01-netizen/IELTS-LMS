/** Typed backend error classifier (plan 100). Never surfaces raw backend strings as copy. */
import { classifyBackendCode, type ConflictKind } from '../error-codes';

export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not-found'
  | 'conflict'
  | 'fenced'
  | 'stale-control'
  | 'deadline'
  | 'rate-limit'
  | 'network'
  | 'server'
  | 'unknown';

export interface ApiErrorShape {
  code: string;
  message: string;
  requestId?: string | undefined;
  status: number;
  details?: Record<string, unknown> | undefined;
}

export class ApiError extends Error {
  code: string;
  requestId?: string | undefined;
  status: number;
  /** Transport-agnostic detail payload (backend `error.details`). */
  details?: Record<string, unknown> | undefined;
  /** Legacy alias of `status` (previous ApiClient `statusCode`). Prefer `status`. */
  statusCode: number;
  /** Legacy alias of `code`. Prefer `code`. */
  backendCode: string;
  /** Legacy alias of `details`. Prefer `details`. */
  backendDetails?: Record<string, unknown> | undefined;
  /** Legacy alias of `requestId`. Prefer `requestId`. */
  backendRequestId?: string | undefined;
  category: ErrorCategory;
  conflict: ConflictKind;
  constructor(shape: ApiErrorShape) {
    super(shape.message || shape.code);
    this.name = 'ApiError';
    this.code = shape.code;
    this.requestId = shape.requestId;
    this.status = shape.status;
    this.details = shape.details;
    this.statusCode = shape.status;
    this.backendCode = shape.code;
    this.backendDetails = shape.details;
    this.backendRequestId = shape.requestId;
    const c = classifyBackendCode(shape.code, shape.requestId);
    this.conflict = c.kind;
    this.category = toCategory(shape.status, c.kind);
  }
}

function toCategory(status: number, kind: ConflictKind): ErrorCategory {
  if (status === 401) return 'authentication';
  if (status === 403 && kind !== 'lease-fenced') return 'authorization';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  if (kind === 'lease-fenced') return 'fenced';
  if (kind === 'stale-control') return 'stale-control';
  if (kind === 'deadline') return 'deadline';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  return 'unknown';
}

export function userMessage(e: ApiError): string {
  switch (e.category) {
    case 'fenced':
      return 'Another device took over this attempt. Recover to continue.';
    case 'stale-control':
      return 'The exam state changed. Refreshing before retry.';
    case 'deadline':
      return 'The response deadline has passed.';
    case 'rate-limit':
      return 'Too many requests. Waiting before retry.';
    case 'network':
      return 'Connection lost. Your answers are saved locally and will sync.';
    default:
      return e.requestId ? `Something went wrong (ref ${e.requestId}).` : 'Something went wrong.';
  }
}
