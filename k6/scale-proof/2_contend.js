import http from 'k6/http';
import { check, fail } from 'k6';
import { randomBytes } from 'k6/crypto';
import { satAttemptUrl, satBatchRequest, assertSatAcknowledgements, assertSatStoredResponses } from '../sat-response-contract.js';

// Plan E3/B1: 500-way same-schedule save contention must produce ZERO
// deadlocks. 500 VUs hammer one schedule with DISTINCT questions per VU
// (no write_id/version collisions by construction — only lock contention
// remains). Any 500, any deadlock-coded 409, or any failed check fails
// the run: RC + attempt->question lock order must hold under pressure.
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_ATTEMPT_TOKENS_PATH (JSON
// array of {attemptId, token}), K6_QUESTION_IDS_PATH (JSON array of
// question IDs, >= VU count recommended).

function uuidV4() {
  const b = new Uint8Array(randomBytes(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => (`0${x.toString(16)}`).slice(-2)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
if (!baseUrl || !scheduleId) {
  throw new Error('2_contend.js requires K6_BASE_URL and K6_SCHEDULE_ID');
}
let creds = [];
try {
  creds = JSON.parse(open(__ENV.K6_ATTEMPT_TOKENS_PATH || './attempt-tokens.json'));
} catch (err) {
  throw new Error(`Cannot read attempt creds: ${String(err)}`);
}
let questions = [];
try {
  questions = JSON.parse(open(__ENV.K6_QUESTION_IDS_PATH || './question-ids.json'));
} catch (err) {
  throw new Error(`Cannot read question ids: ${String(err)}`);
}
if (creds.length === 0 || questions.length === 0) {
  throw new Error('Need non-empty attempt creds + question ids for contention');
}
const vus = Number(__ENV.K6_VUS || 500);
if (!Number.isSafeInteger(vus) || vus < 1 || creds.length < vus ||
    new Set(creds.slice(0, vus).map((cred) => cred.attemptId || cred.attempt_id || cred.id)).size !== vus) {
  throw new Error('Contention requires one distinct attempt per VU; set K6_VUS to the available roster size.');
}

export const options = {
  scenarios: {
    contend: {
      executor: 'shared-iterations',
      vus,
      iterations: vus,
      maxDuration: '10m',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<3000'],
  },
};

function isDeadlock(body) {
  try {
    const text = JSON.stringify(body).toLowerCase();
    return text.includes('deadlock') || text.includes('lock wait timeout') || text.includes('try restarting transaction');
  } catch (_) {
    return false;
  }
}

export default function () {
  const vu = __VU;
  const cred = creds[vu - 1];
  const attemptId = cred.attemptId || cred.attempt_id || cred.id;
  const token = cred.token || cred.attemptToken;
  const questionId = questions[(vu - 1) % questions.length];
  const params = { headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, responseCallback: http.expectedStatuses(200) };
  const snapshotURL = satAttemptUrl(baseUrl, attemptId, 'responses');
  const before = http.get(snapshotURL, params);
  if (before.status !== 200) fail(`contend snapshot failed (vu=${vu}): status=${before.status}`);
  const snapshot = before.json();
  const previousVersion = snapshot.responses?.find((response) => response.questionId === questionId)?.clientVersion || 0;
  const command = { questionId, writeId: uuidV4(), clientVersion: previousVersion + 1,
    response: { answer: cred.answer || 'A', markedForReview: false, eliminatedOptions: [], annotations: [] } };
  const resp = http.post(satAttemptUrl(baseUrl, attemptId, 'responses:batch'),
    JSON.stringify(satBatchRequest(snapshot, [command])), params);
  if (resp.status >= 500) {
    fail(`contend 5xx (vu=${vu}): status=${resp.status} body=${String(resp.body).slice(0, 200)}`);
  }
  let body = null;
  try {
    body = resp.json();
  } catch (_) {}
  if (isDeadlock(body)) {
    fail(`contend deadlock surfaced (vu=${vu}): body=${String(resp.body).slice(0, 200)}`);
  }
  if (!check(resp, { 'contend save acknowledged': (r) => r.status === 200 })) fail(`contend save rejected (vu=${vu}): status=${resp.status}`);
  assertSatAcknowledgements(body, [command]);
  const after = http.get(snapshotURL, params);
  if (after.status !== 200) fail(`contend verification failed (vu=${vu}): status=${after.status}`);
  assertSatStoredResponses(after.json(), [command]);
}
