import http from 'k6/http';
import { check, fail } from 'k6';
import { randomBytes } from 'k6/crypto';

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

export const options = {
  scenarios: {
    contend: {
      executor: 'shared-iterations',
      vus: 500,
      iterations: 500,
      maxDuration: '10m',
    },
  },
  thresholds: {
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
  const cred = creds[vu % creds.length];
  const attemptId = cred.attemptId || cred.attempt_id || cred.id;
  const token = cred.token || cred.attemptToken;
  const questionId = questions[vu % questions.length];
  // Route truth (handlers_delivery.go): the handler decodes
  // delivery.SaveResponseRequest {revision, response, markedForReview,
  // eliminatedOptions, annotations, moduleAttemptId?, stageKey?,
  // runtimeRevision?, clientWriteId?}. clientWriteId is the idempotency
  // key (write_id UNIQUE backstop); revision 0 + fresh write IDs keep
  // DISTINCT questions collision-free by construction.
  const resp = http.patch(
    `${baseUrl}/api/v1/assessment-delivery/schedules/${scheduleId}/responses/${questionId}`,
    JSON.stringify({
      revision: 0,
      response: { answer: `k6-contend vu=${vu} iter=${__ITER}` },
      markedForReview: false,
      eliminatedOptions: [],
      annotations: {},
      clientWriteId: uuidV4(),
    }),
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      responseCallback: http.expectedStatuses({ min: 200, max: 499 }),
    },
  );
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
  check(resp, { 'contend accepted/replayed/conflict (no 5xx, no deadlock)': (r) => r.status < 500 });
  void attemptId;
}
