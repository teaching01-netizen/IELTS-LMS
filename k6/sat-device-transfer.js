import { practiceEntrySession } from './practice-entry.js';
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { randomBytes } from 'k6/crypto';

// SAT device-transfer burst (docs/superpowers/plans/2026-10-06-sat-session-
// ownership-and-device-transfer.md, §8 scenario 3 and docs/runbooks/
// sat-device-transfer.md). Per VU (one student):
//
//   device A entry -> authorized (claims the attempt, gets a credential)
//   device B entry -> blocked (no credential)
//   B requests a transfer -> staff approves (risk acknowledged) -> B commits
//   B reads the V2 snapshot at the new lease; A's old credential is refused
//   B repeats commit -> recovered at the SAME lease (idempotent)
//
// Run it CONCURRENTLY with k6/sat-exam-day.js on a different student slice
// to measure transfers while ordinary saves continue. Correctness counters
// must stay zero; latency trends are reported separately.
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_TARGET_PATH (students[] with
// wcode/email/fullName), K6_CREDS_PATH (staff creds: editor/proctors), and
// K6_CONFIRM_SAT=true. Use an isolated staging schedule; never a live exam.

if (__ENV.K6_CONFIRM_SAT !== 'true') {
  throw new Error('Refusing to run: set K6_CONFIRM_SAT=true and point K6_SCHEDULE_ID at an isolated staging SAT schedule.');
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

function csrfHeader(jar, baseUrl) {
  const cookies = jar.cookiesForURL(baseUrl);
  for (const name of [__ENV.AUTH_CSRF_COOKIE_NAME, '__Host-csrf', 'csrf']) {
    if (name && cookies[name] && cookies[name].length > 0) return { 'x-csrf-token': cookies[name][0] };
  }
  return {};
}

function jsonHeaders(extra) {
  return Object.assign({ 'content-type': 'application/json' }, extra || {});
}

function body(resp) {
  try {
    const parsed = resp.json();
    return (parsed && (parsed.data || parsed)) || {};
  } catch (_) {
    return {};
  }
}

const target = readJson(__ENV.K6_TARGET_PATH || '../e2e/prod-data/prod-target.json');
const creds = readJson(__ENV.K6_CREDS_PATH || '../e2e/prod-data/prod-creds.json');
const baseUrl = __ENV.K6_BASE_URL || target.baseURL;
const scheduleId = __ENV.K6_SCHEDULE_ID || target.scheduleId;
if (!baseUrl || !scheduleId) throw new Error('sat-device-transfer.js requires K6_BASE_URL and K6_SCHEDULE_ID.');

const allStudents = new SharedArray('students', () => (target.students || []));
const studentCount = clampInt(__ENV.K6_STUDENTS || '100', 1, allStudents.length || 1);
const studentOffset = clampInt(__ENV.K6_STUDENT_OFFSET || '0', 0, Math.max(0, (allStudents.length || 1) - 1));
const students = allStudents.slice(studentOffset, studentOffset + studentCount);
if (students.length !== studentCount) throw new Error(`Not enough students for K6_STUDENTS=${studentCount} at offset=${studentOffset}`);

const tRequest = new Trend('sat_transfer_request_ms');
const tApprove = new Trend('sat_transfer_approve_ms');
const tCommit = new Trend('sat_transfer_commit_ms');
const competingAuthorized = new Counter('sat_transfer_competing_entry_authorized');
const staleOwnerAccepted = new Counter('sat_transfer_stale_owner_accepted');
const duplicateOwnershipChange = new Counter('sat_transfer_duplicate_ownership_change');

export const options = {
  scenarios: {
    transfers: {
      executor: 'per-vu-iterations',
      vus: studentCount,
      iterations: 1,
      exec: 'transferFlow',
      maxDuration: '30m',
    },
  },
  thresholds: {
    sat_transfer_competing_entry_authorized: ['count==0'],
    sat_transfer_stale_owner_accepted: ['count==0'],
    sat_transfer_duplicate_ownership_change: ['count==0'],
    sat_transfer_commit_ms: ['p(95)<1000'],
  },
};

function enter(jar, student, clientSessionId) {
  const resp = http.post(
    `${baseUrl}/api/v1/auth/student/entry`,
    JSON.stringify({ scheduleId, wcode: student.wcode, email: student.email, studentName: student.fullName, clientSessionId, entrySession: practiceEntrySession(scheduleId, student) }),
    { jar, headers: jsonHeaders(), responseCallback: http.expectedStatuses(200) },
  );
  if (resp.status !== 200) fail(`entry failed (${student.wcode}): ${resp.status} ${String(resp.body).slice(0, 200)}`);
  return body(resp);
}

function staffJar() {
  const jar = new http.CookieJar();
  const candidates = [].concat(creds.editor ? [creds.editor] : [], Array.isArray(creds.proctors) ? creds.proctors : []);
  for (const staff of candidates) {
    jar.clear(baseUrl);
    const login = http.post(`${baseUrl}/api/v1/auth/login`, JSON.stringify(staff), { jar, headers: jsonHeaders() });
    if (login.status === 200) return jar;
  }
  fail('No staff credential could log in.');
  return jar;
}

function v2Snapshot(attemptId, token) {
  return http.get(`${baseUrl}/api/v2/student/attempts/${attemptId}/responses`, {
    headers: { Authorization: `Bearer ${token}` },
    responseCallback: http.expectedStatuses(200, 401, 403),
  });
}

export function transferFlow() {
  const student = students[(__VU - 1) % students.length];
  const jarA = new http.CookieJar();
  const sessionA = uuidV4();
  const entryA = enter(jarA, student, sessionA);
  const attemptId = entryA.attemptId;
  if (!entryA.attemptToken || !entryA.admission || entryA.admission.outcome !== 'authorized') {
    fail(`device A was not authorized (${student.wcode}): ${JSON.stringify(entryA.admission)}`);
  }
  const leaseA = Number(entryA.admission.leaseEpoch);

  // A second cookie jar is a second browser.
  const jarB = new http.CookieJar();
  const sessionB = uuidV4();
  const entryB = enter(jarB, student, sessionB);
  if (entryB.attemptToken || !entryB.admission || entryB.admission.outcome !== 'blocked') {
    competingAuthorized.add(1);
    fail(`competing browser was not blocked (${student.wcode}): ${JSON.stringify(entryB.admission)}`);
  }

  const t0 = Date.now();
  const request = http.post(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/device-transfers`,
    JSON.stringify({ operationId: uuidV4(), attemptId, clientSessionId: sessionB, expectedLeaseEpoch: leaseA, reasonCode: 'device_change' }),
    { jar: jarB, headers: jsonHeaders(csrfHeader(jarB, baseUrl)) },
  );
  tRequest.add(Date.now() - t0);
  check(request, { 'transfer requested': (r) => r.status === 200 }) || fail(`request failed: ${request.status} ${String(request.body).slice(0, 200)}`);
  const requestId = body(request).transfer.requestId;

  const staff = staffJar();
  const t1 = Date.now();
  const decision = http.post(
    `${baseUrl}/api/v1/proctor/sessions/${scheduleId}/device-transfers/${requestId}/decision`,
    JSON.stringify({ decision: 'approve', reason: 'k6 transfer burst', acknowledgeUnconfirmedRisk: true }),
    { jar: staff, headers: jsonHeaders(csrfHeader(staff, baseUrl)) },
  );
  tApprove.add(Date.now() - t1);
  check(decision, { 'transfer approved': (r) => r.status === 200 }) || fail(`approve failed: ${decision.status} ${String(decision.body).slice(0, 200)}`);

  const commitUrl = `${baseUrl}/api/v1/student/sessions/${scheduleId}/device-transfers/${requestId}/commit`;
  const t2 = Date.now();
  const commit = http.post(commitUrl, JSON.stringify({ clientSessionId: sessionB }), { jar: jarB, headers: jsonHeaders(csrfHeader(jarB, baseUrl)) });
  tCommit.add(Date.now() - t2);
  check(commit, { 'transfer committed': (r) => r.status === 200 }) || fail(`commit failed: ${commit.status} ${String(commit.body).slice(0, 200)}`);
  const committed = body(commit);
  const newLease = Number(committed.admission && committed.admission.leaseEpoch);

  // Lost-response retry recovers at the same lease; never a second change.
  const again = body(http.post(commitUrl, JSON.stringify({ clientSessionId: sessionB }), { jar: jarB, headers: jsonHeaders(csrfHeader(jarB, baseUrl)) }));
  if (!again.recovered || Number(again.admission && again.admission.leaseEpoch) !== newLease) duplicateOwnershipChange.add(1);

  const snapB = v2Snapshot(attemptId, committed.attemptToken);
  check(snapB, {
    'new owner reads at the new lease': (r) => r.status === 200 && Number(body(r).leaseEpoch) === leaseA + 1,
  });
  const snapA = v2Snapshot(attemptId, entryA.attemptToken);
  if (snapA.status === 200) staleOwnerAccepted.add(1);
  sleep(1);
}
