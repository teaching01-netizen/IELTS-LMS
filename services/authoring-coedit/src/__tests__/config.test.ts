import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_ENVIRONMENT,
  DEFAULT_GO_BASE_URL,
  DEFAULT_MYSQL_DSN,
  DEFAULT_SERVICE_SECRET,
  DEFAULT_TOKEN_SECRET,
  loadConfig,
  singletonLockName,
} from "../config.js";

const VALID = {
  AUTHORING_COEDIT_ENVIRONMENT: "staging",
  AUTHORING_COEDIT_MYSQL_DSN: "mysql://user:pass@127.0.0.1:3306/app",
  AUTHORING_COEDIT_GO_BASE_URL: "https://api.internal.example/",
  AUTHORING_COEDIT_TOKEN_SECRET: "t".repeat(40),
  AUTHORING_COEDIT_SERVICE_SECRET: "s".repeat(40),
};

describe("loadConfig", () => {
  it("boots local development with the built-in co-edit defaults", () => {
    const config = loadConfig({});
    expect(config.environment).toBe(DEFAULT_ENVIRONMENT);
    expect(config.mysqlDsn).toBe(DEFAULT_MYSQL_DSN);
    expect(config.goBaseUrl).toBe(DEFAULT_GO_BASE_URL);
    expect(config.tokenSecret).toBe(DEFAULT_TOKEN_SECRET);
    expect(config.serviceSecret).toBe(DEFAULT_SERVICE_SECRET);
  });

  it("loads a valid environment and applies documented defaults", () => {
    const config = loadConfig({ ...VALID });
    expect(config.environment).toBe("staging");
    expect(config.port).toBe(1235);
    expect(config.host).toBe("0.0.0.0");
    expect(config.goBaseUrl).toBe("https://api.internal.example");
    expect(config.shutdownTimeoutMs).toBe(20_000);
    expect(config.lockTimeoutSeconds).toBe(30);
    expect(config.allowedOrigin).toBe("");
  });

  it("fails startup when a required value is missing", () => {
    expect(() => loadConfig({ ...VALID, AUTHORING_COEDIT_MYSQL_DSN: "  " })).toThrow(ConfigError);
  });

  it("rejects a token secret shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...VALID, AUTHORING_COEDIT_TOKEN_SECRET: "short" })).toThrow(
      /at least 32 bytes/,
    );
  });

  it("rejects a service secret shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...VALID, AUTHORING_COEDIT_SERVICE_SECRET: "short" })).toThrow(
      /at least 32 bytes/,
    );
  });

  it("rejects a non-absolute Go base URL", () => {
    expect(() => loadConfig({ ...VALID, AUTHORING_COEDIT_GO_BASE_URL: "/relative" })).toThrow(
      /absolute URL/,
    );
  });

  it("rejects a non-positive port", () => {
    expect(() => loadConfig({ ...VALID, AUTHORING_COEDIT_PORT: "0" })).toThrow(
      /positive integer/,
    );
  });

  it("names the lock per environment so staging and production never contend", () => {
    expect(singletonLockName("staging")).toBe("authoring-coedit:staging");
    expect(singletonLockName("production")).not.toBe(singletonLockName("staging"));
  });
});
