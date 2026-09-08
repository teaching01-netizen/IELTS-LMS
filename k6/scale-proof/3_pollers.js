import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Plan E3/C3: poller simulation — 100k pollers at 20s interval ~= 5k rps
// steady state. k6 cannot hold 100k VUs on one box, so this script holds N
// VUs each polling every 20s and asserts the steady-state shape the plan
// requires: >90% of polls return 304 (bandwidth-free), zero 500s, p99 <
// 500ms on the poll path (snapshot cache hit, zero SQL).
//
// Required env: K6_BASE_URL, K6_SCHEDULE_ID, K6_SESSION_COOKIES_PATH (JSON
// array of {cookies} or raw Cookie header strings — one per VU slot).
// Tune: K6_VUS (default 1000 sample), K6_POLL_SECONDS (default 20).
// Smoke: K6_NOSLEEP=true skips the cadence wait (never for real runs).

const notModifiedRate = new Rate('poll_not_modified_rate');

const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
if (!baseUrl || !scheduleId) {
  throw new Error('3_pollers.js requires K6_BASE_URL and K6_SCHEDULE_ID');
}
let slots = [];
try {
  slots = JSON.parse(open(__ENV.K6_SESSION_COOKIES_PATH || './session-cookies.json'));
} catch (err) {
  throw new Error(`Cannot read session cookies: ${String(err)}`);
}
if (slots.length === 0) {
  throw new Error('Need session cookie slots for poller simulation');
}

const pollSeconds = Number(__ENV.K6_POLL_SECONDS || '20');
const noSleep = __ENV.K6_NOSLEEP === 'true';

export const options = {
  scenarios: {
    pollers: {
      executor: 'constant-vus',
      vus: Math.min(slots.length, Number(__ENV.K6_VUS || '1000')),
      duration: __ENV.K6_DURATION || '5m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<500'],
    poll_not_modified_rate: [{ threshold: 'rate>0.9', abortOnFail: true }],
  },
};

let sinceRevision = 0;

export default function () {
  const slot = slots[__VU % slots.length];
  const cookie = typeof slot === 'string' ? slot : slot.cookie || '';
  const resp = http.get(
    `${baseUrl}/api/v1/student/sessions/${scheduleId}/runtime?sinceRevision=${sinceRevision}`,
    { headers: { Cookie: cookie } },
  );
  const is304 = resp.status === 304;
  notModifiedRate.add(is304 ? 1 : 0);
  check(resp, {
    'poll 200-or-304': (r) => r.status === 200 || r.status === 304,
    'poll never 5xx': (r) => r.status < 500,
  });
  if (resp.status === 200) {
    try {
      const json = resp.json();
      const rev = (json && (json.data || json).revision) || 0;
      if (Number.isFinite(Number(rev))) sinceRevision = Number(rev);
    } catch (_) {}
  }
  // Honor the steady cadence: (VUs / pollSeconds) rps aggregate. The
  // server's pollAfterSecs fast-lane only fires 60s after control
  // commands, so steady runs hold 20s and still assert >90% 304.
  if (!noSleep) {
    sleep(pollSeconds);
  }
}
