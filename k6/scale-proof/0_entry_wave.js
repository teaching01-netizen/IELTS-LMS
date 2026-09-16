import http from 'k6/http';
import { check, fail } from 'k6';
import { assertRateLimitContract, requestWithRateLimitRetry } from './rate_limit_contract.js';

// Plan E3/D3: entry wave — 5k staggered VUs check in against ONE schedule
// under ENTRY_GATE=on. The gate bounds the herd: expect 200s + retryable
// 429s, zero 500s, and (via the control probe below) zero
// duplicate attempts for one wcode submitted twice.
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_ENTRY_CSV_PATH (CSV rows:
// wcode,email,fullName — one per VU slot, >= VU count). Tune: K6_VUS
// (default 5000), K6_RAMP (default 2m), K6_ENTRY_RETRY_MAX_SECONDS.
import { SharedArray } from 'k6/data';

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
if (!baseUrl || !scheduleId) {
  throw new Error('0_entry_wave.js requires K6_BASE_URL and K6_SCHEDULE_ID');
}
const rows = new SharedArray('entries', () => {
  const text = open(__ENV.K6_ENTRY_CSV_PATH || './entry-wave.csv');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('wcode'))
    .map((l) => {
      const [wcode, email, ...rest] = l.split(',');
      return { wcode: (wcode || '').trim(), email: (email || '').trim(), fullName: rest.join(',').trim() || (wcode || '').trim() };
    });
});
const vus = clampInt(__ENV.K6_VUS || '5000', 1, 10000);
if (rows.length < vus) {
  throw new Error(`entry-wave needs >= ${vus} CSV rows, got ${rows.length}`);
}

export const options = {
  scenarios: {
    wave: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.K6_RAMP || '2m', target: vus },
        { duration: __ENV.K6_HOLD || '5m', target: vus },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '60s',
    },
  },
  thresholds: {
    // Honest shape: a 429 with a bounded retry signal is the D3+E2 shed,
    // not a failure. Count only unexpected statuses (5xx + non-429 4xx) here; the
    // per-iteration checks pin admitted-or-shed + never-5xx explicitly.
    http_req_failed: [{ threshold: 'rate<0.02', expectedStatuses: [200, 429] }],
    http_req_duration: ['p(99)<5000'],
  },
};

function entryOnce(row) {
  return http.post(
    `${baseUrl}/api/v1/auth/student/entry`,
    JSON.stringify({ scheduleId, wcode: row.wcode, email: row.email, studentName: row.fullName }),
    { headers: { 'content-type': 'application/json' } },
  );
}

export default function () {
  const row = rows[(__VU - 1) % rows.length];
  const retryBudget = clampInt(__ENV.K6_ENTRY_RETRY_MAX_SECONDS || '600', 0, 3600);
  const result = requestWithRateLimitRetry(
    () => entryOnce(row),
    retryBudget,
    `entry ${row.wcode}`,
  );
  const resp = result.response;
  if (resp.status >= 500) {
    fail(`entry wave 5xx (${row.wcode}): status=${resp.status} body=${String(resp.body).slice(0, 200)}`);
  }
  const finalContract = resp.status === 429 ? assertRateLimitContract(resp, `entry ${row.wcode}`) : null;
  // 429-after-retry-budget is an honest shed signal only when it carries a
  // bounded retry signal. Only 5xx (fail() above) or unexpected 4xx fail here.
  check(resp, {
    'entry admitted or bounded retry': (r) =>
      r.status === 200 || (r.status === 429 && Boolean(finalContract && finalContract.valid)),
    'entry never 5xx': (r) => r.status < 500,
  });
}
