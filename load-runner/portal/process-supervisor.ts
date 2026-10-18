import { spawn, type ChildProcess } from 'node:child_process';
import type { CommandResultKind } from './catalog';
import type { Redactor } from './evidence';
import { LineSplitter } from './evidence';

/**
 * Process supervisor: fixed argv spawns (shell disabled), allowlisted
 * environments, process-group termination, deadlines, and verified cleanup.
 *
 * A parent exit is never treated as proof that descendants stopped: the
 * supervisor tracks the process group and reports cleanupUnverified when it
 * cannot confirm termination.
 */

export interface StepSpec {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  deadlineMs: number;
  resultKind: CommandResultKind;
}

export interface StepOutcome {
  label: string;
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  spawnError: string | null;
  timedOut: boolean;
  cancelled: boolean;
  cancelledAfterExit: boolean;
  outputTruncated: boolean;
  cleanupUnverified: boolean;
  processId: number | null;
}

export interface SupervisorOptions {
  baseEnv: Record<string, string | undefined>;
  redactor: Redactor;
  onLog: (line: string) => void;
  gracefulStopSeconds: number;
  forceStopSeconds: number;
  maxOutputCharsPerStream?: number;
}

const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'CI',
  'NODE_ENV',
  'HOSTNAME',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
] as const;

