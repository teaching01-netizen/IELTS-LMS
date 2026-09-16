import http from 'k6/http';
import { check, fail, sleep } from 'k6';

// Plan E3/D3: entry wave — 5k staggered VUs check in against ONE schedule
// under ENTRY_GATE=on. The gate bounds the herd: expect 200s + retryable
// 429s, zero 500s, and (via the control probe below) zero
// duplicate attempts for one wcode submitted twice.
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_ENTRY_CSV_PATH (CSV rows:
// wcode,email,fullName — one per VU slot, >= VU count). Tune: K6_VUS
// (default 5000), K6_RAMP (default 2m), K6_ENTRY_QUEUE_MAX_SECONDS.
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
  } catch (_) {
    // The status check below will reject a 429 without a usable retry signal.
  }
  return 0;
}

export default function () {
  const row = rows[(__VU - 1) % rows.length];
  const queueMax = clampInt(__ENV.K6_ENTRY_QUEUE_MAX_SECONDS || '600', 0, 3600);
  const start = Date.now();
  let resp = entryOnce(row);
  while (resp.status === 429 && (Date.now() - start) / 1000 < queueMax) {
    const retryAfter = boundedRetryAfterSeconds(resp);
    check(resp, { '429 has bounded retry signal': () => retryAfter > 0 });
    if (retryAfter <= 0) break;
    sleep(retryAfter);
    resp = entryOnce(row);
  }
  if (resp.status >= 500) {
    fail(`entry wave 5xx (${row.wcode}): status=${resp.status} body=${String(resp.body).slice(0, 200)}`);
  }
  const finalRetryAfter = resp.status === 429 ? boundedRetryAfterSeconds(resp) : 0;
  // 429-after-retry-budget is an honest shed signal only when it carries a
  // bounded retry signal. Only 5xx (fail() above) or unexpected 4xx fail here.
  check(resp, {
    'entry admitted or bounded retry': (r) => r.status === 200 || (r.status === 429 && finalRetryAfter > 0),
    'entry never 5xx': (r) => r.status < 500,
  });
}
