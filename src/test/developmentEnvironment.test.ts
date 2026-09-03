// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import viteConfigFactory from "../../vite.config";

const projectRoot = path.resolve(__dirname, "../..");
const backendRoot = path.join(projectRoot, "backend");

function readBackendFile(relativePath: string): string {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function readOptionalBackendEnv(): string {
  const envPath = path.join(backendRoot, ".env");
  return fs.existsSync(envPath) ? readBackendFile(".env") : readBackendFile(".env.example");
}

describe("development environment wiring", () => {
  it("preserves the browser origin for backend CSRF validation in dev", () => {
    const config = viteConfigFactory({ command: "serve", mode: "development" });

    expect(config.server?.proxy).toBeDefined();
    expect(config.server?.proxy?.["/api"]).toMatchObject({
      target: "http://127.0.0.1:4001",
      changeOrigin: false,
    });
  });

  it("aligns backend compose ports, env defaults, and bootstrap flow", () => {
    const compose = readBackendFile("docker-compose.yml");
    // `.env` is a local-only override and is intentionally not committed.
    const backendEnv = readOptionalBackendEnv();
    const backendEnvExample = readBackendFile(".env.example");
    const makefile = readBackendFile("Makefile");

    expect(compose).toContain("pingcap/tidb");
    expect(compose).toContain('"4000:4000"');
    expect(compose).toContain("curl -fsS http://127.0.0.1:10080/status");
    expect(compose).not.toContain("mysqladmin ping");

    for (const envFile of [backendEnv, backendEnvExample]) {
      expect(envFile).toMatch(/API_PORT=4001/);
      expect(envFile).toMatch(/DATABASE_URL=mysql:\/\/root@127\.0\.0\.1:4000\/ielts/);
      expect(envFile).toMatch(/DATABASE_DIRECT_URL=mysql:\/\/root@127\.0\.0\.1:4000\/ielts/);
      expect(envFile).toMatch(/DATABASE_MIGRATOR_URL=mysql:\/\/root@127\.0\.0\.1:4000\/ielts/);
      expect(envFile).toMatch(/DATABASE_WORKER_URL=mysql:\/\/root@127\.0\.0\.1:4000\/ielts/);
    }
    expect(backendEnv).toMatch(/TEST_DATABASE_URL=mysql:\/\/root@127\.0\.0\.1:4000\/ielts/);
    expect(backendEnv).toMatch(/BACKEND_BASE_URL=http:\/\/127\.0\.0\.1:4001/);
    expect(backendEnvExample).toMatch(/BACKEND_BASE_URL=http:\/\/127\.0\.0\.1:4001/);

    expect(makefile).toContain("docker-compose.yml up -d --wait tidb minio");
    expect(makefile).toContain("source .env");
    expect(makefile).toContain("$(CARGO) run -p ielts-backend-api --bin ielts-backend-api");
    expect(makefile).toContain('TEST_DATABASE_URL="$${TEST_DATABASE_URL:-$${DATABASE_URL}}"');
  });
});