export function buildAllowlistedEnv(
  base: Record<string, string | undefined>,
  extra: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = base[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  return { ...env, ...extra };
}

/** Production DB mutation flags must never be truthy for a supervised child. */
export function assertNoProductionDbMutation(env: Record<string, string>): void {
  const guards = ['E2E_PROD_PROVISION_STAFF_DB', 'E2E_ALLOW_PROD_DB_MUTATIONS'];
  for (const key of guards) {
    const value = env[key];
    if (value === 'true' || value === '1') {
      throw new Error(`Refusing to launch a child with ${key}=${value}.`);
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class ProcessSupervisor {
  private readonly options: SupervisorOptions;
  private readonly maxOutputChars: number;
  private readonly tracked = new Set<number>();

  constructor(options: SupervisorOptions) {
    this.options = options;
    this.maxOutputChars = options.maxOutputCharsPerStream ?? 200_000;
  }

  trackedProcessIds(): number[] {
    return [...this.tracked];
  }

  async runStep(
    spec: StepSpec,
    control: { signal: AbortSignal; onSpawn?: (pid: number) => void },
  ): Promise<StepOutcome> {
    assertNoProductionDbMutation(spec.env);
    const startedAt = Date.now();
    const stdoutSplitter = new LineSplitter();
    const stderrSplitter = new LineSplitter();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let stdoutChars = 0;
    let stderrChars = 0;
    let outputTruncated = false;

    const append = (target: string[], text: string, stream: 'stdout' | 'stderr'): void => {
      const used = stream === 'stdout' ? stdoutChars : stderrChars;
      if (used >= this.maxOutputChars) {
        outputTruncated = true;
        return;
      }
      const slice = text.slice(0, this.maxOutputChars - used);
      if (slice.length < text.length) outputTruncated = true;
      target.push(slice);
      if (stream === 'stdout') stdoutChars += slice.length;
      else stderrChars += slice.length;
      if (target.length > 4_000) {
        target.shift();
        outputTruncated = true;
      }
    };

    let child: ChildProcess;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        shell: false,
      });
    } catch (error) {
      return this.baseOutcome(spec, startedAt, {
        spawnError: error instanceof Error ? error.message : String(error),
      });
    }

    const pid = child.pid ?? null;
    if (pid !== null) {
      this.tracked.add(pid);
      control.onSpawn?.(pid);
    }

    let spawnError: string | null = null;
    let timedOut = false;
    let cancelled = false;
    let closed = false;
    let cleanupUnverified = false;
    let killTimer: NodeJS.Timeout | null = null;
    let hardStopTimer: NodeJS.Timeout | null = null;

    const outcomePromise = new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      cancelledAfterExit: boolean;
    }>((resolve) => {
      child.on('error', (error) => {
        spawnError = error instanceof Error ? error.message : String(error);
      });
      child.on('close', (code, signal) => {
        closed = true;
        if (killTimer) clearInterval(killTimer);
        if (hardStopTimer) clearTimeout(hardStopTimer);
        if (pid !== null) this.tracked.delete(pid);
        resolve({ exitCode: code, signal: signal ?? null, cancelledAfterExit: cancelled });
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of stdoutSplitter.push(this.options.redactor.push(chunk.toString('utf8')))) {
          append(stdout, line, 'stdout');
          this.options.onLog(`[${spec.label}] ${line}`);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        for (const line of stderrSplitter.push(this.options.redactor.push(chunk.toString('utf8')))) {
          append(stderr, line, 'stderr');
          this.options.onLog(`[${spec.label}][stderr] ${line}`);
        }
      });
    });

    const terminate = async (reason: 'cancelled' | 'deadline'): Promise<void> => {
      if (reason === 'cancelled') cancelled = true;
      if (reason === 'deadline') timedOut = true;
      this.options.onLog(`[${spec.label}] stopping (${reason})`);
      const verified = await this.stopProcessTree(pid);
      if (!verified) cleanupUnverified = true;
    };

    const deadlineTimer = setTimeout(() => {
      void terminate('deadline');
    }, Math.max(1_000, spec.deadlineMs));
    deadlineTimer.unref();

    const onAbort = (): void => {
      void terminate('cancelled');
    };
    if (control.signal.aborted) onAbort();
    else control.signal.addEventListener('abort', onAbort, { once: true });

    // Wait for close; if termination stalls beyond the force window, report
    // cleanup as unverified instead of inventing an exit.
    const result = await Promise.race([
      outcomePromise,
      new Promise<null>((resolve) => {
        killTimer = setInterval(() => {
          if (closed) return;
          if (cancelled || timedOut) {
            if (!pid || !isAlive(pid)) {
              clearInterval(killTimer as NodeJS.Timeout);
              resolve(null);
            }
          }
        }, 250);
        killTimer.unref();
        // Hard stop: never hang a dispatch lane forever.
        const hardStopMs = (this.options.gracefulStopSeconds + this.options.forceStopSeconds + 15) * 1000;
        hardStopTimer = setTimeout(() => {
          if (!closed) {
            cleanupUnverified = true;
            clearInterval(killTimer as NodeJS.Timeout);
            resolve(null);
          }
        }, hardStopMs);
        hardStopTimer.unref();
      }),
    ]);

    clearTimeout(deadlineTimer);
    control.signal.removeEventListener('abort', onAbort);
    for (const line of stdoutSplitter.flush()) append(stdout, line, 'stdout');
    for (const line of stderrSplitter.flush()) append(stderr, line, 'stderr');
    const flushed = this.options.redactor.flush();
    if (flushed) this.options.onLog(`[${spec.label}] ${flushed}`);

    const streams = {
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      processId: pid,
    };

    if (result === null) {
      return this.baseOutcome(spec, startedAt, {
        ...streams,
        exitCode: null,
        signal: null,
        spawnError,
        timedOut,
        cancelled,
        outputTruncated,
        cleanupUnverified: true,
      });
    }

    return this.baseOutcome(spec, startedAt, {
      ...streams,
      exitCode: result.exitCode,
      signal: result.signal,
      spawnError,
      timedOut,
      cancelled: cancelled && result.exitCode !== 0,
      cancelledAfterExit: cancelled,
      outputTruncated,
      cleanupUnverified,
    });
  }

  private baseOutcome(
    spec: StepSpec,
    startedAt: number,
    overrides: Partial<StepOutcome>,
  ): StepOutcome {
    return {
      label: spec.label,
      command: spec.command,
      args: spec.args,
      exitCode: null,
      signal: null,
      durationMs: Date.now() - startedAt,
      stdout: '',
      stderr: '',
      spawnError: null,
      timedOut: false,
      cancelled: false,
      cancelledAfterExit: false,
      outputTruncated: false,
      cleanupUnverified: false,
      processId: null,
      ...overrides,
    };
  }

  /**
   * Stop a tracked process group: SIGTERM, bounded grace, SIGKILL, then
   * verify the group leader is gone. Returns whether cleanup was verified.
   */
  async stopProcessTree(pid: number | null): Promise<boolean> {
    if (!pid) return true;
    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        process.kill(-pid, signal);
      } catch {
        // No group (already gone or never detached).
      }
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    };
    signalGroup('SIGTERM');
    const gracefulDeadline = Date.now() + this.options.gracefulStopSeconds * 1000;
    while (Date.now() < gracefulDeadline) {
      if (!isAlive(pid)) return true;
      await delay(100);
    }
    signalGroup('SIGKILL');
    const forceDeadline = Date.now() + this.options.forceStopSeconds * 1000;
    while (Date.now() < forceDeadline) {
      if (!isAlive(pid)) return true;
      await delay(100);
    }
    return !isAlive(pid);
  }

  async stopAll(): Promise<boolean> {
    let verified = true;
    for (const pid of [...this.tracked]) {
      const stopped = await this.stopProcessTree(pid);
      if (!stopped) verified = false;
      else this.tracked.delete(pid);
    }
    return verified;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
