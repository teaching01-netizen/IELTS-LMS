import http from 'k6/http';
import { check, fail } from 'k6';
import { assertRateLimitContract, requestWithRateLimitRetry } from './rate_limit_contract.js';

// Plan D3 ops note (round 147): the exam-day arrival shape is staggered
// (cohort doors open over minutes), not a simultaneous 2k ramp. The
// simultaneous profile (1_bootstrap_herd.js: 30s ramp) measures queue
// collapse; this variant measures the realistic arrival: 2k VUs over an
// 8-minute ramp, 3-minute hold, 1-minute drain. Same assertions, same
// legs (200 + ETag + 304), same bounded-429 retry contract.
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
  const retryBudget = clampInt(__ENV.K6_HERD_RETRY_MAX_SECONDS || '120', 0, 600);
  const firstResult = requestWithRateLimitRetry(
    () => bootstrapOnce(token, null),
    retryBudget,
    'staggered bootstrap',
  );
  const first = firstResult.response;
  const firstEtag = first.headers['ETag'] || first.headers['Etag'] || first.headers['Etag'];
  const firstContract = first.status === 429 ? assertRateLimitContract(first, 'staggered bootstrap') : null;
  check(first, {
    'bootstrap admitted or bounded shed': (r) =>
      r.status === 200 || (r.status === 429 && Boolean(firstContract && firstContract.valid)),
    'bootstrap never 5xx': (r) => r.status < 500,
    'bootstrap has ETag when admitted': (r) => r.status !== 200 || Boolean(firstEtag),
  }) || fail(`staggered herd failed: status=${first.status} body=${String(first.body).slice(0, 200)}`);
  if (first.status >= 500) {
    fail(`staggered herd 5xx: status=${first.status}`);
  }
  if (first.status !== 200) {
    return;
  }
  const etag = firstEtag || null;
  if (etag) {
    const secondResult = requestWithRateLimitRetry(
      () => bootstrapOnce(token, etag),
      retryBudget,
      'staggered ETag refresh',
    );
    const second = secondResult.response;
    const secondContract = second.status === 429 ? assertRateLimitContract(second, 'staggered ETag refresh') : null;
    check(second, {
      'bootstrap 304 or bounded shed on ETag refresh': (r) =>
        r.status === 304 || (r.status === 429 && Boolean(secondContract && secondContract.valid)),
      'bootstrap ETag refresh never 5xx': (r) => r.status < 500,
    });
  }
}
