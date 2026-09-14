import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizeDocument,
  bodyHash,
  signServiceRequest,
  TokenError,
  verifyServiceRequest,
  verifyToken,
  type TokenClaims,
} from "../authToken.js";
import { parseDocumentName, sameDocumentName } from "../documentIdentity.js";

const SECRET = "t".repeat(40);
const SERVICE_SECRET = "s".repeat(40);
const DOCUMENT_NAME = "coedit:v1:2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d";

function baseClaims(overrides: Partial<TokenClaims> = {}): TokenClaims {
  const issuedAt = 1_700_000_000;
  return {
    version: 1,
    documentName: DOCUMENT_NAME,
    actorId: "actor-1",
    displayName: "Ada Author",
    organizationId: "org-1",
    examId: "exam-1",
    draftVersionId: "draft-1",
    examQuestionId: "question-1",
    questionRevisionId: "revision-1",
    mode: "write",
    issuedAt,
    expiresAt: issuedAt + 300,
    ...overrides,
  };
}

/** Mirrors Go's TokenIssuer byte-for-byte. */
function mintToken(claims: TokenClaims, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret);
  mac.update("authoring-coedit-token.v1.");
  mac.update(body);
  return `${body}.${mac.digest("base64url")}`;
}

const NOW = () => 1_700_000_010_000;

describe("verifyToken", () => {
  it("accepts a well-formed token signed by the dedicated secret", () => {
    const claims = verifyToken(mintToken(baseClaims()), { tokenSecret: SECRET, now: NOW });
    expect(claims.actorId).toBe("actor-1");
    expect(claims.mode).toBe("write");
  });

  it("rejects a token signed with another secret", () => {
    const token = mintToken(baseClaims(), "x".repeat(40));
    expect(() => verifyToken(token, { tokenSecret: SECRET, now: NOW })).toThrow(/signature/);
  });

  it("rejects an expired token", () => {
    const token = mintToken(baseClaims({ expiresAt: 1_600_000_000 }));
    expect(() => verifyToken(token, { tokenSecret: SECRET, now: NOW })).toThrow(/expired/);
  });

  it("rejects an unsupported token version", () => {
    const token = mintToken(baseClaims({ version: 2 as unknown as 1 }));
    expect(() => verifyToken(token, { tokenSecret: SECRET, now: NOW })).toThrow(/version/);
  });

  it("rejects a malformed payload and a missing token", () => {
    expect(() => verifyToken("not-a-token", { tokenSecret: SECRET })).toThrow(TokenError);
    expect(() => verifyToken("", { tokenSecret: SECRET })).toThrow(TokenError);
    expect(() => verifyToken(undefined, { tokenSecret: SECRET })).toThrow(TokenError);
  });

  it("rejects an invalid mode", () => {
    const token = mintToken(baseClaims({ mode: "admin" as unknown as "write" }));
    expect(() => verifyToken(token, { tokenSecret: SECRET, now: NOW })).toThrow(/mode/);
  });

  it("accepts a read token", () => {
    const claims = verifyToken(mintToken(baseClaims({ mode: "read" })), {
      tokenSecret: SECRET,
      now: NOW,
    });
    expect(claims.mode).toBe("read");
  });
});

describe("authorizeDocument", () => {
  it("accepts the signed document name", () => {
    expect(authorizeDocument(DOCUMENT_NAME, baseClaims())).toBe(DOCUMENT_NAME);
  });

  it("rejects a token replayed against another room", () => {
    const other = "coedit:v1:11111111-2222-3333-4444-555555555555";
    expect(() => authorizeDocument(other, baseClaims())).toThrow(/does not match/);
  });

  it("rejects a client-invented room name", () => {
    expect(() => authorizeDocument("exam:question:1", baseClaims())).toThrow(TokenError);
  });
});

describe("document identity", () => {
  it("parses only the frozen opaque prefix", () => {
    expect(parseDocumentName(DOCUMENT_NAME)?.documentId).toBe(
      "2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d",
    );
    expect(parseDocumentName("coedit:v1:")).toBeNull();
    expect(parseDocumentName("coedit:v2:abc")).toBeNull();
    expect(parseDocumentName("coedit:v1:has space")).toBeNull();
  });

  it("compares names exactly", () => {
    expect(sameDocumentName(DOCUMENT_NAME, ` ${DOCUMENT_NAME} `)).toBe(true);
    expect(sameDocumentName(DOCUMENT_NAME, "coedit:v1:other")).toBe(false);
    expect(sameDocumentName(null, DOCUMENT_NAME)).toBe(false);
  });
});

describe("service request signing", () => {
  const body = JSON.stringify({ documentName: DOCUMENT_NAME });

  it("accepts a freshly signed request", () => {
    const { timestamp, signature } = signServiceRequest(
      SERVICE_SECRET,
      "POST",
      "/internal/authoring-coedit/store",
      body,
      1_700_000_010,
    );
    expect(() =>
      verifyServiceRequest({
        secret: SERVICE_SECRET,
        method: "POST",
        path: "/internal/authoring-coedit/store",
        timestamp,
        signature,
        body,
        now: NOW,
      }),
    ).not.toThrow();
  });

  it("rejects a timestamp outside the 30 second window", () => {
    const { timestamp, signature } = signServiceRequest(
      SERVICE_SECRET,
      "POST",
      "/internal/authoring-coedit/store",
      body,
      1_699_999_000,
    );
    expect(() =>
      verifyServiceRequest({
        secret: SERVICE_SECRET,
        method: "POST",
        path: "/internal/authoring-coedit/store",
        timestamp,
        signature,
        body,
        now: NOW,
      }),
    ).toThrow(/window/);
  });

  it("rejects a body that does not match the signature", () => {
    const { timestamp, signature } = signServiceRequest(
      SERVICE_SECRET,
      "POST",
      "/internal/authoring-coedit/store",
      body,
      1_700_000_010,
    );
    expect(() =>
      verifyServiceRequest({
        secret: SERVICE_SECRET,
        method: "POST",
        path: "/internal/authoring-coedit/store",
        timestamp,
        signature,
        body: '{"documentName":"other"}',
        now: NOW,
      }),
    ).toThrow(/invalid/);
  });

  it("rejects a signature over a different path", () => {
    const { timestamp, signature } = signServiceRequest(
      SERVICE_SECRET,
      "POST",
      "/internal/authoring-coedit/load",
      body,
      1_700_000_010,
    );
    expect(() =>
      verifyServiceRequest({
        secret: SERVICE_SECRET,
        method: "POST",
        path: "/internal/authoring-coedit/store",
        timestamp,
        signature,
        body,
        now: NOW,
      }),
    ).toThrow(/invalid/);
  });

  it("hashes the body so a replay cannot smuggle a different payload", () => {
    expect(bodyHash("a")).not.toBe(bodyHash("b"));
  });
});
