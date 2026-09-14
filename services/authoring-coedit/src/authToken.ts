import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import {
  FIELD_SET_PROMPT,
  FIELD_SET_WORKSPACE,
  parseAnyDocumentName,
  sameDocumentName,
} from "./documentIdentity.js";

/**
 * Browser co-edit token verification.
 *
 * Byte-compatible with Go's authoringcoedit.TokenIssuer:
 *   `<base64url(payload-json)>.<base64url(HMAC-SHA256("authoring-coedit-token.v1." + body))>`
 *
 * The payload carries only server-signed claims. A connection is authorized by
 * the CLAIMS, never by anything the browser sends alongside them.
 */
export const TOKEN_VERSION = 1;
export const MAX_CLOCK_SKEW_SECONDS = 5;

export type AuthMode = "write" | "read";

export interface TokenClaims {
  version: number;
  documentName: string;
  actorId: string;
  displayName: string;
  organizationId: string | null;
  examId: string;
  draftVersionId: string;
  examQuestionId?: string;
  questionRevisionId?: string;
  fieldSet?: "prompt" | "workspace";
  mode: AuthMode;
  issuedAt: number;
  expiresAt: number;
}

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

function signTokenBody(secret: string, body: string): string {
  const mac = createHmac("sha256", secret);
  mac.update("authoring-coedit-token.v1.");
  mac.update(body);
  return mac.digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyToken(
  token: unknown,
  options: { tokenSecret: string; now?: () => number },
): TokenClaims {
  const raw = typeof token === "string" ? token.trim() : "";
  if (!raw) throw new TokenError("Co-edit token is missing.");
  const parts = raw.split(".");
  if (parts.length !== 2) throw new TokenError("Co-edit token is malformed.");
  const [body, signature] = parts as [string, string];
  const expected = signTokenBody(options.tokenSecret, body);
  if (!safeEqual(expected, signature)) throw new TokenError("Co-edit token signature is invalid.");

  let decoded: string;
  try {
    decoded = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    throw new TokenError("Co-edit token payload is invalid.");
  }
  let claims: Partial<TokenClaims>;
  try {
    claims = JSON.parse(decoded) as Partial<TokenClaims>;
  } catch {
    throw new TokenError("Co-edit token payload is not JSON.");
  }
  if (claims.version !== TOKEN_VERSION) throw new TokenError("Co-edit token version is unsupported.");
  if (claims.mode !== "write" && claims.mode !== "read") {
    throw new TokenError("Co-edit token mode is invalid.");
  }
  const parsedDocument = parseAnyDocumentName(claims.documentName);
  if (!parsedDocument) {
    throw new TokenError("Co-edit token document name is invalid.");
  }
  for (const field of ["actorId", "examId", "draftVersionId"] as const) {
    if (typeof claims[field] !== "string" || !(claims[field] as string).trim()) {
      throw new TokenError("Co-edit token is missing required claims.");
    }
  }
  const fieldSet = claims.fieldSet ?? parsedDocument.fieldSet;
  if (fieldSet !== parsedDocument.fieldSet) throw new TokenError("Co-edit token field set is invalid.");
  if (fieldSet === FIELD_SET_PROMPT && (!claims.examQuestionId?.trim() || !claims.questionRevisionId?.trim())) {
    throw new TokenError("Co-edit token is missing prompt claims.");
  }
  if (fieldSet === FIELD_SET_WORKSPACE && (claims.examQuestionId || claims.questionRevisionId)) {
    throw new TokenError("Workspace token contains prompt claims.");
  }
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  if (typeof claims.expiresAt !== "number" || claims.expiresAt <= nowSeconds - MAX_CLOCK_SKEW_SECONDS) {
    throw new TokenError("Co-edit token has expired.");
  }
  return claims as TokenClaims;
}

/**
 * Authorization rule: the REQUESTED document name must equal the SIGNED name.
 *
 * Without this, a token minted for one question could be replayed against
 * another room the actor knows the id of.
 */
export function authorizeDocument(requestedName: unknown, claims: TokenClaims): string {
  const parsed = parseAnyDocumentName(requestedName);
  if (!parsed) throw new TokenError("Requested document name is invalid.");
  if (!sameDocumentName(parsed.documentName, claims.documentName)) {
    throw new TokenError("Requested document does not match the signed token.");
  }
  return parsed.documentName;
}

/**
 * Private Go <-> service request signing.
 *
 * Covers method, path, timestamp, and body hash. Timestamps outside the window
 * are rejected. Store and lifecycle requests are idempotent, so a replay inside
 * the window cannot apply the same state twice.
 */
export const SERVICE_SIGNATURE_WINDOW_SECONDS = 30;
export const SERVICE_TIMESTAMP_HEADER = "x-coedit-timestamp";
export const SERVICE_SIGNATURE_HEADER = "x-coedit-signature";

export function bodyHash(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function signServiceRequest(
  secret: string,
  method: string,
  path: string,
  body: Buffer | string,
  timestampSeconds: number,
): { timestamp: string; signature: string } {
  const timestamp = String(timestampSeconds);
  return {
    timestamp,
    signature: serviceSignature(secret, method, path, timestamp, bodyHash(body)),
  };
}

function serviceSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  hash: string,
): string {
  const mac = createHmac("sha256", secret);
  mac.update("authoring-coedit-service.v1\n");
  mac.update(method.toUpperCase());
  mac.update("\n");
  mac.update(path);
  mac.update("\n");
  mac.update(timestamp);
  mac.update("\n");
  mac.update(hash);
  return mac.digest("base64url");
}

export function verifyServiceRequest(input: {
  secret: string;
  method: string;
  path: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: Buffer | string;
  now?: () => number;
}): void {
  const { secret, method, path, body } = input;
  const timestamp = (input.timestamp ?? "").trim();
  const signature = (input.signature ?? "").trim();
  if (!timestamp || !signature) throw new TokenError("Service signature is missing.");
  const parsed = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsed)) throw new TokenError("Service signature timestamp is invalid.");
  const nowSeconds = Math.floor((input.now?.() ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - parsed) > SERVICE_SIGNATURE_WINDOW_SECONDS) {
    throw new TokenError("Service signature timestamp is outside the accepted window.");
  }
  const expected = serviceSignature(secret, method, path, timestamp, bodyHash(body));
  if (!safeEqual(expected, signature)) {
    throw new TokenError("Service signature is invalid.");
  }
}
