import { practiceEntrySession } from './practice-entry.js';
import http from 'k6/http';
import { randomBytes } from 'k6/crypto';
import { sleep } from 'k6';

const EXPECT_2XX_OR_409 = http.expectedStatuses({ min: 200, max: 299 }, 409);

export function readJson(path) {
  try {
    return JSON.parse(open(path));
  } catch (err) {
    throw new Error(`Failed to read JSON at ${path}: ${String(err)}`);
  }
}

export function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function uuidV4() {
  const b = new Uint8Array(randomBytes(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => (`0${x.toString(16)}`).slice(-2)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function stableHash32(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function computeJitterSeconds(runId, wcode, maxSeconds) {
  if (maxSeconds <= 0) return 0;
  const hash = stableHash32(`${runId}:${wcode}`);
  return (hash % maxSeconds) | 0;
}

export function resolveBaseUrl(target) {
  if (__ENV.K6_BASE_URL) return __ENV.K6_BASE_URL;
  const scheduleUrl = __ENV.K6_REGISTER_URL || __ENV.K6_SCHEDULE_URL || __ENV.K6_EXAM_URL || __ENV.K6_ENTRY_URL;
  if (scheduleUrl) {
    const match = String(scheduleUrl).match(/^(https?:\/\/[^/]+)\//i);
    if (match) return match[1];
  }
  return target.baseURL;
}

function parseScheduleIdFromUrl(url) {
  if (!url) return '';
  const value = String(url);
  const patterns = [
    /\/student\/([0-9a-fA-F-]{36})\/register(?:[/?#].*)?$/i,
    /\/schedules\/([0-9a-fA-F-]{36})(?:[/?#].*)?$/i,
    /\/schedule\/([0-9a-fA-F-]{36})(?:[/?#].*)?$/i,
    /\/exam\/([0-9a-fA-F-]{36})(?:[/?#].*)?$/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return '';
}

export function resolveScheduleId(target) {
  if (__ENV.K6_SCHEDULE_ID) return __ENV.K6_SCHEDULE_ID;
  const scheduleUrl = __ENV.K6_REGISTER_URL || __ENV.K6_SCHEDULE_URL || __ENV.K6_EXAM_URL || __ENV.K6_ENTRY_URL;
  const parsed = parseScheduleIdFromUrl(scheduleUrl);
  if (parsed) return parsed;
  const runtimePath = __ENV.K6_RUNTIME_PATH || '../e2e/.generated/prod-runtime.json';
  try {
    const runtime = readJson(runtimePath);
    if (runtime && runtime.scheduleId) return runtime.scheduleId;
  } catch (_) {
    // ignore
  }
  return target.scheduleId;
}

export function jsonHeaders(extra) {
  return Object.assign({ 'content-type': 'application/json' }, extra || {});
}

function bodyPreview(resp) {
  return String((resp && resp.body) || '').slice(0, 200);
}

export function cookieValue(jar, baseUrl, candidates) {
  const cookies = jar.cookiesForURL(baseUrl);
  for (const name of candidates) {
    const values = cookies[name];
    if (values && values.length > 0) return values[0];
  }
  return '';
}

export function csrfHeader(jar, baseUrl) {
  const configured = __ENV.AUTH_CSRF_COOKIE_NAME;
  const candidates = [
    configured && configured.length > 0 ? configured : null,
    '__Host-csrf',
    'csrf',
  ].filter(Boolean);
  const token = cookieValue(jar, baseUrl, candidates);
  return token ? { 'x-csrf-token': token } : {};
}

export function pickFirstQuestionId(snapshot) {
  const stack = [snapshot];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) stack.push(value[i]);
      continue;
    }
    if (Array.isArray(value.questions)) {
      for (let i = 0; i < value.questions.length; i += 1) {
        const q = value.questions[i];
        if (q && typeof q === 'object' && typeof q.id === 'string' && q.id.length > 0) return q.id;
      }
    }
    for (const k of Object.keys(value)) stack.push(value[k]);
  }
  return '';
}

export function pickFirstWritingTaskId(snapshot) {
  const stack = [snapshot];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) stack.push(value[i]);
      continue;
    }
    if (Array.isArray(value.tasks)) {
      for (let i = 0; i < value.tasks.length; i += 1) {
        const t = value.tasks[i];
        if (t && typeof t === 'object' && typeof t.id === 'string' && t.id.length > 0) return t.id;
      }
    }
    for (const k of Object.keys(value)) stack.push(value[k]);
  }
  return '';
}

export function collectObjectiveQuestionIds(snapshot) {
  const seen = new Set();
  const ordered = [];
  const stack = [snapshot];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) stack.push(value[i]);
      continue;
    }
    if (Array.isArray(value.questions)) {
      for (let i = 0; i < value.questions.length; i += 1) {
        const q = value.questions[i];
        const id = q && typeof q === 'object' ? q.id : '';
        if (typeof id === 'string' && id.trim() && !seen.has(id)) {
          seen.add(id);
          ordered.push(id);
        }
      }
    }
    for (const k of Object.keys(value)) stack.push(value[k]);
  }
  return ordered;
}

export function collectWritingTaskIds(snapshot) {
  const seen = new Set();
  const ordered = [];
  const stack = [snapshot];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) stack.push(value[i]);
      continue;
    }
    if (Array.isArray(value.tasks)) {
      for (let i = 0; i < value.tasks.length; i += 1) {
        const task = value.tasks[i];
        const id = task && typeof task === 'object' ? task.id : '';
        if (typeof id === 'string' && id.trim() && !seen.has(id)) {
          seen.add(id);
          ordered.push(id);
        }
      }
    }
    for (const k of Object.keys(value)) stack.push(value[k]);
  }
  return ordered;
}

export function selectStaffCandidates(creds, preferEditor = true) {
  const staffCandidates = [];
  if (preferEditor && creds.editor) staffCandidates.push(creds.editor);
  if (Array.isArray(creds.proctors)) staffCandidates.push(...creds.proctors);
  if (!preferEditor && creds.editor) staffCandidates.push(creds.editor);
  return staffCandidates;
}

export function loginControlStaff(baseUrl, scheduleId, creds, preferEditor = true) {
  const jar = http.cookieJar();
  const staffCandidates = selectStaffCandidates(creds, preferEditor);
  let authorized = false;
  let selectedStaffEmail = '';

  for (const staff of staffCandidates) {
    jar.clear(baseUrl);
    const loginResp = http.post(`${baseUrl}/api/v1/auth/login`, JSON.stringify(staff), {
      jar,
      headers: jsonHeaders(),
    });
    if (loginResp.status !== 200) continue;

    const probe = http.get(`${baseUrl}/api/v1/proctor/sessions/${scheduleId}`, {
      jar,
      headers: jsonHeaders(csrfHeader(jar, baseUrl)),
    });
    if (probe.status === 200) {
      authorized = true;
      selectedStaffEmail = staff.email || '';
      break;
    }
  }

  if (!authorized) {
    throw new Error(
      `No authorized staff account could access proctor view for scheduleId=${scheduleId}. ` +
        `Use a schedule that has at least one assigned proctor/admin. `,
    );
  }

  return { jar, selectedStaffEmail };
}

export function ensureStudentRegistrations(baseUrl, scheduleId, creds, students, preferEditor = true) {
  const { jar, selectedStaffEmail } = loginControlStaff(baseUrl, scheduleId, creds, preferEditor);
  const registrations = [];

  for (const student of students) {
    const resp = http.post(
      `${baseUrl}/api/v1/schedules/${scheduleId}/register`,
      JSON.stringify({
        wcode: student.wcode,
        email: student.email,
        studentName: student.fullName,
      }),
      {
        jar,
        headers: jsonHeaders(csrfHeader(jar, baseUrl)),
        tags: { name: 'schedule_register' },
      },
    );

    if (resp.status !== 200) {
      throw new Error(
        `Student registration failed (${student.wcode}): status=${resp.status} body=${bodyPreview(resp)}`,
      );
    }

    registrations.push({
      wcode: student.wcode,
      email: student.email,
      studentName: student.fullName,
    });
  }

  return { selectedStaffEmail, registrations };
}

export function shouldAutoRegisterStudents() {
  return __ENV.K6_AUTO_REGISTER === 'true';
}

export function ensureProdRunAllowed() {
  if (__ENV.K6_CONFIRM_PROD !== 'true') {
    throw new Error('Set K6_CONFIRM_PROD=true to run this load test against production.');
  }
}

export function buildStudentSlice(target, count, offset) {
  const allStudents = target.students || [];
  const studentCount = clampInt(count || '1', 1, allStudents.length || 1);
  const studentOffset = clampInt(offset || '0', 0, Math.max(0, (allStudents.length || 1) - 1));
  const students = allStudents.slice(studentOffset, studentOffset + studentCount);
  if (students.length !== studentCount) {
    throw new Error(
      `Not enough students in prod-target.json for K6_STUDENTS=${studentCount} at K6_STUDENT_OFFSET=${studentOffset}`,
    );
  }
  return { students, studentCount, studentOffset };
}

export function bootstrapStudentSession(baseUrl, scheduleId, student, jar, clientSessionId) {
  const entryResp = http.post(
    `${baseUrl}/api/v1/auth/student/entry`,
    JSON.stringify({
      scheduleId,
      wcode: student.wcode,
      email: student.email,
      studentName: student.fullName,
      entrySession: practiceEntrySession(scheduleId, student),
    }),
    { jar, headers: jsonHeaders() },
  );
  if (entryResp.status !== 200) {
    throw new Error(
      `Student entry failed (${student.wcode}): status=${entryResp.status} body=${bodyPreview(entryResp)}`,
    );
  }

  const bootstrapResp = http.post(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/bootstrap`,
    JSON.stringify({
      wcode: student.wcode,
      email: student.email,
      studentKey: '',
      candidateId: '',
      candidateName: '',
      candidateEmail: '',
      clientSessionId,
    }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
  );
  if (bootstrapResp.status !== 200) {
    throw new Error(
      `Bootstrap failed (${student.wcode}): status=${bootstrapResp.status} body=${bodyPreview(bootstrapResp)}`,
    );
  }

  const bootstrapJson = bootstrapResp.json();
  const ctx = bootstrapJson && bootstrapJson.data;
  const attempt = ctx && ctx.attempt;
  const attemptId = (attempt && attempt.id) || '';
  const attemptToken = (ctx && ctx.attemptCredential && ctx.attemptCredential.attemptToken) || '';
  const contentSnapshot = (ctx && ctx.version && ctx.version.contentSnapshot) || null;

  if (!attemptId || !attemptToken) {
    throw new Error(`Missing attemptId/attemptToken after bootstrap for ${student.wcode}`);
  }

  const precheckResp = http.post(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/precheck`,
    JSON.stringify({
      wcode: student.wcode,
      email: student.email,
      studentKey: '',
      candidateId: '',
      candidateName: '',
      candidateEmail: '',
      clientSessionId,
      preCheck: {
        browser: 'chromium',
        fullscreen: true,
        storage: true,
        network: true,
        screenDetails: true,
      },
      deviceFingerprintHash: null,
    }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
  );
  if (precheckResp.status !== 200) {
    throw new Error(
      `Precheck failed (${student.wcode}): status=${precheckResp.status} body=${bodyPreview(precheckResp)}`,
    );
  }

  return {
    attemptId,
    attemptToken,
    contentSnapshot,
    bootstrapJson,
    precheckJson: precheckResp.json(),
    clientSessionId,
  };
}

export function getStudentSession(baseUrl, scheduleId, jar, query, tags) {
  const suffix = query ? `?${query}` : '';
  return http.get(`${baseUrl}/api/v1/student/sessions/${scheduleId}${suffix}`, {
    jar,
    headers: jsonHeaders(),
    tags,
  });
}

export function waitForStudentSession(baseUrl, scheduleId, jar, options) {
  const timeoutSeconds = clampInt(options.timeoutSeconds || '60', 1, 7200);
  const pollSeconds = Number(options.pollSeconds || 1);
  const startedAt = Date.now();
  let lastResponse = null;
  let lastJson = null;

  while (Date.now() - startedAt < timeoutSeconds * 1000) {
    const resp = getStudentSession(baseUrl, scheduleId, jar, options.query || '', options.tags);
    lastResponse = resp;
    if (resp.status === 200) {
      try {
        lastJson = resp.json();
        const session = (lastJson && lastJson.data) || {};
        if (!options.isReady || options.isReady(session, lastJson)) {
          return {
            response: resp,
            json: lastJson,
            session,
            elapsedMs: Date.now() - startedAt,
          };
        }
      } catch (_) {
        // Keep polling.
      }
    }
    sleep(pollSeconds);
  }

  throw new Error(
    options.timeoutMessage ||
      `Timed out waiting for student session readiness after ${timeoutSeconds}s (last status=${lastResponse ? lastResponse.status : 'n/a'}).`,
  );
}

export function sendHeartbeat(baseUrl, scheduleId, jar, attemptId, attemptToken, clientSessionId, tags) {
  return http.post(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/heartbeat`,
    JSON.stringify({
      attemptId,
      studentKey: '',
      clientSessionId,
      eventType: 'heartbeat',
      payload: null,
      clientTimestamp: new Date().toISOString(),
    }),
    {
      jar,
      headers: jsonHeaders({
        authorization: `Bearer ${attemptToken}`,
      }),
      tags,
    },
  );
}

const attemptRevisionCache = new Map();

function coerceRevision(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function toOperationCommand(mutation, baseRevision) {
  if (!mutation || typeof mutation !== 'object') return null;

  if (
    typeof mutation.mutationId === 'string' &&
    mutation.mutationId.length > 0 &&
    typeof mutation.type === 'string' &&
    typeof mutation.baseRevision === 'number'
  ) {
    return mutation;
  }

  const mutationId = typeof mutation.id === 'string' && mutation.id.length > 0 ? mutation.id : uuidV4();
  const payload = mutation.payload && typeof mutation.payload === 'object' ? mutation.payload : {};
  const mutationType = typeof mutation.mutationType === 'string' ? mutation.mutationType : '';

  if (mutationType === 'answer') {
    const questionId = typeof payload.questionId === 'string' ? payload.questionId : '';
    if (!questionId) return null;
    const slotIndex = Number(payload.slotIndex);
    const hasSlot = Number.isFinite(slotIndex) && slotIndex >= 0 && Math.trunc(slotIndex) === slotIndex;
    const value = payload.value;

    if (hasSlot) {
      if (Array.isArray(value)) {
        if (slotIndex >= value.length) return null;
        const slotValue = value[slotIndex];
        if (typeof slotValue === 'string' && slotValue.trim().length > 0) {
          return { mutationId, baseRevision, type: 'SetSlot', questionId, slotIndex, value: slotValue };
        }
        if (slotValue === null || (typeof slotValue === 'string' && slotValue.trim().length === 0)) {
          return { mutationId, baseRevision, type: 'ClearSlot', questionId, slotIndex };
        }
        return null;
      }

      if (typeof value === 'string') {
        if (value.trim().length > 0) {
          return { mutationId, baseRevision, type: 'SetSlot', questionId, slotIndex, value };
        }
        return { mutationId, baseRevision, type: 'ClearSlot', questionId, slotIndex };
      }

      if (value === null) return { mutationId, baseRevision, type: 'ClearSlot', questionId, slotIndex };
      return null;
    }

    if (Array.isArray(value)) {
      const values = value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
      if (values.length === 0) return { mutationId, baseRevision, type: 'ClearChoice', questionId };
      return { mutationId, baseRevision, type: 'SetChoice', questionId, value: values };
    }

    if (typeof value === 'string') {
      if (value.trim().length === 0) return { mutationId, baseRevision, type: 'ClearChoice', questionId };
      return { mutationId, baseRevision, type: 'SetChoice', questionId, value: [value] };
    }

    if (value === null || value === undefined) return { mutationId, baseRevision, type: 'ClearChoice', questionId };
    return null;
  }

  if (mutationType === 'writing_answer') {
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) return null;
    const value = payload.value;
    if (typeof value === 'string' && value.trim().length > 0) {
      return { mutationId, baseRevision, type: 'SetEssayText', taskId, value };
    }
    return { mutationId, baseRevision, type: 'ClearEssayText', taskId };
  }

  if (mutationType === 'flag') {
    const questionId = typeof payload.questionId === 'string' ? payload.questionId : '';
    if (!questionId || typeof payload.value !== 'boolean') return null;
    return { mutationId, baseRevision, type: 'SetChoice', questionId, value: payload.value };
  }

  return null;
}

export function sendMutationBatch(baseUrl, scheduleId, jar, attemptId, attemptToken, clientSessionId, mutations, tags) {
  let baseRevision = attemptRevisionCache.has(attemptId) ? attemptRevisionCache.get(attemptId) : null;
  if (baseRevision === null || baseRevision === undefined) {
    const sessionResp = getStudentSession(baseUrl, scheduleId, jar, '', { name: 'student_session_for_revision' });
    if (sessionResp.status === 200) {
      try {
        const json = sessionResp.json();
        const attempt = ((json || {}).data || {}).attempt || {};
        baseRevision = coerceRevision(attempt.revision);
      } catch (_) {
        baseRevision = 0;
      }
    } else {
      baseRevision = 0;
    }
    attemptRevisionCache.set(attemptId, baseRevision);
  }

  const operationMutations = [];
  let nextBaseRevision = coerceRevision(baseRevision);
  for (const mutation of mutations || []) {
    const command = toOperationCommand(mutation, nextBaseRevision);
    if (!command) continue;
    operationMutations.push(command);
    const cmdBase = coerceRevision(command.baseRevision);
    nextBaseRevision = Math.max(nextBaseRevision, cmdBase + 1);
  }

  if (operationMutations.length === 0) {
    return {
      status: 200,
      timings: { duration: 0 },
      body: '{"data":{"serverAcceptedThroughSeq":0}}',
      json: () => ({ data: { serverAcceptedThroughSeq: 0 } }),
    };
  }

  const doPost = (commands) =>
    http.post(
      `${baseUrl}/api/v1/student/sessions/${scheduleId}/mutations:batch`,
      JSON.stringify({
        attemptId,
        mutations: commands,
      }),
      {
        jar,
        headers: jsonHeaders({
          authorization: `Bearer ${attemptToken}`,
          'Idempotency-Key': uuidV4(),
        }),
        responseCallback: EXPECT_2XX_OR_409,
        tags,
      },
    );

  const resp = doPost(operationMutations);

  if (resp.status === 200) {
    try {
      const json = resp.json();
      const data = (json || {}).data || {};
      const revision = data.revision !== undefined ? data.revision : ((data.attempt || {}).revision);
      attemptRevisionCache.set(attemptId, coerceRevision(revision));
    } catch (_) {}
  }

  return resp;
}

export function submitAttempt(baseUrl, scheduleId, jar, attemptId, attemptToken, tags) {
  const sessionResp = getStudentSession(baseUrl, scheduleId, jar, '', { name: 'student_session_for_submit' });
  let lastSeenRevision = 0;
  let serverAcceptedThroughSeq = 0;
  if (sessionResp.status === 200) {
    try {
      const json = sessionResp.json();
      const attempt = ((json || {}).data || {}).attempt || {};
      lastSeenRevision = coerceRevision(attempt.revision);
      serverAcceptedThroughSeq = coerceRevision((((attempt || {}).recovery || {}).serverAcceptedThroughSeq));
    } catch (_) {}
  }

  const submissionId = `k6-submit-${attemptId}-${uuidV4()}`;
  return http.post(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/submit`,
    JSON.stringify({
      attemptId,
      lastSeenRevision,
      submissionId,
      clientFinalSeq: serverAcceptedThroughSeq,
      serverAcceptedThroughSeq,
    }),
    {
      jar,
      headers: jsonHeaders({
        authorization: `Bearer ${attemptToken}`,
        'Idempotency-Key': uuidV4(),
      }),
      responseCallback: EXPECT_2XX_OR_409,
      tags,
    },
  );
}
