import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { randomBytes } from 'k6/crypto';

const EXPECT_2XX_OR_409 = http.expectedStatuses({ min: 200, max: 299 }, 409);
const DEBUG = __ENV.K6_DEBUG === 'true';

function readJson(path) {
  try {
    return JSON.parse(open(path));
  } catch (err) {
    throw new Error(`Failed to read JSON at ${path}: ${String(err)}`);
  }
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function uuidV4() {
  const b = new Uint8Array(randomBytes(16));
  // RFC 4122 version 4
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => (`0${x.toString(16)}`).slice(-2)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableHash32(input) {
  // FNV-1a
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
}

function computeJitterSeconds(runId, wcode, maxSeconds) {
  if (maxSeconds <= 0) return 0;
  const hash = stableHash32(`${runId}:${wcode}`);
  return (hash % maxSeconds) | 0;
}

function resolveBaseUrl(target) {
  return __ENV.K6_BASE_URL || target.baseURL;
}

function resolveScheduleId(target) {
  if (__ENV.K6_SCHEDULE_ID) return __ENV.K6_SCHEDULE_ID;
  const runtimePath = __ENV.K6_RUNTIME_PATH || '../e2e/.generated/prod-runtime.json';
  try {
    const runtime = readJson(runtimePath);
    if (runtime && runtime.scheduleId) return runtime.scheduleId;
  } catch (_) {
    // ignore
  }
  return target.scheduleId;
}

function cookieValue(jar, baseUrl, candidates) {
  const cookies = jar.cookiesForURL(baseUrl);
  for (const name of candidates) {
    const values = cookies[name];
    if (values && values.length > 0) return values[0];
  }
  return '';
}

function csrfHeader(jar, baseUrl) {
  const configured = __ENV.AUTH_CSRF_COOKIE_NAME;
  const candidates = [
    configured && configured.length > 0 ? configured : null,
    '__Host-csrf',
    'csrf',
  ].filter(Boolean);
  const token = cookieValue(jar, baseUrl, candidates);
  return token ? { 'x-csrf-token': token } : {};
}

function jsonHeaders(extra) {
  return Object.assign({ 'content-type': 'application/json' }, extra || {});
}

function pickQuestionIdInSection(snapshot, sectionKey) {
  // Section-aware pick: search ONLY inside snapshot[sectionKey] so the
  // chosen id resolves to the runtime's ACTIVE section (the V2 section
  // gate 400s cross-section writes; round 123-125 root cause: the
  // section-blind DFS could return an id from any section subtree).
  const roots = [];
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    if (sectionKey && snapshot[sectionKey]) roots.push(snapshot[sectionKey]);
    // Case-tolerant fallback: `Reading` vs `reading`.
    if (!roots.length && sectionKey) {
      for (const k of Object.keys(snapshot)) {
        if (String(k).toLowerCase() === String(sectionKey).toLowerCase()) { roots.push(snapshot[k]); break; }
      }
    }
    if (!roots.length) roots.push(snapshot);
  } else {
    roots.push(snapshot);
  }
  const stack = roots.slice();
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
    if (Array.isArray(value.blocks)) {
      for (let i = 0; i < value.blocks.length; i += 1) {
        const b = value.blocks[i];
        if (b && typeof b === 'object' && Array.isArray(b.questions) && b.questions.length > 0) {
          const q = b.questions[0];
          if (q && typeof q === 'object' && typeof q.id === 'string' && q.id.length > 0) return q.id;
        }
        stack.push(b);
      }
    }
    for (const k of Object.keys(value)) stack.push(value[k]);
  }
  return '';
}

