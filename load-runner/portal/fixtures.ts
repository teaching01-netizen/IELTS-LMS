import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FixtureOperation, FixtureOperationStatus } from './contracts';
import type { ResolvedTarget } from './targets';
import type { StaffCredential } from './targets';

/**
 * Remote fixture provisioning.
 *
 * Every remote create goes through a durable intent first; a transport
 * failure after the remote system may have committed is recorded as
 * `unknown`, never retried blindly, and surfaced for operator reconciliation.
 */

export interface FixtureLedger {
  intent(kind: string, correlation: string, targetId: string | null): FixtureOperation;
  transition(
    operationId: string,
    status: FixtureOperationStatus,
    detail: string,
    resourceIds?: Record<string, string>,
  ): FixtureOperation;
}

export class InMemoryFixtureLedger implements FixtureLedger {
  readonly operations: FixtureOperation[] = [];

  intent(kind: string, correlation: string, targetId: string | null): FixtureOperation {
    const operation: FixtureOperation = {
      operationId: randomBytes(12).toString('hex'),
      kind,
      correlation,
      status: 'planned',
      targetId,
      resourceIds: {},
      startedAt: null,
      completedAt: null,
      detail: null,
    };
    this.operations.push(operation);
    return operation;
  }

  transition(
    operationId: string,
    status: FixtureOperationStatus,
    detail: string,
    resourceIds: Record<string, string> = {},
  ): FixtureOperation {
    const operation = this.operations.find((candidate) => candidate.operationId === operationId);
    if (!operation) throw new Error(`Unknown fixture operation ${operationId}`);
    operation.status = status;
    operation.detail = detail;
    if (status === 'requested') operation.startedAt = new Date().toISOString();
    if (status === 'confirmed' || status === 'failed' || status === 'unknown') {
      operation.completedAt = new Date().toISOString();
    }
    Object.assign(operation.resourceIds, resourceIds);
    return operation;
  }
}

export interface FixtureHttpResponse {
  status: number;
  data: unknown;
  setCookies: string[];
}

export interface FixtureHttpClient {
  request(method: string, url: string, init?: { headers?: Record<string, string>; body?: string }): Promise<FixtureHttpResponse>;
}

export class FetchFixtureHttpClient implements FixtureHttpClient {
  constructor(private readonly timeoutMs = 30_000) {}

  async request(
    method: string,
    url: string,
    init?: { headers?: Record<string, string>; body?: string },
  ): Promise<FixtureHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        ...(init?.headers === undefined ? {} : { headers: init.headers }),
        ...(init?.body === undefined ? {} : { body: init.body }),
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      return { status: response.status, data: body, setCookies };
    } finally {
      clearTimeout(timer);
    }
  }
}

type RawResponse = FixtureHttpResponse;

function asRaw(response: FixtureHttpResponse): RawResponse {
  return response;
}

export class ApiSession {
  private readonly cookies = new Map<string, string>();
  private csrfToken = '';

  constructor(
    private readonly client: FixtureHttpClient,
    readonly origin: string,
  ) {}

  cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  csrf(): string {
    return this.csrfToken;
  }

  private captureCookies(setCookies: readonly string[]): void {
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (!pair || index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      this.cookies.set(name, value);
      if (/csrf/i.test(name)) this.csrfToken = decodeURIComponent(value);
    }
  }

  async login(credential: StaffCredential): Promise<{ userId: string | null }> {
    const response = asRaw(
      await this.client.request('POST', `${this.origin}/api/v1/auth/login`, {
        headers: { 'content-type': 'application/json', origin: this.origin },
        body: JSON.stringify({ email: credential.email, password: credential.password }),
      }),
    );
    this.captureCookies(response.setCookies);
    if (response.status !== 200) {
      throw new Error(`Fixture login failed for ${credential.email}: HTTP ${response.status}`);
    }
    const data = (response.data ?? {}) as { user?: { id?: unknown }; id?: unknown };
    const userId = typeof data.user?.id === 'string' ? data.user.id : typeof data.id === 'string' ? data.id : null;
    if (!this.csrfToken) {
      throw new Error(
        'Fixture login did not return a CSRF cookie; configure the application CSRF cookie name in the target profile.',
      );
    }
    return { userId };
  }

