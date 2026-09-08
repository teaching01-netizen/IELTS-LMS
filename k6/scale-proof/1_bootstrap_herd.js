import http from 'k6/http';
import { check, fail, sleep } from 'k6';

// Plan E3/D1: bootstrap herd — 2k concurrent bootstraps for ONE schedule
// must collapse via the version singleflight (VERSION_CACHE=on) + ETag/304.
// No per-VU fixture needed: every VU bootstraps the same attempt bearer
// shape against one schedule; the assertion is herd-shape, not content:
// p99 < 2s and zero 500s (singleflight turns 2k assemblies into ~1 + 304s).
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_ATTEMPT_TOKENS_PATH (JSON
// array of attempt bearer tokens for the schedule), K6_VUS (default 2000).
// Optional: K6_ETAG (If-None-Match for the 304 leg; second wave reuses it).

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
if (!baseUrl || !scheduleId) {
  throw new Error('1_bootstrap_herd.js requires K6_BASE_URL and K6_SCHEDULE_ID');
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
    herd: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: clampInt(__ENV.K6_VUS || '2000', 1, 5000) },
        { duration: '60s', target: clampInt(__ENV.K6_VUS || '2000', 1, 5000) },
        { duration: '15s', target: 0 },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Honest shape: 429-with-retryAfterSeconds is shed-signal (writes +
    // backstop tiers), not failure. Only 5xx / unexpected 4xx count.
    http_req_failed: [{ threshold: 'rate<0.01', expectedStatuses: [200, 304, 429] }],
    http_req_duration: ['p(99)<2000'],
  },
};

// SAT delivery bootstrap is the version-cache herd path (D1: ETag +
// singleflight). The V1 student bootstrap is a different endpoint with a
// different shape — this script pins the SAT delivery one.
function bootstrapOnce(token, etag) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  if (etag) headers['If-None-Match'] = etag;
  return http.post(`${baseUrl}/api/v1/assessment-delivery/schedules/${scheduleId}/bootstrap`, null, {
    headers,
  });
}

export default function () {
  const token = tokens[__VU % tokens.length];
  // 429-with-retryAfterSeconds is the shed queue: honor it and retry within
  // the queue budget instead of failing the iteration (entry-wave parity).
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
  // k6 lowercases single-word headers: the server sends `Etag` (Go
  // canonical form), visible here as `Etag`, not `ETag`/`Etag`-as-sent.
  const firstEtag = first.headers['ETag'] || first.headers['Etag'] || first.headers['Etag'];
  check(first, {
    'bootstrap 200': (r) => r.status === 200,
    'bootstrap has ETag': () => Boolean(firstEtag),
  }) || fail(`bootstrap herd failed: status=${first.status} body=${String(first.body).slice(0, 200)}`);
  if (first.status >= 500) {
    fail(`bootstrap herd 5xx: status=${first.status}`);
  }
  // Second leg: conditional re-fetch must 304 (zero bytes, herd-free).
  const etag = firstEtag || null;
  if (etag) {
    const second = bootstrapOnce(token, etag);
    check(second, { 'bootstrap 304 on ETag match': (r) => r.status === 304 });
  }
}
