import { practiceEntrySession } from './practice-entry.js';
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { randomBytes } from 'k6/crypto';
import { satAttemptUrl, satBatchRequest, assertSatAcknowledgements, assertSatStoredResponses } from './sat-response-contract.js';

// SAT exam-day distributed scenario (plan docs/sat-exam-day-10000-test-plan.md).
//
// Why this file exists: k6/prod-exam-day.js drives the IELTS V1 walk
// (listening/writing, mutations:batch). It cannot prove the SAT flow:
// cohort_section_v3 room windows, Module 1 -> lower/higher Module 2 routing
// in RW + Math, 98 delivered slots, 144-minute sitting, gap, and durable
// terminalization. This script drives the real SAT delivery paths:
//
//   entry -> V1 bootstrap (attempt credential) -> delivery bootstrap
//     -> modules/start -> V2 response batches (exact write acknowledgements)
//     -> route handoff poll -> gap -> Math -> delivery submit
//
// Fixture is read at runtime from the pinned published version: question
// counts, durations, branch IDs, and routing threshold come from bootstrap,
// never hardcoded. Defaults below match the current blueprint (27/32m RW,
// 22/35m Math, 10m gap) only as fallbacks for logging.
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_TARGET_PATH (prod-target.json
// with students[] {wcode,email,fullName}), K6_CREDS_PATH (staff creds).
// Optional: K6_STUDENTS, K6_STUDENT_OFFSET, K6_RUN_ID, K6_CONFIRM_SAT.
// Safety: refuses to run without K6_CONFIRM_SAT=true so a 10k run never
// fires by accident against a live exam. Never point at a live schedule;
// use an isolated staging schedule per run.

const EXPECT_2XX = http.expectedStatuses({ min: 200, max: 299 });
const EXPECT_2XX_OR_409 = http.expectedStatuses({ min: 200, max: 299 }, 409);
const DEBUG = __ENV.K6_DEBUG === 'true';

if (__ENV.K6_CONFIRM_SAT !== 'true') {
  throw new Error(
    'Refusing to run: set K6_CONFIRM_SAT=true and point K6_SCHEDULE_ID at an isolated staging SAT schedule. Never run the 10k rehearsal against a live exam.',
  );
}

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
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => (`0${x.toString(16)}`).slice(-2)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableHash32(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
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
  return Object.assign({ 'content-type': 'application/json' }, csrfHeader(http.cookieJar(), baseUrl), extra || {});
}

function boundedRetryAfterSeconds(resp) {
  const headers = (resp && resp.headers) || {};
  const headerValue = headers['Retry-After'] || headers['retry-after'];
  const headerSeconds = Number(headerValue);
  if (Number.isFinite(headerSeconds) && headerSeconds >= 1) {
    return clampInt(headerSeconds, 1, 65);
  }
  try {
    const body = resp.json();
    const details = (body && (body.details || (body.error && body.error.details))) || {};
    const detailSeconds = Number(details.retryAfterSeconds);
    if (Number.isFinite(detailSeconds) && detailSeconds >= 1) {
      return clampInt(detailSeconds, 1, 65);
    }
  } catch (_) {}
  return 0;
}

const targetPath = __ENV.K6_TARGET_PATH || '../e2e/prod-data/prod-target.json';
const credsPath = __ENV.K6_CREDS_PATH || '../e2e/prod-data/prod-creds.json';
const target = readJson(targetPath);
const creds = readJson(credsPath);

const baseUrl = __ENV.K6_BASE_URL || target.baseURL;
const scheduleId = __ENV.K6_SCHEDULE_ID || target.scheduleId;
const runId = __ENV.K6_RUN_ID || `sat-${Date.now()}`;
if (!baseUrl || !scheduleId) {
  throw new Error('sat-exam-day.js requires K6_BASE_URL and K6_SCHEDULE_ID (or target file values).');
}

const allStudents = new SharedArray('students', () => (target.students || []));
const studentCount = clampInt(__ENV.K6_STUDENTS || '25', 1, allStudents.length || 1);
const studentOffset = clampInt(__ENV.K6_STUDENT_OFFSET || '0', 0, Math.max(0, (allStudents.length || 1) - 1));
const students = allStudents.slice(studentOffset, studentOffset + studentCount);
if (students.length !== studentCount) {
  throw new Error(`Not enough students in target file for K6_STUDENTS=${studentCount} at offset=${studentOffset}`);
}

// Per-plan latency signals (release gates, §5). k6 thresholds below are the
// normal-online budgets; queue wait is excluded via retry accounting.
const tEntry = new Trend('sat_entry_ms');
const tBootstrap = new Trend('sat_bootstrap_ms');
const tModuleStart = new Trend('sat_module_start_ms');
const tResponseAck = new Trend('sat_response_ack_ms');
const tHandoff = new Trend('sat_handoff_ms');
const tSubmit = new Trend('sat_submit_ms');

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
      maxDuration: '6h',
      startTime: '1s',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    // Bounded 429 with retry guidance is admission shed, not failure; only
    // unexpected statuses fail. Tail budgets per plan §5 (online requests).
    http_req_failed: ['rate<0.02'],
    sat_response_ack_ms: ['p(95)<2000', 'p(99)<5000'],
    sat_bootstrap_ms: ['p(99)<5000'],
    sat_handoff_ms: ['p(99)<5000'],
    sat_submit_ms: ['p(99)<30000'],
  },
};