  async call(
    method: string,
    apiPath: string,
    body?: unknown,
  ): Promise<RawResponse> {
    const response = asRaw(
      await this.client.request(method, `${this.origin}${apiPath}`, {
        headers: {
          'content-type': 'application/json',
          origin: this.origin,
          cookie: this.cookieHeader(),
          'x-csrf-token': this.csrfToken,
          'x-portal-fixture': 'true',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    this.captureCookies(response.setCookies);
    return response;
  }
}

export interface RemoteFixtureResult {
  resourceIds: Record<string, string>;
  targetPath: string;
  credentialsPath: string;
  runtimePath: string;
  proctorUserIds: string[];
  syntheticStudentCount: number;
}

export interface SyntheticIdentity {
  wcode: string;
  email: string;
  fullName: string;
}

export function syntheticIdentities(count: number, runId: string, startIndex = 0): SyntheticIdentity[] {
  const identities: SyntheticIdentity[] = [];
  for (let index = 0; index < count; index += 1) {
    const ordinal = startIndex + index + 1;
    identities.push({
      wcode: `W${String(ordinal).padStart(7, '0')}`,
      email: `portal+${runId.slice(0, 8)}-${ordinal}@example.test`,
      fullName: `Portal Candidate ${String(ordinal).padStart(4, '0')}`,
    });
  }
  return identities;
}

/** Direct value lookup without importing the product source tree. */
function pick(object: unknown, pathSegments: readonly string[]): unknown {
  let current: unknown = object;
  for (const segment of pathSegments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function unwrapData(payload: unknown): unknown {
  const data = pick(payload, ['data']);
  return data === undefined ? payload : data;
}

export interface CreateIeltsFixtureOptions {
  target: ResolvedTarget;
  runId: string;
  scratchDir: string;
  studentCount: number;
  instructor: StaffCredential;
  proctors: StaffCredential[];
  ledger: FixtureLedger;
  session: ApiSession;
  /** State builder injected for tests; production uses the checked-in helper. */
  buildState: (params: { title: string; preset: 'Academic' | 'General Training' }) => unknown;
  httpClient: FixtureHttpClient;
}

export async function createIeltsFixture(options: CreateIeltsFixtureOptions): Promise<RemoteFixtureResult> {
  const { target, runId, ledger, session } = options;
  const resourceIds: Record<string, string> = {};
  const title = `Portal synthetic IELTS ${runId.slice(0, 8)}`;
  const slug = `portal-ielts-${runId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');

  const examIntent = ledger.intent('exam.create', `exam:${slug}`, target.id);
  ledger.transition(examIntent.operationId, 'requested', 'POST /api/v1/exams');
  const create = await session.call('POST', '/api/v1/exams', {
    slug,
    title,
    examType: 'Academic',
    visibility: 'organization',
  });
  if (create.status !== 201 && create.status !== 200) {
    ledger.transition(examIntent.operationId, 'failed', `HTTP ${create.status}`);
    throw new Error(`Fixture exam creation failed: HTTP ${create.status} ${JSON.stringify(create.data).slice(0, 300)}`);
  }
  const examId = String(pick(unwrapData(create.data), ['id']) ?? '');
  if (!examId) {
    // The remote committed something the response did not identify: assume
    // the create may have landed and stop instead of retrying.
    ledger.transition(examIntent.operationId, 'unknown', 'Create response did not include an exam id.');
    throw new Error('Fixture exam creation returned no exam id; reconcile before retrying.');
  }
  ledger.transition(examIntent.operationId, 'confirmed', 'exam created', { examId });
  resourceIds['examId'] = examId;

  const state = options.buildState({ title, preset: 'Academic' });
  const revision = await currentRevision(session, examId);
  const draftIntent = ledger.intent('exam.saveDraft', `exam:${examId}:draft`, target.id);
  ledger.transition(draftIntent.operationId, 'requested', 'PATCH /api/v1/exams/{id}/draft');
  const saveDraft = await session.call('PATCH', `/api/v1/exams/${examId}/draft`, {
    contentSnapshot: state,
    configSnapshot: pick(state, ['config']),
    revision,
  });
  if (saveDraft.status !== 200) {
    ledger.transition(draftIntent.operationId, 'failed', `HTTP ${saveDraft.status}`);
    throw new Error(`Fixture draft save failed: HTTP ${saveDraft.status}`);
  }
  ledger.transition(draftIntent.operationId, 'confirmed', 'draft saved');

  const publishRevision = await currentRevision(session, examId);
  const publishIntent = ledger.intent('exam.publish', `exam:${examId}:publish`, target.id);
  ledger.transition(publishIntent.operationId, 'requested', 'POST /api/v1/exams/{id}/publish');
  const publish = await session.call('POST', `/api/v1/exams/${examId}/publish`, {
    publishNotes: `Portal synthetic fixture ${runId}`,
    revision: publishRevision,
  });
  if (publish.status !== 200 && publish.status !== 201 && publish.status !== 202) {
    ledger.transition(publishIntent.operationId, 'failed', `HTTP ${publish.status}`);
    throw new Error(`Fixture publish failed: HTTP ${publish.status}`);
  }
  const publishedVersionId = await waitForPublishedVersion(session, examId);
  ledger.transition(publishIntent.operationId, 'confirmed', 'exam published', { publishedVersionId });
  resourceIds['publishedVersionId'] = publishedVersionId;

  const startTime = new Date(Date.now() + 10 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
  const scheduleIntent = ledger.intent('schedule.create', `exam:${examId}:schedule`, target.id);
  ledger.transition(scheduleIntent.operationId, 'requested', 'POST /api/v1/schedules');
  const schedule = await session.call('POST', '/api/v1/schedules', {
    examId,
    publishedVersionId,
    cohortName: `Portal ${runId.slice(0, 8)}`,
    institution: 'Portal synthetic',
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    autoStart: false,
    autoStop: false,
  });
  if (schedule.status !== 201 && schedule.status !== 200) {
    ledger.transition(scheduleIntent.operationId, 'failed', `HTTP ${schedule.status}`);
    throw new Error(`Fixture schedule creation failed: HTTP ${schedule.status}`);
  }
  const scheduleId = String(pick(unwrapData(schedule.data), ['id']) ?? '');
  if (!scheduleId) {
    ledger.transition(scheduleIntent.operationId, 'unknown', 'Schedule response did not include an id.');
    throw new Error('Fixture schedule creation returned no schedule id; reconcile before retrying.');
  }
  ledger.transition(scheduleIntent.operationId, 'confirmed', 'schedule created', { scheduleId });
  resourceIds['scheduleId'] = scheduleId;

  // Resolve every proctor's real user id through its own login, then grant
  // through the scoped application endpoint using the instructor session.
  const proctorUserIds: string[] = [];
  for (const proctor of options.proctors) {
    const proctorSession = new ApiSession(options.httpClient, target.origin);
    const login = await proctorSession.login(proctor);
    if (!login.userId) {
      throw new Error(`Could not resolve the application user id for proctor ${proctor.email}.`);
    }
    proctorUserIds.push(login.userId);
  }

  for (const [index, proctor] of options.proctors.entries()) {
    const userId = proctorUserIds[index];
    if (!userId) continue;
    const grantIntent = ledger.intent('schedule.grantProctor', `schedule:${scheduleId}:user:${userId}`, target.id);
    ledger.transition(grantIntent.operationId, 'requested', 'PUT /api/v1/schedules/{id}/staff/proctors/{userId}');
    const grant = await session.call('PUT', `/api/v1/schedules/${scheduleId}/staff/proctors/${userId}`, {});
    if (grant.status !== 200 && grant.status !== 201) {
      ledger.transition(grantIntent.operationId, 'failed', `HTTP ${grant.status}`);
      throw new Error(`Fixture proctor grant failed for ${proctor.email}: HTTP ${grant.status}`);
    }
    const assignmentId = String(pick(unwrapData(grant.data), ['id']) ?? '');
    ledger.transition(grantIntent.operationId, 'confirmed', 'proctor granted', { assignmentId, userId });
  }

  const identities = syntheticIdentities(options.studentCount, runId);
  mkdirSync(options.scratchDir, { recursive: true });
  const targetPath = path.join(options.scratchDir, 'prod-target.json');
  const credentialsPath = path.join(options.scratchDir, 'prod-creds.json');
  const runtimePath = path.join(options.scratchDir, 'prod-runtime.json');
  writeFileSync(
    targetPath,
    JSON.stringify(
      {
        baseURL: target.origin,
        scheduleId,
        examId,
        editor: { email: options.instructor.email, displayName: 'Portal Instructor' },
        proctors: options.proctors.map((proctor, index) => ({
          email: proctor.email,
          displayName: `Portal Proctor ${index + 1}`,
        })),
        students: identities,
        scenario: {},
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  writeFileSync(
    credentialsPath,
    JSON.stringify(
      {
        editor: { email: options.instructor.email, password: options.instructor.password },
        proctors: options.proctors.map((proctor) => ({ email: proctor.email, password: proctor.password })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  writeFileSync(
    runtimePath,
    JSON.stringify({ baseURL: target.origin, scheduleId, examId, createdAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );

  resourceIds['studentCount'] = String(identities.length);
  return {
    resourceIds,
    targetPath,
    credentialsPath,
    runtimePath,
    proctorUserIds,
    syntheticStudentCount: identities.length,
  };
}

async function currentRevision(session: ApiSession, examId: string): Promise<number> {
  const response = await session.call('GET', `/api/v1/exams/${examId}`);
  if (response.status !== 200) throw new Error(`Fixture exam read failed: HTTP ${response.status}`);
  const revision = Number(pick(unwrapData(response.data), ['revision']) ?? 0);
  return Number.isInteger(revision) ? revision : 0;
}

async function waitForPublishedVersion(
  session: ApiSession,
  examId: string,
  timeoutMs = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = 'no response';
  while (Date.now() < deadline) {
    const response = await session.call('GET', `/api/v1/exams/${examId}`);
    if (response.status === 200) {
      const data = unwrapData(response.data);
      const status = String(pick(data, ['status']) ?? '');
      const versionId = String(pick(data, ['currentPublishedVersionId']) ?? '');
      if (status === 'published' && versionId) return versionId;
      lastDetail = `status=${status} publishedVersionId=${versionId}`;
    } else {
      lastDetail = `HTTP ${response.status}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Fixture publish did not become ready within ${timeoutMs}ms (${lastDetail}).`);
}