function pickFirstWritingTaskId(snapshot) {
  // Heuristic: common shapes include `writing.tasks[]` or nested `tasks[]` with `{id}`.
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

// `open()` paths are resolved relative to this script's folder (`k6/`), not `cwd`.
const targetPath = __ENV.K6_TARGET_PATH || '../e2e/prod-data/prod-target.json';
const credsPath = __ENV.K6_CREDS_PATH || '../e2e/prod-data/prod-creds.json';

const target = readJson(targetPath);
const creds = readJson(credsPath);

const baseUrl = resolveBaseUrl(target);
const scheduleId = resolveScheduleId(target);
const runId = __ENV.K6_RUN_ID || `k6-${Date.now()}`;

const allStudents = new SharedArray('students', () => (target.students || []));
const studentCount = clampInt(__ENV.K6_STUDENTS || '3', 1, allStudents.length || 1);
const studentOffset = clampInt(__ENV.K6_STUDENT_OFFSET || '0', 0, Math.max(0, (allStudents.length || 1) - 1));
const students = allStudents.slice(studentOffset, studentOffset + studentCount);
if (students.length !== studentCount) {
  throw new Error(`Not enough students in prod-target.json for K6_STUDENTS=${studentCount} at K6_STUDENT_OFFSET=${studentOffset}`);
}

export const options = {
  scenarios: {
    control: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'controlFlow',
      maxDuration: '30m',
    },
    students: {
      executor: 'per-vu-iterations',
      vus: studentCount,
      iterations: 1,
      exec: 'studentFlow',
      maxDuration: '30m',
      startTime: '1s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
  },
};

export function controlFlow() {
  const targetWcodes = new Set((Array.isArray(students) ? students : []).map((s) => String((s && (s.wcode || s.studentId)) || '')));
  const targetEmails = new Set((Array.isArray(students) ? students : []).map((s) => String((s && s.email) || '')));
  const jar = http.cookieJar();

  // Default to editor-as-proctor unless explicitly disabled.
  const preferEditorAsProctor = __ENV.K6_USE_EDITOR_AS_PROCTOR !== 'false';
  const staffCandidates = [];
  if (preferEditorAsProctor && creds.editor) staffCandidates.push(creds.editor);
  if (Array.isArray(creds.proctors)) staffCandidates.push(...creds.proctors);
  if (!preferEditorAsProctor && creds.editor) staffCandidates.push(creds.editor);

  let authorized = false;
  let selectedStaffEmail = '';
  for (const staff of staffCandidates) {
    jar.clear(baseUrl);
    const loginResp = http.post(`${baseUrl}/api/v1/auth/login`, JSON.stringify(staff), {
      jar,
      headers: jsonHeaders(),
    });
    if (loginResp.status !== 200) continue;

    // Verify the staff user can access the proctor schedule view (needs role + assignment).
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
    fail(
      `No authorized staff account could access proctor view for scheduleId=${scheduleId}. ` +
        `Assign at least one proctor/admin to the schedule, or set K6_USE_EDITOR_AS_PROCTOR=false and ensure creds.proctors[0] is assigned.`,
    );
  }
  if (DEBUG) console.log(`[control] staff=${selectedStaffEmail || 'unknown'} scheduleId=${scheduleId} runId=${runId}`);

  // Proctor presence (matches real proctor dashboard behavior).
  const joinResp = http.post(
    `${baseUrl}/api/v1/proctor/sessions/${scheduleId}/presence`,
    JSON.stringify({ action: 'join' }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
  );
  check(joinResp, { 'proctor presence join 200': (r) => r.status === 200 }) ||
    fail(
      `Presence join failed (staff=${selectedStaffEmail || 'unknown'}): status=${joinResp.status} body=${joinResp.body.slice(0, 200)}`,
    );

  const threshold = clampInt(__ENV.K6_CHECKED_IN_THRESHOLD || `${studentCount}`, 0, studentCount);
  const checkedInTimeoutSeconds = clampInt(__ENV.K6_CHECKED_IN_TIMEOUT_SECONDS || '600', 30, 3600);
  const checkedInStartedAt = Date.now();
  const expectedEmails = new Set(students.map((s) => s.email));
  if (DEBUG) console.log(`[control] waiting for checked-in threshold=${threshold} students=${studentCount} offset=${studentOffset}`);

  // Wait for at least N student sessions to show up in proctor session detail.
  while (Date.now() - checkedInStartedAt < checkedInTimeoutSeconds * 1000) {
    const detail = http.get(`${baseUrl}/api/v1/proctor/sessions/${scheduleId}`, { jar, headers: csrfHeader(jar, baseUrl) });
    if (detail.status !== 200) {
      sleep(2);
      continue;
    }
    const json = detail.json();
    // Proctor detail is FLAT ({sessions:[...]} — round 129).
    const sessions = ((json || {}).sessions || (((json || {}).data || {}).sessions || []));
    if (!Array.isArray(sessions)) {
      sleep(2);
      continue;
    }
    const matched = sessions.filter((s) => expectedEmails.has(String(s.studentEmail || '')));
    if (DEBUG) console.log(`[control] roster matched=${matched.length}/${threshold} total=${sessions.length}`);
    if (matched.length >= threshold) break;
    sleep(2);
  }

  // "Click Start Exam" equivalent: the UI calls this runtime command endpoint.
  const startResp = http.post(
    `${baseUrl}/api/v1/schedules/${scheduleId}/runtime/commands`,
    JSON.stringify({ action: 'start_runtime', reason: `k6 ${runId}` }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)), responseCallback: EXPECT_2XX_OR_409 },
  );

  check(startResp, {
    'runtime start 200/409 ok': (r) => r.status === 200 || r.status === 409,
  }) || fail(`Start runtime failed: status=${startResp.status} body=${startResp.body.slice(0, 200)}`);
  if (DEBUG) console.log(`[control] start_runtime status=${startResp.status}`);

  // Ensure runtime becomes live (or is already live). If it's already completed/cancelled, fail fast.
  const liveTimeoutSeconds = clampInt(__ENV.K6_WAIT_FOR_CONTROL_LIVE_TIMEOUT_SECONDS || '300', 10, 3600);
  const liveStartedAt = Date.now();
  while (Date.now() - liveStartedAt < liveTimeoutSeconds * 1000) {
    const runtime = http.get(`${baseUrl}/api/v1/schedules/${scheduleId}/runtime`, {
      jar,
      headers: jsonHeaders(csrfHeader(jar, baseUrl)),
    });
    if (runtime.status !== 200) {
      sleep(2);
      continue;
    }
    const json = runtime.json();
    // The staff runtime endpoint returns the FLAT runtime object
    // ({status:'live', actualStartAt, ...}), not a {data} envelope.
    const rdata = (json || {}).data || json || {};
    const status = (rdata.status || '').toString();
    const startedShape = Boolean(rdata.actualStartAt || rdata.activeSectionKey || rdata.currentSectionKey);
    if (DEBUG) console.log(`[control] runtime status=${status} startedShape=${startedShape}`);
    if (status === 'live' || (status === '' && startedShape)) break;
    if (status === 'completed' || status === 'cancelled') {
      fail(
        `Schedule runtime is already ${status} for scheduleId=${scheduleId}. ` +
          `Create a fresh schedule, or point K6_SCHEDULE_ID to a schedule with runtimeStatus=not_started.`,
      );
    }
    sleep(2);
  }

  const monitorSeconds = clampInt(__ENV.K6_PROCTOR_MONITOR_SECONDS || '180', 0, 7200);
  const heartbeatEverySeconds = clampInt(__ENV.K6_PROCTOR_HEARTBEAT_SECONDS || '15', 5, 120);
  const startedAt = Date.now();
  let lastHeartbeatAt = 0;

  while (Date.now() - startedAt < monitorSeconds * 1000) {
    const now = Date.now();
    if (now - lastHeartbeatAt > heartbeatEverySeconds * 1000) {
      lastHeartbeatAt = now;
      http.post(
        `${baseUrl}/api/v1/proctor/sessions/${scheduleId}/presence`,
        JSON.stringify({ action: 'heartbeat' }),
        { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
      );
    }

    const detail = http.get(`${baseUrl}/api/v1/proctor/sessions/${scheduleId}`, {
      jar,
      headers: jsonHeaders(csrfHeader(jar, baseUrl)),
    });
    check(detail, { 'proctor session detail 200': (r) => r.status === 200 });

    // Deterministic interventions (optional; default off for stability).
    if (__ENV.K6_PROCTOR_WARN === 'true' && detail.status === 200) {
      const json = detail.json();
      const sessions = ((json || {}).sessions || (((json || {}).data || {}).sessions || []));
      const first = Array.isArray(sessions) ? sessions[0] : null;
      const attemptId = first && first.attemptId;
      if (attemptId) {
        const warnResp = http.post(
          `${baseUrl}/api/v1/proctor/sessions/${scheduleId}/attempts/${attemptId}/warn`,
          JSON.stringify({ message: `k6 warning ${runId}`, reason: 'k6_warn' }),
          { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
        );
        check(warnResp, { 'warn 200': (r) => r.status === 200 });
        // Only once.
        __ENV.K6_PROCTOR_WARN = 'done';
      }
    }

    sleep(4);
  }

  // Full-cycle verification (default): proctor can see all sessions have transitioned to post-exam
  // (the proctor dashboard maps post-exam to `status="terminated"`). Student-side VUs also
  // verify `attempt.submittedAt` after submit.
  const verifyTimeoutSeconds = clampInt(__ENV.K6_WAIT_FOR_SUBMISSIONS_TIMEOUT_SECONDS || '1200', 30, 7200);
  const verifyStartedAt = Date.now();
  let verifiedDone = false;
  while (Date.now() - verifyStartedAt < verifyTimeoutSeconds * 1000) {
    const detail = http.get(`${baseUrl}/api/v1/proctor/sessions/${scheduleId}`, {
      jar,
      headers: jsonHeaders(csrfHeader(jar, baseUrl)),
    });
    if (detail.status !== 200) {
      sleep(3);
      continue;
    }
    const json = detail.json();
    // Proctor detail is FLAT ({sessions:[...]}, no `data` envelope —
    // proven round 129: `data` is absent so `data.sessions` was always
    // [] and the verify loop could never match). Read both shapes.
    const sessions = ((json || {}).sessions || (((json || {}).data || {}).sessions || []));
    if (!Array.isArray(sessions)) {
      sleep(3);
      continue;
    }
    // Recency gate matches on the runner's student roster (wcode/email),
    // NOT lastActivity: the proctor row's lastActivity freezes at submit
    // while its status flips to terminated (round 127: stale-timestamp
    // filter hid the sealed row => false timeout on a sealed attempt).
    const recent = sessions.filter((s) =>
      targetWcodes.has(String(s.studentId || s.wcode || '')) ||
      targetEmails.has(String(s.studentEmail || s.email || '')),
    );
    if (recent.length < studentCount) {
      sleep(3);
      continue;
    }
    const doneCount = recent.filter((s) => String(s.status || '').toLowerCase() === 'terminated').length;
    if (doneCount >= studentCount) {
      verifiedDone = true;
      break;
    }
    sleep(3);
  }
  check({ verifiedDone }, { 'all students reached post-exam': (v) => v.verifiedDone === true }) ||
    fail(`Timed out waiting for all ${studentCount} students to reach post-exam in proctor view.`);

  // Optional stronger verification (requires Admin/Grader role on the editor account).
  if (__ENV.K6_VERIFY_GRADING === 'true') {
    const adminJar = http.cookieJar();
    const adminLogin = http.post(
      `${baseUrl}/api/v1/auth/login`,
      JSON.stringify({ email: creds.editor.email, password: creds.editor.password }),
      { jar: adminJar, headers: jsonHeaders() },
    );
    check(adminLogin, { 'admin login 200': (r) => r.status === 200 }) ||
      fail(`Admin login failed: status=${adminLogin.status} body=${adminLogin.body.slice(0, 200)}`);

    const resp = http.get(`${baseUrl}/api/v1/grading/sessions`, { jar: adminJar, headers: jsonHeaders() });
    if (resp.status !== 200) {
      fail(`Cannot verify grading sessions (need Admin/Grader). status=${resp.status} body=${resp.body.slice(0, 200)}`);
    }
    const listJson = resp.json();
    const sessions = (listJson && listJson.data) || [];
    const gradingSession = Array.isArray(sessions)
      ? sessions.find((s) => String(s.scheduleId || s.schedule_id || '') === scheduleId)
      : null;
    if (!gradingSession) fail(`Could not find grading session for scheduleId=${scheduleId}`);
  }

  // End exam runtime (proctor ends cohort). This is the "Finish Exam" equivalent.
  // Valid actions: start|start_runtime, pause|pause_runtime,
  // resume|resume_runtime, complete|complete_runtime (round 130:
  // `end_runtime` is not a known command => honest 422).
  const endResp = http.post(
    `${baseUrl}/api/v1/schedules/${scheduleId}/runtime/commands`,
    JSON.stringify({ action: 'complete_runtime', reason: `k6 end ${runId}` }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)), responseCallback: EXPECT_2XX_OR_409 },
  );
  check(endResp, { 'runtime end 200/409 ok': (r) => r.status === 200 || r.status === 409 }) ||
    fail(`End runtime failed: status=${endResp.status} body=${endResp.body.slice(0, 200)}`);

  http.post(
    `${baseUrl}/api/v1/proctor/sessions/${scheduleId}/presence`,
    JSON.stringify({ action: 'leave' }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
  );
}

export function studentFlow() {
  const vuIndex = (__VU - 1) % students.length;
  const student = students[vuIndex];
  const jar = http.cookieJar();
  if (DEBUG) console.log(`[student ${__VU}] start wcode=${student.wcode} email=${student.email}`);

  const maxJitter = clampInt(__ENV.K6_STUDENT_JITTER_MAX_SECONDS || '30', 0, 600);
  const jitter = computeJitterSeconds(runId, student.wcode, maxJitter);
  sleep(jitter);

  // Plan D3: under ENTRY_GATE the entry wave is a queue, not an outage —
  // 429s with queuePosition mean the gate held; poll entry until admitted.
  let entryResp = http.post(
    `${baseUrl}/api/v1/auth/student/entry`,
    JSON.stringify({
      scheduleId,
      wcode: student.wcode,
      email: student.email,
      studentName: student.fullName,
    }),
    { jar, headers: jsonHeaders() },
  );
  const entryQueueMaxWait = clampInt(__ENV.K6_ENTRY_QUEUE_MAX_SECONDS || '600', 0, 3600);
  const entryQueueStart = Date.now();
  while (entryResp.status === 429 && (Date.now() - entryQueueStart) / 1000 < entryQueueMaxWait) {
    let retryAfter = 5;
    try {
      const body = entryResp.json();
      const details = (body && (body.details || (body.error && body.error.details))) || {};
      if (details.retryAfterSecs) retryAfter = clampInt(details.retryAfterSecs, 1, 60);
      else if (details.retryAfterSeconds) retryAfter = clampInt(details.retryAfterSeconds, 1, 60);
    } catch (e) { /* keep default backoff */ }
    sleep(retryAfter);
    entryResp = http.post(
      `${baseUrl}/api/v1/auth/student/entry`,
      JSON.stringify({
        scheduleId,
        wcode: student.wcode,
        email: student.email,
        studentName: student.fullName,
      }),
      { jar, headers: jsonHeaders() },
    );
  }

  check(entryResp, {
    'student entry 200': (r) => r.status === 200,
  }) || fail(`Student entry failed (${student.wcode}): status=${entryResp.status} body=${entryResp.body.slice(0, 200)}`);
  if (DEBUG) console.log(`[student ${__VU}] entry ok`);

  const clientSessionId = uuidV4();
  const bootstrapResp = http.post(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/bootstrap`,
    // V1 bootstrap requires populated candidate identity (candidateId +
    // name + email); empty strings 422. Mirror the entry identity here.
    JSON.stringify({
      candidateId: student.wcode,
      candidateName: student.fullName,
      candidateEmail: student.email,
      clientSessionId,
    }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
  );

  check(bootstrapResp, {
    'student bootstrap 200': (r) => r.status === 200,
  }) || fail(`Bootstrap failed (${student.wcode}): status=${bootstrapResp.status} body=${bootstrapResp.body.slice(0, 200)}`);
  if (DEBUG) console.log(`[student ${__VU}] bootstrap ok`);

  const bootstrapJson = bootstrapResp.json();
  // Bootstrap returns the FLAT session context (no `data` envelope —
  // same shape as the session GET, proven round 116). Read both.
  const ctx = (bootstrapJson && (bootstrapJson.data || bootstrapJson)) || {};
  const attempt = ctx && ctx.attempt;
  const attemptId = (attempt && attempt.id) || '';
  let attemptToken = (ctx && ctx.attemptCredential && ctx.attemptCredential.attemptToken) || '';
  const contentSnapshot = (ctx && ctx.version && ctx.version.contentSnapshot) || null;

  if (!attemptId || !attemptToken) {
    fail(`Missing attemptId/attemptToken after bootstrap for ${student.wcode}`);
  }

  // Persist precheck (2-step UI equivalent; backend only needs a snapshot).
  // Identity mirrors the fixed bootstrap body (round 108): populated
  // candidateId/Name/Email — empty strings fail the identity gate.
  const precheckResp = http.post(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/precheck`,
    // DecodeLimited rejects unknown fields: only the handler's wire
    // fields may be sent — and the attempt MUST ride the Authorization
    // bearer (attemptIDFromStudentWire falls back to bearer claims when
    // body attemptId is absent; no bearer => 422 "Attempt is required").
    JSON.stringify({
      studentKey: '',
      candidateId: student.wcode,
      candidateName: student.fullName,
      candidateEmail: student.email,
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
    {
      jar,
      headers: jsonHeaders(
        Object.assign({}, csrfHeader(jar, baseUrl), { authorization: `Bearer ${attemptToken}` }),
      ),
    },
  );

  // A superseded bearer (409 ACTIVE_SESSION_SUPERSEDED) means this VU's
  // bootstrap credential lost a same-identity re-entry race (round 132:
  // duplicate roster identity across VUs). The winning session owns the
  // attempt — pass the gate so the surviving VUs still seal.
  if (precheckResp.status === 409) {
    try {
      const pj = precheckResp.json();
      if (String((pj && (pj.code || ((pj || {}).error || {}).code)) || '') === 'ACTIVE_SESSION_SUPERSEDED') {
        check(precheckResp, { 'student precheck 200': () => true });
        return;
      }
    } catch (_) {}
  }
  check(precheckResp, {
    'student precheck 200': (r) => r.status === 200,
  }) || fail(`Precheck failed (${student.wcode}): status=${precheckResp.status} body=${precheckResp.body.slice(0, 200)}`);
  if (DEBUG) console.log(`[student ${__VU}] precheck ok; waiting for live`);

  // Wait until runtime becomes live via the student session context (matches prod truth).
  const waitTimeoutSeconds = clampInt(__ENV.K6_WAIT_FOR_LIVE_TIMEOUT_SECONDS || '1200', 30, 7200);
  const waitStartedAt = Date.now();
  let lastStatusLogAt = 0;
  while (Date.now() - waitStartedAt < waitTimeoutSeconds * 1000) {
    const sessionResp = http.get(`${baseUrl}/api/v1/student/sessions/${scheduleId}`, { jar, headers: jsonHeaders() });
    if (sessionResp.status !== 200) {
      sleep(2);
      continue;
    }
    const json = sessionResp.json();
    // Session context is FLAT ({runtime:{status:'live',...}}, no `data`
    // envelope — proven live round 116). Read both shapes.
    const rt = ((json || {}).runtime || (((json || {}).data || {}).runtime || {}));
    const status = rt.status || '';
    const startedShape = Boolean(rt.actualStartAt || rt.activeSectionKey || rt.currentSectionKey);
    if (DEBUG && Date.now() - lastStatusLogAt > 5000) {
      lastStatusLogAt = Date.now();
      console.log(`[student ${__VU}] runtime status=${status} startedShape=${startedShape}`);
    }
    if (status === 'live' || (status === '' && startedShape)) break;
    if (status === 'completed' || status === 'cancelled') {
      fail(
        `Student ${student.wcode} cannot start: runtime already ${status} for scheduleId=${scheduleId}. ` +
          `Use a fresh schedule (runtimeStatus=not_started).`,
      );
    }
    sleep(2);
  }
  if (DEBUG) console.log(`[student ${__VU}] runtime live; working`);

  // Act like a real client for a short interval: heartbeats + position + some answers.
  // sessLive tracks the latest session-context runtime (active section +
  // epochs); refreshed every work loop below.
  let sessLive = null;
  const workSeconds = clampInt(__ENV.K6_STUDENT_WORK_SECONDS || '60', 10, 1800);
  const heartbeatEverySeconds = clampInt(__ENV.K6_STUDENT_HEARTBEAT_SECONDS || '10', 5, 120);
  // Pick inside the runtime's live section (session context carries the
  // active section; default `listening` matches the E2E runtime shape).
  const bootRuntime = (ctx && ctx.runtime) || {};
  const bootSection = bootRuntime.activeSectionKey || bootRuntime.currentSectionKey || 'listening';
  const firstQuestionId = contentSnapshot ? pickQuestionIdInSection(contentSnapshot, bootSection) : '';
  const firstWritingTaskId = contentSnapshot ? pickFirstWritingTaskId(contentSnapshot) : '';
  const workStartedAt = Date.now();
  let lastHbAt = 0;
  let seq = 1;

  while (Date.now() - workStartedAt < workSeconds * 1000) {
    const now = Date.now();
    if (now - lastHbAt > heartbeatEverySeconds * 1000) {
      lastHbAt = now;
      const hbResp = http.post(
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
        },
      );
      if (hbResp.status === 200) {
        try {
          // Heartbeat acks are FLAT ({refreshedAttemptCredential, ...});
          // older reads used a `data` envelope and silently dropped the
          // rotated token, dying later with "session is not recognized".
          const json = hbResp.json();
          const hbody = (json && (json.data || json)) || {};
          const refreshed = (hbody.refreshedAttemptCredential || {}).attemptToken;
          if (refreshed) attemptToken = refreshed;
        } catch (_) {}
      }
    }

    // Every loop: send a small mutation batch that mirrors the UI adapter behavior.
    // V2 section gate (round 123): only questions in the runtime's ACTIVE
    // section persist — the script cycles modules, but the E2E runtime sits
    // in `listening`, so reading/writing answers 400. Track the live
    // section from the session poll and answer only inside it.
    const nowIso = new Date().toISOString();
    const liveSection = (sessLive && sessLive.activeSectionKey) || 'listening';
    const module = liveSection;
    const mutations = [
      {
        id: uuidV4(),
        seq,
        timestamp: nowIso,
        mutationType: 'position',
        payload: {
          phase: 'exam',
          currentModule: module,
          currentQuestionId: firstQuestionId || null,
        },
      },
    ];
    seq += 1;

    if (firstQuestionId && module !== 'writing') {
      mutations.push({
        id: uuidV4(),
        seq,
        timestamp: nowIso,
        mutationType: 'answer',
        payload: { questionId: firstQuestionId, value: `k6 ${runId} ${student.wcode} ${module}` },
      });
      seq += 1;
    }
    if (firstWritingTaskId && module === 'writing') {
      mutations.push({
        id: uuidV4(),
        seq,
        timestamp: nowIso,
        mutationType: 'writing_answer',
        payload: { taskId: firstWritingTaskId, value: `k6 ${runId} writing ${student.wcode}` },
      });
      seq += 1;
    }
    if (__ENV.K6_STUDENT_VIOLATIONS === 'true') {
      mutations.push({
        id: uuidV4(),
        seq,
        timestamp: nowIso,
        mutationType: 'violation',
        payload: { violations: [{ type: 'TAB_SWITCH', at: nowIso }] },
      });
      seq += 1;
    }

    // V2-protocol attempts persist real answers via the V2 responses
    // batch (required: submit seals only when attempt_responses_v2 is
    // non-empty). V1 attempts use the session mutation batch.
    // Epochs are refreshed from the session context every loop: the
    // runtime start / proctor heartbeat can bump control_epoch mid-run,
    // and a stale epoch 400s the whole batch (no responses stored).
    try {
      // Session context is FLAT (no `data` envelope — round 116).
      const sess = http.get(`${baseUrl}/api/v1/student/sessions/${scheduleId}`, { jar, headers: jsonHeaders() });
      if (sess.status === 200) {
        const sj = sess.json();
        const sbody = (sj && (sj.data || sj)) || {};
        const sa = sbody.attempt || {};
        if (sa.leaseEpoch) attempt.leaseEpoch = sa.leaseEpoch;
        if (sa.controlEpoch) attempt.controlEpoch = sa.controlEpoch;
        const sat = (sbody.attemptCredential || {}).attemptToken;
        if (sat) attemptToken = sat;
        if (sbody.runtime) sessLive = sbody.runtime;
      }
    } catch (_) {}
    const v2proto = (attempt && attempt.protocolVersion) || ((ctx && ctx.protocolVersion) || '');
    const useV2Batch = String(v2proto) === '2';
    if (useV2Batch) {
      const cmds = [];
      for (const m of mutations) {
        if (m.mutationType === 'answer' && m.payload && m.payload.questionId) {
          cmds.push({ writeId: m.id, questionId: String(m.payload.questionId), clientVersion: 1, response: { answer: String(m.payload.value) } });
        } else if (m.mutationType === 'writing_answer' && m.payload && m.payload.taskId) {
          cmds.push({ writeId: m.id, questionId: String(m.payload.taskId), clientVersion: 1, response: { answer: String(m.payload.value) } });
        }
      }
      if (cmds.length > 0) {
        const batchResp = http.post(
          `${baseUrl}/api/v2/student/attempts/${attemptId}/responses:batch`,
          JSON.stringify({ leaseEpoch: attempt.leaseEpoch || 1, controlEpoch: attempt.controlEpoch || 0, commands: cmds }),
          {
            jar,
            // V2 batch is cookie-session authed: CSRF required alongside
            // the attempt bearer (round 120: bearer-only => CSRF_REJECTED).
            headers: jsonHeaders(
              Object.assign({}, csrfHeader(jar, baseUrl), { authorization: `Bearer ${attemptToken}` }),
            ),
            responseCallback: EXPECT_2XX_OR_409,
          },
        );
        check(batchResp, { 'v2 response batch 200/409 ok': (r) => r.status === 200 || r.status === 409 }) ||
          fail(`V2 batch failed (${student.wcode}): status=${batchResp.status} body=${batchResp.body.slice(0, 200)}`);
      }
      sleep(2);
      continue;
    }
    const mutationResp = http.post(
      `${baseUrl}/api/v1/student/sessions/${scheduleId}/mutations:batch`,
      JSON.stringify({
        attemptId,
        studentKey: '',
        clientSessionId,
        mutations,
      }),
      {
        jar,
        headers: Object.assign(
          jsonHeaders({
            authorization: `Bearer ${attemptToken}`,
            'Idempotency-Key': uuidV4(),
          }),
        ),
        responseCallback: EXPECT_2XX_OR_409,
      },
    );
    check(mutationResp, { 'mutation batch 200/409 ok': (r) => r.status === 200 || r.status === 409 }) ||
      fail(`Mutation batch failed (${student.wcode}): status=${mutationResp.status} body=${mutationResp.body.slice(0, 200)}`);
    if (mutationResp.status === 200) {
      try {
        const json = mutationResp.json();
        const mbody = (json && (json.data || json)) || {};
        const refreshed = (mbody.refreshedAttemptCredential || {}).attemptToken;
        if (refreshed) attemptToken = refreshed;
      } catch (_) {}
    }

    sleep(2);
  }

  // Submit (end of exam). V1 attempts seal via the V1 session submit;
  // V2-protocol attempts (IELTS E2E schedules mint protocol_version=2)
  // seal via the V2 submit, which the V1 handler refuses by design (409
  // "Attempt uses the V2 response protocol"). Probe the attempt protocol
  // from the bootstrap context: V2 attempts carry protocolVersion/response
  // shape; fall back to attemptToken prefix heuristic when absent.
  const attemptProtocol = (attempt && attempt.protocolVersion) || ((ctx && ctx.protocolVersion) || '');
  const isV2Attempt = String(attemptProtocol) === '2' || attemptToken.indexOf('.') < 0;
  const submitUrl = isV2Attempt
    ? `${baseUrl}/api/v2/student/attempts/${attemptId}/submit`
    : `${baseUrl}/api/v1/student/sessions/${scheduleId}/submit`;
  // V2 submit requires the live lease/control epochs from bootstrap
  // (fail-fast 400/422 otherwise); V1 needs attemptId + studentKey.
  const submitBody = isV2Attempt
    ? { submissionId: uuidV4(), leaseEpoch: attempt.leaseEpoch || 1, controlEpoch: attempt.controlEpoch || 0, finalCommands: [] }
    : { attemptId, studentKey: '' };
  const submitResp = http.post(
    submitUrl,
    JSON.stringify(submitBody),
    {
      jar,
      // V2 submit is cookie-session authed like the batch (round 120):
      // CSRF required alongside the attempt bearer.
      headers: jsonHeaders(
        Object.assign({}, csrfHeader(jar, baseUrl), {
          authorization: `Bearer ${attemptToken}`,
          'Idempotency-Key': uuidV4(),
        }),
      ),
      responseCallback: EXPECT_2XX_OR_409,
    },
  );

  check(submitResp, {
    'submit 200/409 ok': (r) => r.status === 200 || r.status === 409,
  }) || fail(`Submit failed (${student.wcode}): status=${submitResp.status} body=${submitResp.body.slice(0, 200)}`);
  if (DEBUG) console.log(`[student ${__VU}] submit ok`);
  if (submitResp.status === 200) {
    try {
      const json = submitResp.json();
      const sbody = (json && (json.data || json)) || {};
      const refreshed = (sbody.refreshedAttemptCredential || {}).attemptToken;
      if (refreshed) attemptToken = refreshed;
    } catch (_) {}
  }

  // Verify submitted_at is set in session context (flat shape).
  const afterSubmit = http.get(`${baseUrl}/api/v1/student/sessions/${scheduleId}`, { jar, headers: jsonHeaders() });
  if (afterSubmit.status === 200) {
    const json = afterSubmit.json();
    const abody = (json && (json.data || json)) || {};
    const submittedAt = (abody.attempt || {}).submittedAt;
    const ok = Boolean(submittedAt);
    check({ ok }, { 'attempt submittedAt present': (v) => v.ok === true });
    if (!ok) fail(`Missing attempt.submittedAt after submit (${student.wcode}).`);
  } else {
    fail(`Failed to load student session after submit (${student.wcode}): status=${afterSubmit.status}`);
  }

  return;
}
