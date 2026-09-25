import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { createBrowserPool, type BrowserPool, type BrowserPoolLease } from './browser-pool';
import { isSatJoinError, type SatJoinError } from './sat-join-failure';
import { parseSatJoinUrl } from './sat-join-url';
import { loadUsersFromFile, type VirtualUser } from './user-source';
import { startLiveDashboardServer, type DashboardEvent } from './live-dashboard-server';
import { satAnswerUntilComplete, satCaptureAnswerableFrames, satJoinViaAccessLink, satReadAnswerableFrames, satWaitForExamLive, type SatAnswerableFrame } from './sat-live-scenario';

interface RunnerConfig {
  joinUrl: string;
  userCount: number;
  usersFile: string;
  dashboardPort: number;
  screenshotIntervalMs: number;
  jpegQuality: number;
  headless: boolean;
  outputDir: string;
  startPollIntervalMs: number;
  startTimeoutMs: number;
  examTimeoutMs: number;
  headedUsers: number;
  maxConcurrentUsers: number;
  contextsPerBrowser: number;
  abortOnFatalJoin: boolean;
  joinFailureAbortThreshold: number;
  logFile: string;
  userOffset: number;
  deleteArtifactsOnFinish: boolean;
}

// Load-runner Chromium flags: no /dev/shm dependency, no GPU compositing for a
// dozen-plus hidden contexts, no timer throttling (SAT clocks must keep ticking
// in background tabs or modules never hand off), and no first-run dialogs.
const CHROMIUM_LOAD_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

type Phase = 'booting' | 'joining' | 'waiting_start' | 'in_exam' | 'done' | 'failed';

interface UserResult {
  userId: string;
  phase: Phase;
  ok: boolean;
  joinMs: number;
  answered: number;
  recoveryScreens?: number;
  answerableFrames?: SatAnswerableFrame[];
  error?: string;
}

type LiveMode = 'balanced' | 'fast';

function resolveLiveMode(): LiveMode {
  const raw = (process.env['LIVE_MODE'] ?? 'balanced').toLowerCase();
  return raw === 'fast' ? 'fast' : 'balanced';
}

