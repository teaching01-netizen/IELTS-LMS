import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { parseSatJoinUrl } from './sat-join-url';
import { loadUsersFromFile, type VirtualUser } from './user-source';
import { startLiveDashboardServer, type DashboardEvent } from './live-dashboard-server';
import { satAnswerUntilComplete, satJoinViaAccessLink, satWaitForExamLive } from './sat-live-scenario';

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
  logFile: string;
  userOffset: number;
  deleteArtifactsOnFinish: boolean;
}

type Phase = 'booting' | 'joining' | 'waiting_start' | 'in_exam' | 'done' | 'failed';

interface UserResult {
  userId: string;
  phase: Phase;
  ok: boolean;
  joinMs: number;
  answered: number;
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

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
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
  const headlessBrowser =
    config.headless || config.headedUsers < users.length ? await chromium.launch({ headless: true }) : null;
  const headedBrowser =
    !config.headless || config.headedUsers > 0 ? await chromium.launch({ headless: false }) : null;
  const results: UserResult[] = [];

  for (const user of users) {
    dashboard.broadcast(eventBase(user.userId, 'queued', 'booting'));
  }

  const runner = async (user: VirtualUser, index: number) => {
    const startedAt = Date.now();
    let joinedAt = 0;
    let phase: Phase = 'booting';
    let context: BrowserContext | null = null;
    let page: Page | null = null;
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
      const selectedBrowser = useHeaded ? headedBrowser : headlessBrowser;
      if (!selectedBrowser) {
        throw new Error(`BROWSER_MODE_UNAVAILABLE: useHeaded=${String(useHeaded)}`);
      }

      context = await selectedBrowser.newContext({ viewport: { width: 1280, height: 720 } });
      page = await context.newPage();

      setPhase('joining', 'starting');
      await satJoinViaAccessLink(page, user, config.joinUrl);
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

      await satWaitForExamLive(page, {
        origin: parsed.origin,
        accessLinkId: parsed.accessLinkId,
        examTimeoutMs: config.examTimeoutMs,
        startPollIntervalMs: config.startPollIntervalMs,
        startTimeoutMs: config.startTimeoutMs,
      });
      setPhase('in_exam', 'live');

      const outcome = await satAnswerUntilComplete(page, user, {
        origin: parsed.origin,
        accessLinkId: parsed.accessLinkId,
        examTimeoutMs: config.examTimeoutMs,
        startPollIntervalMs: config.startPollIntervalMs,
        startTimeoutMs: config.startTimeoutMs,
      });
      answered = outcome.answered;

      setPhase('done', 'done');
      stopCapture = true;
      await captureLoop.catch(() => {});

      results.push({
        userId: user.userId,
        phase: 'done',
        ok: true,
        joinMs: Math.max(0, joinedAt - startedAt),
        answered,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    }
  };

  try {
    const queue = users.map((user, index) => ({ user, index }));
    const workers = Array.from({ length: Math.min(config.maxConcurrentUsers, queue.length) }, async () => {
      while (true) {
        const next = queue.shift();
        if (!next) return;
        await runner(next.user, next.index);
      }
    });
    await Promise.all(workers);
  } finally {
    if (headedBrowser) await headedBrowser.close();
    if (headlessBrowser) await headlessBrowser.close();
  }

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const summary = {
    accessLinkId: parsed.accessLinkId,
    joinUrl: config.joinUrl,
    liveMode,
    userCount: users.length,
    passed: ok.length,
    failed: fail.length,
    medianJoinMs: computeMedian(ok.map((r) => r.joinMs)),
    medianAnswered: computeMedian(ok.map((r) => r.answered)),
    generatedAt: new Date().toISOString(),
    failures: fail,
  };

  const summaryPath = path.resolve(process.cwd(), config.outputDir, `live-sat-summary-${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[live-sat-runner] summary: ${summaryPath}`);
  appendLog(JSON.stringify({ ts: new Date().toISOString(), event: 'live_sat_runner_summary', summaryPath, liveLogFile }));
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
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
