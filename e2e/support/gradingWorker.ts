import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Grading-projection worker lifecycle (shared by the backend-backed e2e
 * journey specs, e.g. E2E-01 and E2E-04).
 *
 * Environment gap (recorded, NOT fixed — production untouched): the playwright
 * webServer starts only `ielts-backend-api`. In the default
 * `background_runtime_mode=continuous` the API server does NOT run the grading
 * projection job (api/src/lib.rs spawns the activity-driven background runtime
 * only when `BACKGROUND_RUNTIME_MODE=activity_driven`); that job lives in the
 * `ielts-backend-worker` binary, which the webServer never starts. Verified in
 * E2E-01: `shared_cache_entries` has no `grading_projection_state_v1` row even
 * after submitted attempts exist, and `student_submissions` stays empty. The
 * specs therefore start the real worker binary themselves (test-only code) so
 * the grading-input DB assertions can verify real production behavior.
 *
 * The extracted surface is the proven E2E-01 implementation (same env
 * parsing, same spawn flags, same timeout semantics, same
 * WORKER_MAINTENANCE_INTERVAL_SECS pin, same SIGTERM→SIGKILL cleanup, same
 * alive-check semantics) — the shared helper for the second consumer, not a
 * re-implementation.
 */

const backendDir = path.resolve(process.cwd(), 'backend');
const workerBinary = path.join(backendDir, 'target', 'debug', 'ielts-backend-worker');
let workerProcess: ChildProcess | null = null;
let workerLog = '';

/** Keep the spawned worker a pure grading-projection engine for e2e journeys:
 *  push the maintenance loops (retention/media cleanup) far out so they cannot
 *  mutate shared test-DB rows mid-assertion. */
export const WORKER_MAINTENANCE_INTERVAL_SECS = '86400';

/** Parse backend/.env the same way the playwright webServer sources it. */
export function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      if ((first === '"' || first === "'") && value.endsWith(first)) {
        value = value.slice(1, -1);
      }
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Ensure the worker binary exists and is current. Always run cargo build (it
 * is a no-op when up to date) instead of skipping on existsSync so a stale
 * cached binary from an earlier checkout cannot silently serve the spec.
 * The webServer already built the api crate, warming the shared target dir.
 */
export async function buildWorkerIfNeeded(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      'cargo',
      ['build', '-p', 'ielts-backend-worker'],
      { cwd: backendDir, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

export function startWorker(): void {
  // backend/.env wins over the inherited shell env, exactly like the
  // playwright webServer's `set -a && . ./.env && set +a` for the API server.
  const backendEnv = parseEnvFile(path.join(backendDir, '.env'));
  workerLog = '';
  workerProcess = spawn(workerBinary, [], {
    cwd: backendDir,
    env: {
      ...process.env,
      ...backendEnv,
      WORKER_MAINTENANCE_INTERVAL_SECS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer) => {
    workerLog = (workerLog + chunk.toString()).slice(-16_000);
  };
  workerProcess.stdout?.on('data', capture);
  workerProcess.stderr?.on('data', capture);
}

export async function stopWorker(): Promise<void> {
  const worker = workerProcess;
  workerProcess = null;
  if (!worker || worker.exitCode !== null) return;
  worker.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => worker.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (worker.exitCode === null) worker.kill('SIGKILL');
}

export function workerAliveCheck(): null | string {
  const worker = workerProcess;
  if (!worker || worker.exitCode === null) return null;
  return `grading projection worker exited (code ${worker.exitCode}):\n${workerLog}`;
}