function modeDefaultNumber(mode: LiveMode, name: 'SCREENSHOT_INTERVAL_MS' | 'JPEG_QUALITY'): number {
  if (mode === 'fast') {
    return name === 'SCREENSHOT_INTERVAL_MS' ? 250 : 30;
  }
  return name === 'SCREENSHOT_INTERVAL_MS' ? 1000 : 45;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function computeMedian(values: number[]): number {  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function eventBase(
  userId: string,
  status: string,
  phase: Phase,
  error?: string,
  metrics?: DashboardEvent['metrics'],
): DashboardEvent {
  return {
    userId,
    status,
    phase,
    lastSeenAt: new Date().toISOString(),
    ...(error ? { error } : {}),
    ...(metrics ? { metrics } : {}),
  };
}

function launchBrowser(headless: boolean) {
  return chromium.launch({ headless, args: CHROMIUM_LOAD_ARGS });
}

/**
 * Opens one context, tolerating a browser that died between acquire and use:
 * the lease is dropped and the next attempt lands on a replacement instance.
 */
async function openContext(
  pool: BrowserPool,
  userId: string,
  onEvent: (message: string) => void,
): Promise<{ lease: BrowserPoolLease; context: BrowserContext }> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const lease = await pool.acquire();
    try {
      const context = await lease.browser.newContext({ viewport: { width: 1280, height: 720 } });
      return { lease, context };
    } catch (error) {
      lease.release();
      lastError = error;
      onEvent(
        `BROWSER_RETRY: ${userId} could not open a context (attempt ${attempt}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function saveFailureArtifact(
  page: Page,
  outputDir: string,
  userId: string,
  phase: string,
): Promise<void> {
  const dir = path.resolve(process.cwd(), outputDir, 'failures');
  fs.mkdirSync(dir, { recursive: true });
  const safe = userId.replace(/[^a-z0-9_-]+/gi, '-');
  const stamp = Date.now();
  await page.screenshot({ path: path.join(dir, `${safe}-${phase}-${stamp}.png`) }).catch(() => {});
  const text = await page.locator('body').innerText().catch(() => '');
  fs.writeFileSync(
    path.join(dir, `${safe}-${phase}-${stamp}.txt`),
    `url=${page.url()}\n\n${text.slice(0, 2000)}`,
  );
}

async function run(): Promise<void> {
  const liveMode = resolveLiveMode();
  const joinUrl = process.env['SAT_JOIN_URL'] ?? process.env['REGISTER_URL'] ?? '';
  if (!joinUrl) {
    throw new Error('SAT_JOIN_URL is required (Student Link /join/:accessLinkId URL).');
  }
  const config: RunnerConfig = {
    joinUrl,
    userCount: num('USER_COUNT', 100),
    usersFile: requireEnv('USERS_FILE'),
    dashboardPort: num('DASHBOARD_PORT', 3333),
    screenshotIntervalMs: num('SCREENSHOT_INTERVAL_MS', modeDefaultNumber(liveMode, 'SCREENSHOT_INTERVAL_MS')),
    jpegQuality: num('JPEG_QUALITY', modeDefaultNumber(liveMode, 'JPEG_QUALITY')),
    headless: bool('HEADLESS', true),
    outputDir: process.env['OUTPUT_DIR'] ?? 'e2e/.generated/live-sat-runner',
    startPollIntervalMs: num('START_POLL_INTERVAL_MS', 1500),
    startTimeoutMs: num('START_TIMEOUT_MS', 20 * 60 * 1000),
    examTimeoutMs: num('EXAM_TIMEOUT_MS', 150 * 60 * 1000),
    headedUsers: Math.max(0, num('HEADED_USERS', 0)),
    maxConcurrentUsers: Math.max(1, num('MAX_CONCURRENT_USERS', 20)),
    contextsPerBrowser: Math.max(1, num('CONTEXTS_PER_BROWSER', 5)),
    abortOnFatalJoin: bool('ABORT_ON_FATAL_JOIN', true),
    joinFailureAbortThreshold: Math.max(1, num('JOIN_FAILURE_ABORT_THRESHOLD', 8)),
    logFile: process.env['LIVE_RUN_LOG_FILE'] ?? '',
    userOffset: Math.max(0, num('USER_OFFSET', 0)),
    deleteArtifactsOnFinish: bool('DELETE_ARTIFACTS_ON_FINISH', false),
  };

  const parsed = parseSatJoinUrl(config.joinUrl);
  const users = loadUsersFromFile(config.usersFile, config.userCount, config.userOffset);

  fs.mkdirSync(path.resolve(process.cwd(), config.outputDir), { recursive: true });
  const liveLogFile =
    config.logFile.trim().length > 0
      ? path.resolve(process.cwd(), config.logFile)
      : path.resolve(process.cwd(), config.outputDir, `live-sat-events-${Date.now()}.log`);
  fs.mkdirSync(path.dirname(liveLogFile), { recursive: true });
  const appendLog = (line: string) => {
    fs.appendFileSync(liveLogFile, `${line}\n`);
  };
  appendLog(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'live_sat_runner_start',
      accessLinkId: parsed.accessLinkId,
      userOffset: config.userOffset,
      userCount: config.userCount,
    }),
  );
  console.log(`[live-sat-runner] events: ${liveLogFile}`);

  const dashboard = startLiveDashboardServer(config.dashboardPort);
  const poolEvent = (message: string) => {
    console.log(`[live-sat-runner] ${message}`);
    appendLog(JSON.stringify({ ts: new Date().toISOString(), event: 'browser_pool', message }));
  };
  const browsersPerKind = Math.max(1, Math.ceil(config.maxConcurrentUsers / config.contextsPerBrowser));
  const headlessPool = createBrowserPool({
    launch: () => launchBrowser(true),
    maxContextsPerBrowser: config.contextsPerBrowser,
    maxBrowsers: browsersPerKind,
    onEvent: poolEvent,
  });
  const headedPool = createBrowserPool({
    launch: () => launchBrowser(false),
    maxContextsPerBrowser: config.contextsPerBrowser,
    maxBrowsers: browsersPerKind,
    onEvent: poolEvent,
  });
  const results: UserResult[] = [];
  const skipped: UserResult[] = [];
  // A dead exam window must not cost 100 browsers: the first run-scoped
  // verdict (or a total failure to admit anyone) stops the queue.
  const abort: { reason: string | null } = { reason: null };
  let admitted = 0;
  let joinFailures = 0;

  const abortRun = (reason: string) => {
    if (!config.abortOnFatalJoin || abort.reason) return;
    abort.reason = reason;
    console.error(`\n[live-sat-runner] ABORTING RUN — ${reason}\n`);
    appendLog(JSON.stringify({ ts: new Date().toISOString(), event: 'live_sat_runner_abort', reason }));
  };

  const noteJoinFailure = (userId: string, joinError: string) => {
    joinFailures += 1;
    if (admitted > 0 || joinFailures < config.joinFailureAbortThreshold) return;
    abortRun(
      `SAT_NO_USERS_ADMITTED: ${joinFailures} students failed to join before anyone was admitted. Last error (${userId}): ${joinError}`,
    );
  };

  for (const user of users) {
    dashboard.broadcast(eventBase(user.userId, 'queued', 'booting'));
  }

  const runner = async (user: VirtualUser, index: number) => {
    const startedAt = Date.now();
    let joinedAt = 0;
    let phase: Phase = 'booting';
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let lease: BrowserPoolLease | null = null;
    let frameInFlight = false;
    let stopCapture = false;
    let answered = 0;

    const setPhase = (next: Phase, status = next, error?: string) => {
      phase = next;
      dashboard.broadcast(eventBase(user.userId, status, phase, error, { answered }));
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        userId: user.userId,
        accessLinkId: parsed.accessLinkId,
        phase,
        status,
        answered,
        ...(error ? { errorCode: error } : {}),
      });
      console.log(line);
      appendLog(line);
    };

    try {
      const useHeaded = !config.headless || index < config.headedUsers;
      const pool = useHeaded ? headedPool : headlessPool;
      const opened = await openContext(pool, user.userId, poolEvent);
      lease = opened.lease;
      context = opened.context;
      page = await context.newPage();
      await satCaptureAnswerableFrames(page);

      setPhase('joining', 'starting');
      let joined = false;
      let joinError = '';
      for (let attempt = 1; attempt <= 3 && !joined; attempt += 1) {
        try {
          await satJoinViaAccessLink(page, user, config.joinUrl);
          joined = true;
        } catch (error) {
          joinError = error instanceof Error ? error.message : String(error);
          const failure: SatJoinError | null = isSatJoinError(error) ? error : null;
          if (failure && failure.scope === 'run') {
            abortRun(`${failure.message} Fix: ${failure.hint}`);
            throw error;
          }
          const retryable = failure === null || failure.scope === 'transient';
          if (attempt < 3 && retryable) {
            appendLog(
              JSON.stringify({
                ts: new Date().toISOString(),
                userId: user.userId,
                phase: 'joining',
                status: 'retrying',
                attempt,
                errorCode: joinError,
              }),
            );
            await page.waitForTimeout(5000);
          } else {
            break;
          }
        }
      }
      if (!joined) {
        noteJoinFailure(user.userId, joinError);
        await saveFailureArtifact(page, config.outputDir, user.userId, 'join').catch(() => {});
        throw new Error(joinError || 'SAT_JOIN_FAILED');
      }
      admitted += 1;
      joinedAt = Date.now();

      setPhase('waiting_start', 'waiting_start');

      const captureLoop = (async () => {
        while (!stopCapture && page) {
          if (page.isClosed()) break;
          if (!frameInFlight) {
            frameInFlight = true;
            try {
              const image = await page.screenshot({ type: 'jpeg', quality: config.jpegQuality });
              dashboard.broadcast({
                ...eventBase(user.userId, 'running', phase, undefined, { answered }),
                imageBase64: image.toString('base64'),
              });
            } catch {
              dashboard.broadcast(eventBase(user.userId, 'screenshot_failed', phase, undefined, { answered }));
            } finally {
              frameInFlight = false;
            }
          }
          await page.waitForTimeout(config.screenshotIntervalMs).catch(() => {});
        }
      })();

      let recoveryScreens = 0;
      await satWaitForExamLive(page, {
        origin: parsed.origin,
        accessLinkId: parsed.accessLinkId,
        examTimeoutMs: config.examTimeoutMs,
        startPollIntervalMs: config.startPollIntervalMs,
        startTimeoutMs: config.startTimeoutMs,
      }, () => { recoveryScreens += 1; });
      setPhase('in_exam', 'live');

      const outcome = await satAnswerUntilComplete(
        page,
        user,
        {
          origin: parsed.origin,
          accessLinkId: parsed.accessLinkId,
          examTimeoutMs: config.examTimeoutMs,
          startPollIntervalMs: config.startPollIntervalMs,
          startTimeoutMs: config.startTimeoutMs,
        },
        (progressAnswered) => {
          answered = progressAnswered;
          dashboard.broadcast(eventBase(user.userId, 'running', phase, undefined, { answered }));
          const line = JSON.stringify({
            ts: new Date().toISOString(),
            userId: user.userId,
            accessLinkId: parsed.accessLinkId,
            phase,
            status: 'answering',
            answered,
          });
          console.log(line);
          appendLog(line);
        },
        () => { recoveryScreens += 1; },
      );
      answered = outcome.answered;
      const answerableFrames = await satReadAnswerableFrames(page);
      if (bool('SAT_ASSERT_ENTRY_FRAME', false) &&
          (recoveryScreens > 0 || answerableFrames.length === 0 ||
            answerableFrames.some((frame) => frame.latencyMs >= 5000 || frame.latencyMs < 0))) {
        throw new Error(`SAT_ENTRY_FRAME_GATE: recoveryScreens=${recoveryScreens} frames=${JSON.stringify(answerableFrames)}`);
      }

      setPhase('done', 'done');
      stopCapture = true;
      await captureLoop.catch(() => {});

      results.push({
        userId: user.userId,
        phase: 'done',
        ok: true,
        joinMs: Math.max(0, joinedAt - startedAt),
        answered,
        recoveryScreens,
        answerableFrames,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (page && !page.isClosed() && phase === 'in_exam') {
        await saveFailureArtifact(page, config.outputDir, user.userId, phase).catch(() => {});
      }
      setPhase('failed', 'failed', message);
      results.push({
        userId: user.userId,
        phase: 'failed',
        ok: false,
        joinMs: Math.max(0, joinedAt ? joinedAt - startedAt : 0),
        answered,
        error: message,
      });
    } finally {
      stopCapture = true;
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      lease?.release();
    }
  };

  try {
    const queue = users.map((user, index) => ({ user, index }));
    const workers = Array.from({ length: Math.min(config.maxConcurrentUsers, queue.length) }, async () => {
      while (true) {
        const next = queue.shift();
        if (!next) return;
        if (abort.reason) {
          // Aborted: report the reason on each remaining card instead of
          // spending a browser on a link that cannot admit anyone.
          const message = `SKIPPED: run aborted — ${abort.reason}`;
          skipped.push({
            userId: next.user.userId,
            phase: 'failed',
            ok: false,
            joinMs: 0,
            answered: 0,
            error: message,
          });
          dashboard.broadcast(eventBase(next.user.userId, 'skipped', 'failed', message));
          appendLog(
            JSON.stringify({
              ts: new Date().toISOString(),
              userId: next.user.userId,
              phase: 'failed',
              status: 'skipped',
              reason: abort.reason,
            }),
          );
          continue;
        }
        await runner(next.user, next.index);
      }
    });
    await Promise.all(workers);
  } finally {
    await headedPool.closeAll();
    await headlessPool.closeAll();
  }

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const failures = [...fail, ...skipped];
  const answerableFrameLatencies = ok.flatMap((r) => r.answerableFrames?.map((frame) => frame.latencyMs) ?? []);
  const sortedFrameLatencies = [...answerableFrameLatencies].sort((a, b) => a - b);
  const percentile = (fraction: number) => sortedFrameLatencies.length
    ? sortedFrameLatencies[Math.ceil(fraction * sortedFrameLatencies.length) - 1]
    : null;
  const summary = {
    accessLinkId: parsed.accessLinkId,
    joinUrl: config.joinUrl,
    liveMode,
    userCount: users.length,
    passed: ok.length,
    failed: failures.length,
    skipped: skipped.length,
    ...(abort.reason ? { aborted: true, abortReason: abort.reason } : {}),
    medianJoinMs: computeMedian(ok.map((r) => r.joinMs)),
    medianAnswered: computeMedian(ok.map((r) => r.answered)),
    answerableFrameCount: answerableFrameLatencies.length,
    answerableFrameP95Ms: percentile(0.95),
    answerableFrameP99Ms: percentile(0.99),
    answerableFrameMaxMs: sortedFrameLatencies.at(-1) ?? null,
    generatedAt: new Date().toISOString(),
    failures,
  };

  const summaryPath = path.resolve(process.cwd(), config.outputDir, `live-sat-summary-${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[live-sat-runner] summary: ${summaryPath}`);
  appendLog(JSON.stringify({ ts: new Date().toISOString(), event: 'live_sat_runner_summary', summaryPath, liveLogFile }));
  if (abort.reason) {
    // Distinct exit code so the control panel turns red instead of reporting a
    // clean finish for a run where nobody could join.
    console.error(`[live-sat-runner] aborted before admitting the roster: ${abort.reason}`);
    process.exitCode = 3;
  }
  if (bool('SAT_ASSERT_ENTRY_FRAME', false) && fail.length > 0) process.exitCode = 1;
  if (config.deleteArtifactsOnFinish) {
    try {
      fs.unlinkSync(summaryPath);
    } catch {
      // Best-effort cleanup must not mask the run result.
    }
    try {
      fs.unlinkSync(liveLogFile);
    } catch {
      // Best-effort cleanup must not mask the run result.
    }
    console.log('[live-sat-runner] artifacts deleted (DELETE_ARTIFACTS_ON_FINISH=true)');
  }

  // Otherwise the monitor server holds the event loop open and the run looks
  // stuck in the control panel even though every student is done.
  await dashboard.close();
  console.log('[live-sat-runner] done');
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
