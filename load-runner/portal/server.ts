import { randomUUID } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import {
  PortalError,
  cancelRunRequestSchema,
  createRunRequestSchema,
  preflightRequestSchema,
  releaseQueueRequestSchema,
  toRunSummary,
  type PortalErrorBody,
} from './contracts';
import {
  assertCsrf,
  assertTrustedOrigin,
  clearSessionCookie,
  CSRF_HEADER,
  LoginThrottle,
  parseCookies,
  requireSession,
  SESSION_COOKIE,
  SessionStore,
  setSessionCookie,
  trustedClientIdentity,
  verifyPortalPassword,
  type AuthenticatedSession,
} from './auth';
import { CATALOG_REVISION, SUITE_CATALOG, SUITE_ALIASES, canonicalSuiteId, getSuite } from './catalog';
import { contentDispositionAttachment, safeMediaType, type SseWriter } from './evidence';
import type { Orchestrator } from './orchestrator';
import { streamFile } from './run-store';
import type { TargetRegistry } from './targets';
import type { PortalConfig } from './config';

export interface ServerDeps {
  config: PortalConfig;
  orchestrator: Orchestrator;
  targets: TargetRegistry;
  sessions?: SessionStore;
  throttle?: LoginThrottle;
  isReady?: () => boolean;
}

interface AuthContext {
  session: AuthenticatedSession;
  rawToken: string;
}

export interface PortalServer {
  app: Express;
  sessions: SessionStore;
  throttle: LoginThrottle;
}

