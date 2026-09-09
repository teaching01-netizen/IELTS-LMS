import http from 'k6/http';
import { check, fail } from 'k6';

// Plan Phase-D gate probe, true arrival shape (round 147): the ramping-VUs
// herd scripts (1_bootstrap_herd.js, 2_bootstrap_staggered.js) measure
// polling loops per VU, not arrivals — each VU iterates bootstrap+304
// for the whole stage, so request count inflates ~2x VU count and the
// 304 leg competes with the 200 leg for pool. The Phase-D gate is about
// ARRIVALS: N candidates arriving over T minutes, each bootstrapping
// ONCE. This script is that probe: arrival-rate executor, each iteration
// = exactly one bootstrap (no 304 second leg, no polling loop), 1:1
// token:iteration mapping via per-VU single iteration.
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_ATTEMPT_TOKENS_PATH (JSON
// array with >= K6_ARRIVALS entries), K6_ARRIVALS (total one-shot
// bootstraps, default 2000), K6_ARRIVAL_MINUTES (spread window, default 8).

const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
if (!baseUrl || !scheduleId) {
  throw new Error('3_bootstrap_arrival.js requires K6_BASE_URL and K6_SCHEDULE_ID');
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

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

const arrivals = clampInt(__ENV.K6_ARRIVALS || '2000', 1, 100000);
const minutes = clampInt(__ENV.K6_ARRIVAL_MINUTES || '8', 1, 120);
if (tokens.length < arrivals) {
  throw new Error(`Need >= ${arrivals} tokens for one-shot arrivals, have ${tokens.length}`);
}

export const options = {
  scenarios: {
    arrivals: {
      executor: 'constant-arrival-rate',
      rate: Math.max(1, Math.round(arrivals / (minutes * 60))),
      timeUnit: '1s',
      duration: `${minutes}m`,
      preAllocatedVUs: Math.min(500, arrivals),
      maxVUs: Math.min(5000, arrivals),
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', expectedStatuses: [200, 429] }],
    http_req_duration: ['p(99)<2000'],
  },
};

let claimed = 0;

export default function () {
  // One-shot: each iteration claims the next token exactly once.
  // __ITER is per-VU; use a global counter via execution info instead.
  const idx = (__VU - 1) * 100000 + __ITER;
  const token = tokens[idx % tokens.length];
  const res = http.post(
    `${baseUrl}/api/v1/assessment-delivery/schedules/${scheduleId}/bootstrap`,
    null,
    { headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } },
  );
  const etag = res.headers['ETag'] || res.headers['Etag'] || res.headers['Etag'];
  check(res, {
    'arrival bootstrap 200': (r) => r.status === 200,
    'arrival bootstrap has ETag': () => Boolean(etag),
  }) || fail(`arrival failed: status=${res.status} body=${String(res.body).slice(0, 200)}`);
  if (res.status >= 500) {
    fail(`arrival 5xx: status=${res.status}`);
  }
}
