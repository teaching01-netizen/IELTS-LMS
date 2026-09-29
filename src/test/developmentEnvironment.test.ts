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

describe("development environment wiring", () => {
  it("preserves the browser origin for backend CSRF validation in dev", () => {
    const config = viteConfigFactory({ command: "serve", mode: "development" });

    expect(config.server?.proxy).toBeDefined();
    expect(config.server?.proxy?.["/api"]).toMatchObject({
      target: "http://127.0.0.1:4000",
      changeOrigin: false,
    });
  });

  it("aligns backend compose ports, env defaults, and bootstrap flow", () => {
    const compose = readBackendFile("docker-compose.yml");
    const backendEnvExample = readBackendFile(".env.example");
    const goModule = readBackendFile("go/go.mod");
    const goApi = readBackendFile("go/cmd/api/main.go");
    const goMigrator = readBackendFile("go/cmd/migrate/main.go");

    expect(compose).toContain("pingcap/tidb");
    expect(compose).toContain('"4000:4000"');
    expect(compose).toContain("mysqladmin ping");

    for (const key of [
      "DATABASE_URL",
      "DATABASE_DIRECT_URL",
      "DATABASE_MIGRATOR_URL",
      "DATABASE_WORKER_URL",
    ]) {
      expect(backendEnvExample).toMatch(new RegExp(`${key}=(?:mysql://|[^\\n=]*@tcp\\()[^\\n]+`));
    }

    expect(goModule).toContain("module example.com/ielts-proctoring");
    expect(goApi).toContain("func main()");
    expect(goMigrator).toContain("func main()");
  });
});
