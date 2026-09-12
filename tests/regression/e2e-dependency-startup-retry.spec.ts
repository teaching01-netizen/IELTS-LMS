import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const startupScript = join(repositoryRoot, ".github/scripts/start-e2e-dependencies.sh");

function createFakeDocker(firstFailures: number) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "e2e-dependency-retry-"));
  const attemptFile = join(temporaryDirectory, "attempts");
  const commandFile = join(temporaryDirectory, "commands");
  const dockerPath = join(temporaryDirectory, "docker");

  writeFileSync(
    dockerPath,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "${commandFile}"
if [ "$1" = "compose" ] && printf '%s' "$*" | grep -q ' up '; then
  attempt=0
  if [ -f "${attemptFile}" ]; then attempt=$(cat "${attemptFile}"); fi
  attempt=$((attempt + 1))
  printf '%s' "$attempt" > "${attemptFile}"
  if [ "$attempt" -le "${firstFailures}" ]; then exit 1; fi
fi
exit 0
`,
    { mode: 0o755 }
  );

  return { temporaryDirectory, attemptFile, commandFile, dockerPath };
}

describe("E2E dependency startup", () => {
  // Scenario: a fresh CI runner can fail the first Docker Compose startup transiently.
  // Invariant: dependency startup retries and exposes diagnostics before failing the job.
  // Previous bug: one startup failure skipped every E2E test without actionable logs.
  it("retries transient Docker Compose startup failures before succeeding", () => {
    const fakeDocker = createFakeDocker(2);

    try {
      execFileSync("bash", [startupScript], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: `${fakeDocker.temporaryDirectory}:${process.env["PATH"] ?? ""}`,
          E2E_COMPOSE_ATTEMPTS: "3",
          E2E_COMPOSE_RETRY_DELAY_SECONDS: "0",
        },
        stdio: "pipe",
      });

      expect(readFileSync(fakeDocker.attemptFile, "utf8")).toBe("3");
    } finally {
      rmSync(fakeDocker.temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("fails after the retry budget and leaves diagnostics enabled", () => {
    const fakeDocker = createFakeDocker(10);

    try {
      expect(() =>
        execFileSync("bash", [startupScript], {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            PATH: `${fakeDocker.temporaryDirectory}:${process.env["PATH"] ?? ""}`,
            E2E_COMPOSE_ATTEMPTS: "2",
            E2E_COMPOSE_RETRY_DELAY_SECONDS: "0",
          },
          stdio: "pipe",
        })
      ).toThrow();

      expect(readFileSync(fakeDocker.attemptFile, "utf8")).toBe("2");
      const commands = readFileSync(fakeDocker.commandFile, "utf8");
      expect(commands).toMatch(/compose .* ps/);
      expect(commands).toMatch(/compose .* logs/);
    } finally {
      rmSync(fakeDocker.temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("passes a CI-only compose override to dependency startup", () => {
    const fakeDocker = createFakeDocker(0);
    const overrideFile = join(fakeDocker.temporaryDirectory, "compose.override.yml");
    writeFileSync(overrideFile, "services: {}\n");

    try {
      execFileSync("bash", [startupScript], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: `${fakeDocker.temporaryDirectory}:${process.env["PATH"] ?? ""}`,
          E2E_COMPOSE_OVERRIDE_FILE: overrideFile,
          E2E_COMPOSE_ATTEMPTS: "1",
          E2E_COMPOSE_RETRY_DELAY_SECONDS: "0",
        },
        stdio: "pipe",
      });

      const commands = readFileSync(fakeDocker.commandFile, "utf8");
      expect(commands).toContain(
        `compose -f backend/docker-compose.yml -f ${overrideFile} up -d --wait tidb minio`
      );
    } finally {
      rmSync(fakeDocker.temporaryDirectory, { recursive: true, force: true });
    }
  });
});
