import http from 'k6/http';
import { check, fail, sleep } from 'k6';

// Plan D3 ops note (round 147): the exam-day arrival shape is staggered
// (cohort doors open over minutes), not a simultaneous 2k ramp. The
// simultaneous profile (1_bootstrap_herd.js: 30s ramp) measures queue
// collapse; this variant measures the realistic arrival: 2k VUs over an
// 8-minute ramp, 3-minute hold, 1-minute drain. Same assertions, same
// legs (200 + ETag + 304), same honest-429 queue honor.
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_ATTEMPT_TOKENS_PATH (JSON
// array of attempt bearer tokens, 1:1 with VUs for rotation-cleanliness),
// K6_VUS (default 2000).

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
if (!baseUrl || !scheduleId) {
  throw new Error('2_bootstrap_staggered.js requires K6_BASE_URL and K6_SCHEDULE_ID');
}
let tokens = [];
try {
  tokens = JSON.parse(open(__ENV.K6_ATTEMPT_TOKENS_PATH || './attempt-tokens.json'));
} catch (err) {
  throw new Error(`Cannot read attempt tokens: ${String(err)} (preprovision the schedule first)`);
}
if (!Array.isArray(tokens) || tokens.length === 0) {
  throw new Error('Attempt token list is empty; preprovision the schedule first');
}

export const options = {
  scenarios: {
    staggered: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '8m', target: clampInt(__ENV.K6_VUS || '2000', 1, 5000) },
        { duration: '3m', target: clampInt(__ENV.K6_VUS || '2000', 1, 5000) },
        { duration: '1m', target: 0 },
      ],
      gracefulStop: '60s',
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', expectedStatuses: [200, 304, 429] }],
    http_req_duration: ['p(99)<2000'],
  },
};

function bootstrapOnce(token, etag) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  if (etag) headers['If-None-Match'] = etag;
  return http.post(`${baseUrl}/api/v1/assessment-delivery/schedules/${scheduleId}/bootstrap`, null, {
    headers,
  });
}

export default function () {
  const token = tokens[__VU % tokens.length];
  const queueMax = clampInt(__ENV.K6_HERD_QUEUE_MAX_SECONDS || '120', 0, 600);
  const start = Date.now();
  let first = bootstrapOnce(token, null);
  while (first.status === 429 && (Date.now() - start) / 1000 < queueMax) {
    let retryAfter = 1;
    try {
      const body = first.json();
      const details = (body && (body.details || (body.error && body.error.details))) || {};
      if (details.retryAfterSecs) retryAfter = clampInt(details.retryAfterSecs, 1, 60);
      else if (details.retryAfterSeconds) retryAfter = clampInt(details.retryAfterSeconds, 1, 60);
    } catch (_) {}
    sleep(retryAfter);
    first = bootstrapOnce(token, null);
  }
  const firstEtag = first.headers['ETag'] || first.headers['Etag'] || first.headers['Etag'];
  check(first, {
    'bootstrap 200': (r) => r.status === 200,
    'bootstrap has ETag': () => Boolean(firstEtag),
  }) || fail(`staggered herd failed: status=${first.status} body=${String(first.body).slice(0, 200)}`);
  if (first.status >= 500) {
    fail(`staggered herd 5xx: status=${first.status}`);
  }
  const etag = firstEtag || null;
  if (etag) {
    const second = bootstrapOnce(token, etag);
    check(second, { 'bootstrap 304 on ETag match': (r) => r.status === 304 });
  }
}