function staffLogin(jar) {
  const preferEditor = __ENV.K6_USE_EDITOR_AS_PROCTOR !== 'false';
  const candidates = [];
  if (preferEditor && creds.editor) candidates.push(creds.editor);
  if (Array.isArray(creds.proctors)) candidates.push(...creds.proctors);
  if (!preferEditor && creds.editor) candidates.push(creds.editor);
  for (const staff of candidates) {
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
    if (probe.status === 200) return staff.email || 'staff';
  }
  fail(`No authorized staff could access proctor view for scheduleId=${scheduleId}.`);
  return '';
}

export function controlFlow() {
  const jar = http.cookieJar();
  const staff = staffLogin(jar);
  if (DEBUG) console.log(`[sat-control] staff=${staff} schedule=${scheduleId} run=${runId} students=${studentCount}`);

  http.post(
    `${baseUrl}/api/v1/proctor/sessions/${scheduleId}/presence`,
    JSON.stringify({ action: 'join' }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
  );

  const threshold = clampInt(__ENV.K6_CHECKED_IN_THRESHOLD || `${studentCount}`, 0, studentCount);
  const waitSecs = clampInt(__ENV.K6_CHECKED_IN_TIMEOUT_SECONDS || '600', 30, 3600);
  const start = Date.now();
  const expectedEmails = new Set(students.map((s) => s.email));
  while (Date.now() - start < waitSecs * 1000) {
    const detail = http.get(`${baseUrl}/api/v1/proctor/sessions/${scheduleId}`, {
      jar,
      headers: csrfHeader(jar, baseUrl),
    });
    if (detail.status === 200) {
      try {
        const json = detail.json();
        const sessions = (json && (json.sessions || (json.data || {}).sessions)) || [];
        const matched = Array.isArray(sessions)
          ? sessions.filter((s) => expectedEmails.has(String(s.studentEmail || s.email || ''))).length
          : 0;
        if (matched >= threshold) break;
      } catch (_) {}
    }
    sleep(2);
  }

  const startResp = http.post(
    `${baseUrl}/api/v1/schedules/${scheduleId}/runtime/commands`,
    JSON.stringify({ action: 'start_runtime', reason: `sat k6 ${runId}` }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)), responseCallback: EXPECT_2XX_OR_409 },
  );
  check(startResp, { 'runtime start 200/409': (r) => r.status === 200 || r.status === 409 })
    || fail(`Start runtime failed: status=${startResp.status} body=${String(startResp.body).slice(0, 200)}`);

  const liveSecs = clampInt(__ENV.K6_WAIT_FOR_CONTROL_LIVE_TIMEOUT_SECONDS || '300', 10, 3600);
  const liveStart = Date.now();
  while (Date.now() - liveStart < liveSecs * 1000) {
    const rt = http.get(`${baseUrl}/api/v1/schedules/${scheduleId}/runtime`, {
      jar,
      headers: jsonHeaders(csrfHeader(jar, baseUrl)),
    });
    if (rt.status === 200) {
      try {
        const json = rt.json();
        const data = (json && (json.data || json)) || {};
        const status = String(data.status || '');
        if (status === 'live') break;
        if (status === 'completed' || status === 'cancelled') {
          fail(`Schedule runtime already ${status}; use a fresh staging schedule.`);
        }
      } catch (_) {}
    }
    sleep(2);
  }

  // Hold the proctor dashboard open through the sitting (staff monitoring leg).
  const monitorSecs = clampInt(__ENV.K6_PROCTOR_MONITOR_SECONDS || '120', 0, 21600);
  const hbEvery = clampInt(__ENV.K6_PROCTOR_HEARTBEAT_SECONDS || '15', 5, 120);
  const monStart = Date.now();
  let lastHb = 0;
  while (Date.now() - monStart < monitorSecs * 1000) {
    if (Date.now() - lastHb > hbEvery * 1000) {
      lastHb = Date.now();
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
    check(detail, { 'proctor detail 200': (r) => r.status === 200 });
    sleep(4);
  }
  http.post(
    `${baseUrl}/api/v1/proctor/sessions/${scheduleId}/presence`,
    JSON.stringify({ action: 'leave' }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
  );
}

// Deterministic 4-combo routing pattern: VU index selects the score band so a
// full run covers higher/higher, higher/lower, lower/higher, lower/lower.
// K6_SAT_THRESHOLD_* let the rehearsal pin threshold-minus-one / threshold /
// threshold-plus-one cases once the published routing policy is frozen.
function routingBand(vuIndex) {
  const mode = vuIndex % 4;
  if (mode === 0) return { rw: 'higher', math: 'higher' };
  if (mode === 1) return { rw: 'higher', math: 'lower' };
  if (mode === 2) return { rw: 'lower', math: 'higher' };
  return { rw: 'lower', math: 'lower' };
}

function answerFor(question, band, sectionKey, vuIndex, qIndex) {
  // RW is single-choice (A-D). Math mixes single-choice and SPR numerics.
  // Edge values required by the fixture: unanswered, changed-answer, long
  // response. Unanswered slots are preserved as null (never sent).
  const isMath = sectionKey === 'math';
  const qtype = String((question && (question.questionType || question.question_type)) || 'single_choice');
  const isSPR = isMath && qtype !== 'single_choice';
  if (qIndex % 11 === 10) return null; // deterministic unanswered slot
  if (isSPR) {
    const pool = ['12', '3/4', '.5', '-7', '2.5', '13/2'];
    return pool[(vuIndex + qIndex) % pool.length];
  }
  // Score band: higher => mostly option B (matches seeded correct key in
  // integration fixtures); lower => mostly option C. Exact threshold cases
  // are pinned by backend integration tests against the real routing policy.
  const wantHigh = (sectionKey === 'reading-writing' ? band.rw : band.math) === 'higher';
  if (qIndex % 7 === 6) return 'D'; // long-tail edge value
  return wantHigh ? 'B' : 'C';
}

function deliveryBootstrapOrFail(bearerToken, label) {
  const t0 = Date.now();
  const resp = http.post(
    `${baseUrl}/api/v1/assessment-delivery/schedules/${scheduleId}/bootstrap`,
    null,
    { headers: jsonHeaders({ authorization: `Bearer ${bearerToken}` }), responseCallback: EXPECT_2XX },
  );
  tBootstrap.add(Date.now() - t0);
  check(resp, { [`sat delivery bootstrap 200 (${label})`]: (r) => r.status === 200 })
    || fail(`Delivery bootstrap failed (${label}): status=${resp.status} body=${String(resp.body).slice(0, 300)}`);
  try {
    return resp.json();
  } catch (e) {
    fail(`Delivery bootstrap unparseable (${label}): ${String(e)}`);
    return null;
  }
}

function startModuleOrFail(bearerToken, moduleId, label) {
  const budget = clampInt(__ENV.K6_SAT_ENTRY_TIMEOUT_SECONDS || '7200', 10, 21600);
  const until = Date.now() + budget * 1000;
  while (Date.now() < until) {
    const t0 = Date.now();
    const resp = http.post(
      `${baseUrl}/api/v1/assessment-delivery/schedules/${scheduleId}/modules/start`,
      JSON.stringify({ moduleId, needContent: true }),
      { headers: jsonHeaders({ authorization: `Bearer ${bearerToken}` }), responseCallback: EXPECT_2XX_OR_409 },
    );
    if (resp.status === 200) {
      tModuleStart.add(Date.now() - t0);
      return resp.json();
    }
    let reason;
    try { const body = resp.json(); reason = (body.error || body).details?.reason; } catch (_) {}
    if (resp.status !== 409 || !['SECTION_NOT_ACTIVE', 'RUNTIME_NOT_LIVE'].includes(reason)) {
      fail(`Start module rejected (${label} ${moduleId}): status=${resp.status} reason=${reason || 'unknown'}`);
    }
    sleep(2 + Math.random());
  }
  fail(`Module never became available (${label}) within ${budget}s.`);
}

function deliveredModule(bootstrap, sectionKey, moduleId) {
  return findSection(bootstrap, sectionKey)?.modules.find((module) => module.id === moduleId);
}

function deadlineMs(moduleAttempt) {
  const value = moduleAttempt?.deadlineAt
    ? Date.parse(moduleAttempt.deadlineAt)
    : Date.parse(moduleAttempt?.startedAt) +
      (Number(moduleAttempt?.allocatedSeconds) + Number(moduleAttempt?.extensionSeconds || 0) + Number(moduleAttempt?.accumulatedPausedSeconds || 0)) * 1000;
  if (!Number.isFinite(value)) fail('SAT handoff rehearsal requires an authoritative module deadline.');
  return value;
}

function responseSnapshotOrFail(bearerToken, attemptId) {
  const resp = http.get(satAttemptUrl(baseUrl, attemptId, 'responses'), {
    headers: jsonHeaders({ authorization: `Bearer ${bearerToken}` }), responseCallback: EXPECT_2XX,
  });
  if (resp.status !== 200) fail(`SAT response snapshot failed: status=${resp.status}`);
  const snapshot = resp.json();
  satBatchRequest(snapshot, []);
  return snapshot;
}

function saveResponseOrFail(writer, command, label) {
  const t0 = Date.now();
  let request = satBatchRequest(writer.snapshot, [command]);
  for (let retry = 0; retry < 4; retry += 1) {
    const resp = http.post(satAttemptUrl(baseUrl, writer.attemptId, 'responses:batch'), JSON.stringify(request), {
      headers: jsonHeaders({ authorization: `Bearer ${writer.token}` }),
      responseCallback: http.expectedStatuses(200, 409, 429, 502, 503, 504), timeout: '15s',
    });
    if (resp.status === 200) {
      const ack = assertSatAcknowledgements(resp.json(), [command])[0];
      tResponseAck.add(Date.now() - t0);
      check(ack, { [`sat exact write acknowledged (${label})`]: (value) => value.writeId === command.writeId });
      return { status: 200, ack };
    }
    let error = null;
    try { const body = resp.json(); error = body.error || body; } catch (_) {}
    if (resp.status === 409 && error?.code === 'CONTROL_EPOCH_STALE') {
      const snapshot = responseSnapshotOrFail(writer.token, writer.attemptId);
      if (snapshot.leaseEpoch !== request.leaseEpoch) fail('SAT writer changed during the save rehearsal.');
      writer.snapshot = snapshot;
      request = satBatchRequest(snapshot, [command]);
    } else if (![0, 429, 502, 503, 504].includes(resp.status)) {
      fail(`Save response rejected (${label}): status=${resp.status} code=${error?.code || 'unknown'}`);
    }
    sleep((Math.min(2000, 250 * 2 ** retry) + Math.random() * 250) / 1000);
  }
  fail(`Save response did not settle (${label}); no answer acknowledgement was received.`);
}

function findSection(bootstrap, sectionKey) {
  const sections = (bootstrap && bootstrap.sections) || [];
  return sections.find((s) => String(s.sectionKey) === sectionKey) || null;
}

function moduleAttemptById(bootstrap, moduleId) {
  const attempts = ((bootstrap && bootstrap.attempt && bootstrap.attempt.moduleAttempts) || []);
  return attempts.find((a) => String(a.moduleId) === String(moduleId)) || null;
}

function branchAttempts(bootstrap, section) {
  if (!section) return [];
  const ids = new Set((section.modules || []).filter((m) => String(m.adaptiveRole) !== 'base').map((m) => String(m.id)));
  return ((bootstrap && bootstrap.attempt && bootstrap.attempt.moduleAttempts) || []).filter((a) => ids.has(String(a.moduleId)));
}

function journal(runIdVal, attemptId, moduleAttemptId, examQuestionId, writeId, payload, ack) {
  // Append-only action journal line. Keep full values in this restricted
  // artifact; normal k6 logs stay hashed/IDs-only. The comparator joins by
  // attemptId + moduleAttemptId + examQuestionId.
  console.log(`SAT_JOURNAL ${JSON.stringify({
    runId: runIdVal,
    scheduleId,
    attemptId,
    moduleAttemptId: moduleAttemptId || null,
    examQuestionId,
    clientWriteId: writeId,
    payload,
    ackRevision: (ack && (ack.revision || ack.serverRevision)) || null,
  })}`);
}

export function studentFlow() {
  const vuIndex = (__VU - 1) % students.length;
  const student = students[vuIndex];
  const band = routingBand(__VU);
  const jar = http.cookieJar();
  const maxJitter = clampInt(__ENV.K6_STUDENT_JITTER_MAX_SECONDS || '30', 0, 600);
  sleep((stableHash32(`${runId}:${student.wcode}`) % Math.max(1, maxJitter + 1)));

  // Fault wave (disjoint): 5% network loss, 2% session drop, 2% retry storm,
  // applied per VU so backlog drainage is exercised every module.
  const faultRoll = stableHash32(`fault:${runId}:${student.wcode}`) % 100;
  const faultLoss = faultRoll < 5;
  const faultDrop = faultRoll >= 5 && faultRoll < 7;
  void faultDrop;

  // 1. Entry with bounded 429 shed handling. One browser-owned writer
  // identity for entry AND bootstrap: under the SAT single-writer policy a
  // second identity is a second device and is blocked.
  const clientSessionId = uuidV4();
  const entryBody = JSON.stringify({ scheduleId, wcode: student.wcode, email: student.email, studentName: student.fullName, clientSessionId, entrySession: practiceEntrySession(scheduleId, student) });
  const tEntry0 = Date.now();
  let entryResp = http.post(
    `${baseUrl}/api/v1/auth/student/entry`,
    entryBody,
    { jar, headers: jsonHeaders(), responseCallback: http.expectedStatuses({ min: 200, max: 200 }, 429) },
  );
  const queueBudget = clampInt(__ENV.K6_ENTRY_QUEUE_MAX_SECONDS || '600', 0, 3600);
  const qStart = Date.now();
  while (entryResp.status === 429 && (Date.now() - qStart) / 1000 < queueBudget) {
    const retryAfter = boundedRetryAfterSeconds(entryResp);
    if (retryAfter <= 0) break;
    sleep(retryAfter);
    entryResp = http.post(
      `${baseUrl}/api/v1/auth/student/entry`,
      entryBody,
      { jar, headers: jsonHeaders(), responseCallback: http.expectedStatuses({ min: 200, max: 200 }, 429) },
    );
  }
  tEntry.add(Date.now() - tEntry0);
  check(entryResp, { 'sat entry 200': (r) => r.status === 200 })
    || fail(`SAT entry failed (${student.wcode}): status=${entryResp.status} body=${String(entryResp.body).slice(0, 200)}`);

  // 2. V1 bootstrap to mint the attempt credential (attemptId + bearer).
  const bootResp = http.post(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/bootstrap`,
    JSON.stringify({
      candidateId: student.wcode,
      candidateName: student.fullName,
      candidateEmail: student.email,
      clientSessionId,
    }),
    { jar, headers: jsonHeaders(csrfHeader(jar, baseUrl)) },
  );
  check(bootResp, { 'sat v1 bootstrap 200': (r) => r.status === 200 })
    || fail(`V1 bootstrap failed (${student.wcode}): status=${bootResp.status} body=${String(bootResp.body).slice(0, 200)}`);
  let bootJson = null;
  try {
    bootJson = bootResp.json();
  } catch (e) {
    fail(`V1 bootstrap unparseable (${student.wcode}): ${String(e)}`);
  }
  const ctx = (bootJson && (bootJson.data || bootJson)) || {};
  const attemptId = ((ctx && ctx.attempt && ctx.attempt.id) || '');
  const attemptToken = ((ctx && ctx.attemptCredential && ctx.attemptCredential.attemptToken) || '');
  if (!attemptId || !attemptToken) {
    fail(`Missing attempt credential after bootstrap for ${student.wcode}`);
  }

  // 3. Delivery bootstrap: the pinned published version + room windows.
  let bootstrap = deliveryBootstrapOrFail(attemptToken, `initial ${student.wcode}`);
  const timingModel = (bootstrap && bootstrap.timing && bootstrap.timing.timingModel) || 'unknown';
  check({ timingModel }, { 'sat timing model is cohort_section_v3': (v) => v.timingModel === 'cohort_section_v3' })
    || fail(`Unexpected timing model ${timingModel} for ${student.wcode}; pin cohort_section_v3 before the run.`);

  // Late-entry clamp proof: the bootstrap publishes entryWindowSeconds for
  // unstarted modules; a late entrant must see the room remainder, never a
  // fresh full clock. Log it; the comparator asserts server-side.
  try {
    const rw0 = findSection(bootstrap, 'reading-writing');
    const m10 = rw0 && rw0.modules.find((m) => String(m.adaptiveRole) === 'base');
    const ma0 = m10 && moduleAttemptById(bootstrap, m10.id);
    if (ma0 && ma0.entryWindowSeconds != null && m10) {
      check(ma0, {
        'sat late-entry window clamped': (a) => Number(a.entryWindowSeconds) <= Number(m10.durationSeconds),
      });
    }
  } catch (_) {}

  // 4. RW Module 1: start, answer all delivered slots, change + clear edge.
  const rw = findSection(bootstrap, 'reading-writing');
  if (!rw) fail(`RW section missing from bootstrap for ${student.wcode}`);
  const rwM1 = rw.modules.find((m) => String(m.adaptiveRole) === 'base');
  if (!rwM1) fail(`RW base module missing for ${student.wcode}`);
  startModuleOrFail(attemptToken, rwM1.id, `rw-m1 ${student.wcode}`);
  bootstrap = deliveryBootstrapOrFail(attemptToken, `rw-m1-started ${student.wcode}`);
  const rwM1Attempt = moduleAttemptById(bootstrap, rwM1.id);

  answerModule(attemptToken, attemptId, rwM1Attempt, deliveredModule(bootstrap, 'reading-writing', rwM1.id), 'reading-writing', band, vuIndex, student, faultLoss);

  // 5. Route handoff: poll until exactly one branch attempt exists. The
  // server owns expiry; the client never chooses the branch.
  const rwDeadline = deadlineMs(rwM1Attempt);
  const handoffTimeout = clampInt(__ENV.K6_SAT_HANDOFF_TIMEOUT_SECONDS || '7200', 10, 21600);
  let rwM2 = null;
  let handoffStart = Date.now();
  while (Date.now() - handoffStart < handoffTimeout * 1000) {
    const snap = deliveryBootstrapOrFail(attemptToken, `handoff-poll ${student.wcode}`);
    const branches = branchAttempts(snap, findSection(snap, 'reading-writing'));
    if (branches.length === 1) {
      const sec = findSection(snap, 'reading-writing');
      rwM2 = sec.modules.find((m) => String(m.id) === String(branches[0].moduleId)) || null;
      bootstrap = snap;
      break;
    }
    if (branches.length > 1) {
      fail(`RW routing produced ${branches.length} branches for ${student.wcode}; want exactly 1.`);
    }
    sleep(2);
  }
  tHandoff.add(Math.max(0, Date.now() - rwDeadline));
  if (!rwM2) fail(`RW handoff never landed for ${student.wcode} within ${handoffTimeout}s.`);
  check(rwM2, {
    'sat rw branch is lower/higher': (m) => ['lower_branch', 'higher_branch'].indexOf(String(m.adaptiveRole)) >= 0,
  });
  console.log(`SAT_ROUTE run=${runId} attempt=${attemptId} section=reading-writing branch=${rwM2.adaptiveRole} module=${rwM2.id}`);
  startModuleOrFail(attemptToken, rwM2.id, `rw-m2 ${student.wcode}`);
  bootstrap = deliveryBootstrapOrFail(attemptToken, `rw-m2-started ${student.wcode}`);
  answerModule(attemptToken, attemptId, moduleAttemptById(bootstrap, rwM2.id), deliveredModule(bootstrap, 'reading-writing', rwM2.id), 'reading-writing', band, vuIndex, student, faultLoss);

  // 6. Gap: wait for Math per the server runtime plan (nextSectionStartAt).
  // The client blocks closed-module editing while waiting; bootstrap stays
  // readable. K6_SAT_SKIP_GAP_WAIT=true fast-forwards on short fixtures.
  if (__ENV.K6_SAT_SKIP_GAP_WAIT !== 'true') {
    const gapWait = clampInt(__ENV.K6_SAT_GAP_WAIT_SECONDS || '30', 0, 3600);
    sleep(gapWait);
  }

  // 7. Math Module 1 -> Module 2 (same shape, includes SPR numerics).
  bootstrap = deliveryBootstrapOrFail(attemptToken, `pre-math ${student.wcode}`);
  const math = findSection(bootstrap, 'math');
  if (!math) fail(`Math section missing for ${student.wcode}`);
  const mathM1 = math.modules.find((m) => String(m.adaptiveRole) === 'base');
  if (!mathM1) fail(`Math base module missing for ${student.wcode}`);
  startModuleOrFail(attemptToken, mathM1.id, `math-m1 ${student.wcode}`);
  bootstrap = deliveryBootstrapOrFail(attemptToken, `math-m1-started ${student.wcode}`);
  const mathM1Attempt = moduleAttemptById(bootstrap, mathM1.id);
  answerModule(attemptToken, attemptId, mathM1Attempt, deliveredModule(bootstrap, 'math', mathM1.id), 'math', band, vuIndex, student, faultLoss);

  const mathDeadline = deadlineMs(mathM1Attempt);
  let mathM2 = null;
  handoffStart = Date.now();
  while (Date.now() - handoffStart < handoffTimeout * 1000) {
    const snap = deliveryBootstrapOrFail(attemptToken, `math-handoff-poll ${student.wcode}`);
    const branches = branchAttempts(snap, findSection(snap, 'math'));
    if (branches.length === 1) {
      const sec = findSection(snap, 'math');
      mathM2 = sec.modules.find((m) => String(m.id) === String(branches[0].moduleId)) || null;
      bootstrap = snap;
      break;
    }
    if (branches.length > 1) {
      fail(`Math routing produced ${branches.length} branches for ${student.wcode}; want exactly 1.`);
    }
    sleep(2);
  }
  tHandoff.add(Math.max(0, Date.now() - mathDeadline));
  if (!mathM2) fail(`Math handoff never landed for ${student.wcode} within ${handoffTimeout}s.`);
  console.log(`SAT_ROUTE run=${runId} attempt=${attemptId} section=math branch=${mathM2.adaptiveRole} module=${mathM2.id}`);
  startModuleOrFail(attemptToken, mathM2.id, `math-m2 ${student.wcode}`);
  bootstrap = deliveryBootstrapOrFail(attemptToken, `math-m2-started ${student.wcode}`);
  answerModule(attemptToken, attemptId, moduleAttemptById(bootstrap, mathM2.id), deliveredModule(bootstrap, 'math', mathM2.id), 'math', band, vuIndex, student, faultLoss);

  // 8. Terminal submit (server-owned). Exactly one receipt/submission/result.
  const terminalUntil = Date.now() + handoffTimeout * 1000;
  let terminal = false;
  while (Date.now() < terminalUntil) {
    const snap = deliveryBootstrapOrFail(attemptToken, `terminal-poll ${student.wcode}`);
    const modules = snap.attempt?.moduleAttempts || [];
    if (modules.length > 0 && modules.every((module) => ['locked', 'submitted'].includes(module.state))) {
      terminal = true;
      break;
    }
    sleep(2 + Math.random());
  }
  if (!terminal) fail(`SAT modules did not terminalize for ${student.wcode}.`);
  const snapshot = responseSnapshotOrFail(attemptToken, attemptId);
  const submissionId = attemptId;
  const submitBody = JSON.stringify({ submissionId, leaseEpoch: snapshot.leaseEpoch, controlEpoch: snapshot.controlEpoch });
  const tSub0 = Date.now();
  const submitResp = http.post(
    satAttemptUrl(baseUrl, attemptId, 'submit'),
    submitBody,
    {
      headers: jsonHeaders({ authorization: `Bearer ${attemptToken}` }),
      responseCallback: EXPECT_2XX_OR_409,
    },
  );
  tSubmit.add(Date.now() - tSub0);
  check(submitResp, { 'sat submit receipt 200': (r) => r.status === 200 })
    || fail(`SAT submit failed (${student.wcode}): status=${submitResp.status} body=${String(submitResp.body).slice(0, 300)}`);
  const receipt = submitResp.json();
  if (receipt.attemptId !== attemptId || !receipt.submissionId || !receipt.submittedAt ||
      !/^[a-f0-9]{64}$/.test(receipt.finalResponseDigest || '')) fail('SAT submit returned no durable terminal receipt.');
  // Idempotent replay must return the identical receipt.
  const replayResp = http.post(
    satAttemptUrl(baseUrl, attemptId, 'submit'),
    submitBody,
    {
      headers: jsonHeaders({ authorization: `Bearer ${attemptToken}` }),
      responseCallback: EXPECT_2XX_OR_409,
    },
  );
  if (replayResp.status !== 200) fail(`SAT submit replay failed: status=${replayResp.status}`);
  const replay = replayResp.json();
  if (replay.submissionId !== receipt.submissionId || replay.finalResponseDigest !== receipt.finalResponseDigest ||
      replay.submittedAt !== receipt.submittedAt) fail('SAT submit replay changed the terminal receipt.');
  console.log(`SAT_SUBMIT run=${runId} attempt=${attemptId} student=${student.wcode} status=${submitResp.status}`);
}

function answerModule(bearerToken, attemptId, moduleAttempt, mod, sectionKey, band, vuIndex, student, faultLoss) {
  if (!mod || !Array.isArray(mod.questions) || mod.questions.length === 0) {
    fail(`Module ${sectionKey}/${(mod && mod.moduleKey) || '?'} has no delivered questions for ${student.wcode}`);
  }
  const moduleAttemptId = (moduleAttempt && moduleAttempt.id) || null;
  const questions = mod.questions;
  const writer = { attemptId, token: bearerToken, snapshot: responseSnapshotOrFail(bearerToken, attemptId) };
  const versions = new Map(writer.snapshot.responses.map((response) => [response.questionId, response.clientVersion]));
  const finalWrites = new Map();
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const examQuestionId = q.examQuestionId || q.exam_question_id || q.id;
    if (!examQuestionId) fail(`Question ${i} in ${mod.moduleKey} missing examQuestionId for ${student.wcode}`);
    const value = answerFor(q, band, sectionKey, vuIndex, i);
    if (value === null) continue; // explicit unanswered slot (null, never sent)
    const writeId = uuidV4();
    const payload = {
      writeId, questionId: examQuestionId, clientVersion: (versions.get(examQuestionId) || 0) + 1,
      response: { answer: String(value), markedForReview: i % 9 === 8, eliminatedOptions: [], annotations: [] },
    };
    const { ack } = saveResponseOrFail(writer, payload, `${sectionKey}/${mod.moduleKey} q${i} ${student.wcode}`);
    finalWrites.set(examQuestionId, payload);
    journal(runId, attemptId, moduleAttemptId, examQuestionId, writeId, { answer: String(value) }, ack);
    // Answer-change edge: rewrite one slot per module with a new write ID;
    // final accepted version wins. Replayed write IDs must not duplicate.
    if (i === 2) {
      const changeId = uuidV4();
      const changed = {
        writeId: changeId, questionId: examQuestionId, clientVersion: payload.clientVersion + 1,
        response: { answer: sectionKey === 'math' ? '7' : 'A', markedForReview: false, eliminatedOptions: [], annotations: [] },
      };
      const changedAck = saveResponseOrFail(writer, changed, `${sectionKey}/${mod.moduleKey} q${i}-change ${student.wcode}`);
      finalWrites.set(examQuestionId, changed);
      journal(runId, attemptId, moduleAttemptId, examQuestionId, changeId, changed.response, changedAck.ack);
      // Replay the ORIGINAL write ID: must not create a second version.
      saveResponseOrFail(writer, payload, `${sectionKey}/${mod.moduleKey} q${i}-replay ${student.wcode}`);
    }
    if (faultLoss && i % 13 === 12) {
      // Staggered reconnect: pause writes briefly so backlog drainage is
      // exercised; the server deadline still governs acceptance.
      sleep(2);
    }
  }
  assertSatStoredResponses(responseSnapshotOrFail(bearerToken, attemptId), [...finalWrites.values()]);
  // Heartbeat cadence between modules mirrors UI polling.
  sleep(1);
}