export function createServer(deps: ServerDeps): PortalServer {
  const { config, orchestrator, targets } = deps;
  const sessions = deps.sessions ?? new SessionStore(config.sessionHours);
  const throttle = deps.throttle ?? new LoginThrottle();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    res.setHeader('x-request-id', randomUUID());
    if (req.path.startsWith('/api/')) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'no-referrer');
    }
    next();
  });

  const auth = (req: Request): AuthContext => {
    const session = requireSession(sessions, req);
    return { session, rawToken: sessionTokenOf(req) };
  };

  const authenticatedMutation = (req: Request): AuthContext => {
    const context = auth(req);
    assertTrustedOrigin(req, config);
    assertCsrf(req, context.session);
    return context;
  };

  // -------------------- auth --------------------

  app.post('/api/v1/auth/login', (req, res, next) => {
    try {
      assertTrustedOrigin(req, config);
      const body = req.body as { username?: unknown; password?: unknown };
      const username = typeof body?.username === 'string' ? body.username : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      const identity = trustedClientIdentity(req);
      const gate = throttle.check(identity);
      if (!gate.allowed) {
        res.setHeader('retry-after', String(gate.retryAfterSeconds));
        throw new PortalError(429, 'RATE_LIMITED', 'Too many failed sign-in attempts.');
      }
      const usernameMatches = username === config.operator.username;
      const passwordMatches =
        config.operator.passwordHash.length > 0 && verifyPortalPassword(password, config.operator.passwordHash);
      if (!usernameMatches || !passwordMatches) {
        throttle.recordFailure(identity);
        throw new PortalError(401, 'UNAUTHENTICATED', 'Invalid credentials.');
      }
      throttle.recordSuccess(identity);
      const created = sessions.create(config.operator.username);
      setSessionCookie(res, created.token, config);
      res.status(200).json({
        operator: { id: created.session.operatorId },
        expiresAt: created.session.expiresAt,
        csrfToken: created.session.csrfToken,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/auth/session', (req, res, next) => {
    try {
      const context = auth(req);
      res.status(200).json({
        authenticated: true,
        operator: { id: context.session.operatorId },
        expiresAt: context.session.expiresAt,
        csrfToken: context.session.csrfToken,
        controller: {
          ready: deps.isReady?.() ?? true,
          queueHeld: orchestratorSnapshotHeld(),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/auth/logout', (req, res, next) => {
    try {
      const context = authenticatedMutation(req);
      sessions.revoke(context.rawToken);
      clearSessionCookie(res, config);
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // -------------------- catalog and targets --------------------

  app.get('/api/v1/suites', (req, res, next) => {
    try {
      auth(req);
      res.status(200).json({
        catalogRevision: getCatalogRevision(),
        aliases: SUITE_ALIASES,
        suites: SUITE_CATALOG.map((suite) => ({
          id: suite.id,
          title: suite.title,
          description: suite.description,
          family: suite.family,
          environments: suite.environments,
          adapter: suite.adapter,
          controlOwner: suite.controlOwner,
          parameters: suite.parameters,
          requires: suite.requires,
          deadlineMinutes: suite.deadlineMinutes,
          capacity: suite.capacity,
          effects: suite.effects,
          runAll: suite.runAll,
          legacy: suite.legacy ?? false,
          exclusionReason: suite.exclusionReason ?? null,
          steps: suite.steps.map((step) => step.label),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/targets', (req, res, next) => {
    try {
      auth(req);
      res.status(200).json({
        productionEnabled: config.productionEnabled,
        targets: targets.listPublic(),
      });
    } catch (error) {
      next(error);
    }
  });

  // -------------------- runs --------------------

  app.post('/api/v1/runs/preflight', (req, res, next) => {
    try {
      auth(req);
      const parsed = preflightRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new PortalError(400, 'INVALID_REQUEST', 'Invalid preflight request.', parsed.error.issues);
      }
      res.status(200).json(orchestrator.preflight(parsed.data));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/runs', async (req, res, next) => {
    try {
      const context = authenticatedMutation(req);
      const idempotencyKey = req.get('idempotency-key') ?? '';
      if (!idempotencyKey) {
        throw new PortalError(400, 'INVALID_REQUEST', 'Idempotency-Key header is required.');
      }
      const parsed = createRunRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new PortalError(400, 'INVALID_REQUEST', 'Invalid run request.', parsed.error.issues);
      }
      const { record, created } = await orchestrator.createRun(
        parsed.data,
        context.session.operatorId,
        idempotencyKey,
      );
      res.status(202).json({
        run: toRunSummary(record),
        created,
        statusUrl: `/api/v1/runs/${record.runId}`,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/runs', (req, res, next) => {
    try {
      auth(req);
      const limitRaw = Number(req.query['limit'] ?? 25);
      const limit = Number.isInteger(limitRaw) ? limitRaw : 25;
      const beforeRaw = req.query['cursor'];
      const beforeSequence = typeof beforeRaw === 'string' && beforeRaw.length > 0 ? Number(beforeRaw) : undefined;
      if (beforeSequence !== undefined && !Number.isInteger(beforeSequence)) {
        throw new PortalError(400, 'INVALID_REQUEST', 'Invalid cursor.');
      }
      const page = orchestrator.listRuns(limit, beforeSequence);
      res.status(200).json({
        runs: page.runs.map(toRunSummary),
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/runs/:runId', (req, res, next) => {
    try {
      auth(req);
      const snapshot = orchestrator.snapshot(String(req.params['runId']));
      res.status(200).json(publicRunSnapshot(snapshot.record));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/runs/:runId/cancel', async (req, res, next) => {
    try {
      authenticatedMutation(req);
      const parsed = cancelRunRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new PortalError(400, 'INVALID_REQUEST', 'Invalid cancellation request.', parsed.error.issues);
      }
      const record = await orchestrator.cancel(String(req.params['runId']), parsed.data.reason);
      const status = ['passed', 'failed', 'cancelled', 'interrupted', 'blocked'].includes(record.status) ? 200 : 202;
      res.status(status).json({ run: toRunSummary(record) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/controller/release-queue', async (req, res, next) => {
    try {
      auth(req);
      assertTrustedOrigin(req, config);
      const parsed = releaseQueueRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new PortalError(400, 'INVALID_REQUEST', 'Invalid release request.', parsed.error.issues);
      }
      const result = await orchestrator.releaseQueue(parsed.data.runIds);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  // -------------------- SSE --------------------

  app.get('/api/v1/runs/:runId/events', (req, res, next) => {
    try {
      auth(req);
      const runId = String(req.params['runId']);
      const snapshot = orchestrator.snapshot(runId);
      res.status(200);
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('connection', 'keep-alive');
      res.flushHeaders();

      const writer: SseWriter = {
        write: (chunk) => res.write(chunk),
        end: () => res.end(),
        onClose: (listener) => res.on('close', listener),
      };
      const subscription = orchestrator.hub.subscribe(runId, writer);
      const logTail = orchestrator.logTail(runId, snapshot.record.executions[0]?.executionId ?? '', 200);
      res.write(
        `event: snapshot\ndata: ${JSON.stringify({
          run: publicRunSnapshot(snapshot.record),
          logTail,
        })}\n\n`,
      );
      const keepAlive = setInterval(() => {
        try {
          res.write(': keep-alive\n\n');
        } catch {
          clearInterval(keepAlive);
        }
      }, 15_000);
      keepAlive.unref();
      req.on('close', () => {
        clearInterval(keepAlive);
        subscription.unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/runs/:runId/executions/:executionId/logs', (req, res, next) => {
    try {
      auth(req);
      const limitRaw = Number(req.query['limit'] ?? 400);
      const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 2000) : 400;
      const runId = String(req.params['runId']);
      orchestrator.snapshot(runId);
      res.status(200).json({
        lines: orchestrator.logTail(runId, String(req.params['executionId']), limit),
      });
    } catch (error) {
      next(error);
    }
  });

  // -------------------- artifacts --------------------

  app.get('/api/v1/runs/:runId/artifacts/:artifactId', (req, res, next) => {
    try {
      auth(req);
      const runId = String(req.params['runId']);
      const artifactId = String(req.params['artifactId']);
      const tombstone = orchestrator.store.tombstone(runId);
      if (tombstone) {
        throw new PortalError(410, 'GONE', 'This artifact has expired.');
      }
      const resolved = orchestrator.store.resolveArtifact(runId, artifactId);
      if (Date.parse(resolved.artifact.expiresAt) <= Date.now()) {
        throw new PortalError(410, 'GONE', 'This artifact has expired.');
      }
      res.setHeader('content-type', safeMediaType(resolved.artifact.mediaType));
      res.setHeader('content-disposition', contentDispositionAttachment(resolved.artifact.fileName));
      res.setHeader('x-artifact-sha256', resolved.artifact.sha256);
      res.status(200);
      streamFile(resolved.absolutePath).pipe(res);
    } catch (error) {
      next(error);
    }
  });

  // -------------------- probes and legacy retirement --------------------

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/readyz', (_req, res) => {
    const ready = deps.isReady?.() ?? true;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'recovering' });
  });

  for (const legacy of ['/api/start', '/api/stop', '/api/live-event']) {
    app.all(legacy, (_req, res) => {
      res.status(410).json({
        error: {
          code: 'LEGACY_ROUTE_RETIRED',
          message: 'The unauthenticated load-runner routes are retired. Use the authenticated portal API.',
          requestId: randomUUID(),
        },
      });
    });
  }

  // -------------------- web app --------------------

  app.use(express.static(config.webRoot, { index: false, fallthrough: true }));
  app.get(/^\/(?!api\/|healthz$|readyz$).*/, (_req, res) => {
    res.status(200).setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
    res.sendFile(path.join(config.webRoot, 'index.html'));
  });

  // -------------------- errors --------------------

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (res.getHeader('x-request-id') as string | undefined) ?? randomUUID();
    if (error instanceof PortalError) {
      if (error.status === 401) clearSessionCookie(res, config);
      const body: PortalErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId,
        },
      };
      res.status(error.status).json(body);
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      const body: PortalErrorBody = {
        error: { code: 'INVALID_REQUEST', message: 'Malformed JSON body.', requestId },
      };
      res.status(400).json(body);
      return;
    }
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Internal portal error.',
        requestId,
      },
    } satisfies PortalErrorBody);
  });

  return { app, sessions, throttle };

  function orchestratorSnapshotHeld(): { count: number; runIds: string[] } {
    const held = orchestrator.store.queued().filter((record) => record.hold !== null);
    return { count: held.length, runIds: held.map((record) => record.runId) };
  }
}

function sessionTokenOf(req: Request): string {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? '';
}

function getCatalogRevision(): string {
  return CATALOG_REVISION;
}

function publicRunSnapshot(record: Parameters<typeof toRunSummary>[0]): unknown {
  return {
    ...toRunSummary(record),
    catalogRevision: record.catalogRevision,
    imageRevision: record.imageRevision,
    approval: record.approval,
    targets: record.targets,
    cancelRequestedAt: record.cancelRequestedAt,
    artifactsExpireAt: record.artifactsExpireAt,
    reconciliationNotes: record.reconciliationNotes,
    executions: record.executions.map((execution) => ({
      executionId: execution.executionId,
      suiteId: execution.suiteId,
      targetId: execution.targetId,
      environment: execution.environment,
      status: execution.status,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      deadlineAt: execution.deadlineAt,
      failureReason: execution.failureReason,
      processIds: execution.processIds,
      load: execution.load,
      result: execution.result,
      fixtures: execution.fixtures,
      artifacts: execution.artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        fileName: artifact.fileName,
        mediaType: artifact.mediaType,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        expiresAt: artifact.expiresAt,
        url: `/api/v1/runs/${record.runId}/artifacts/${artifact.artifactId}`,
      })),
    })),
  };
}

export function resolveSuiteForRequest(id: string): string | null {
  return canonicalSuiteId(id) ?? (getSuite(id)?.id ?? null);
}

export { CSRF_HEADER };
