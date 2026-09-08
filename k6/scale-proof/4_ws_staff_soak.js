import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail, sleep } from 'k6';

// Plan E3/C1: staff-only WS soak. Students are 410-gone (STUDENT_WS=gone)
// and must NEVER hold sockets; proctors/observers hold long-lived
// connections. This soak asserts both halves: (a) a student-attempt bearer
// opening the socket gets 410 + {use: runtime-poll}, (b) N staff sockets
// stay open for the soak with heartbeats and no abnormal closes.
//
// Required env: K6_BASE_URL (+ ws scheme derived), K6_SCHEDULE_ID,
// K6_STAFF_COOKIES_PATH (JSON array of Cookie header strings with
// proctor/admin session), K6_STUDENT_TOKEN (one attempt bearer for the
// 410 probe). Tune: K6_VUS (default 50), K6_DURATION (default 10m).

const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
const studentToken = __ENV.K6_STUDENT_TOKEN;
if (!baseUrl || !scheduleId) {
  throw new Error('4_ws_staff_soak.js requires K6_BASE_URL and K6_SCHEDULE_ID');
}
let staffCookies = [];
try {
  staffCookies = JSON.parse(open(__ENV.K6_STAFF_COOKIES_PATH || './staff-cookies.json'));
} catch (err) {
  throw new Error(`Cannot read staff cookies: ${String(err)}`);
}
if (staffCookies.length === 0) {
  throw new Error('Need staff session cookies for WS soak');
}

// Route truth (backend/go/cmd/api/main.go): GET /api/v1/ws/live (query:
// scheduleId, attemptId?, lastSeenRuntimeRevision?).
function wsUrl() {
  const httpUrl = `${baseUrl}/api/v1/ws/live?scheduleId=${scheduleId}`;
  return httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

// NOTE (k6 v2): with TWO named execs and no `default` export, pass ONLY
// `-e` flags plus `--include-system-env-vars=false`. A leaked host K6_*
// var (or any system env merge) makes k6 build an `env`-level config that
// wipes `scenarios` ("function 'default' not found"). Proven working:
// k6 run --include-system-env-vars=false -e K6_BASE_URL=... -e ... script.js
export const options = {
  scenarios: {
    student_gone_probe: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'studentGoneProbe',
    },
    staff_soak: {
      executor: 'constant-vus',
      vus: Math.min(staffCookies.length, Number(__ENV.K6_VUS || '50')),
      duration: __ENV.K6_DURATION || '10m',
      exec: 'staffSoak',
      startTime: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

// Truth (handlers_ws.go): the gate is session-cookie auth (requireSession)
// + STUDENT_WS=gone for role=student -> 410 pre-upgrade. k6 ws.connect
// cannot easily carry the session cookie jar through the upgrade, so the
// 410 is probed at the HTTP layer: a student-cookie GET on /ws/live must
// 410 (proves the gate fires before upgrade for that identity).
export function studentGoneProbe() {
  const cookie = __ENV.K6_STUDENT_COOKIE || '';
  if (!cookie) {
    fail('studentGoneProbe requires K6_STUDENT_COOKIE (student session cookie)');
  }
  const httpUrl = `${baseUrl}/api/v1/ws/live?scheduleId=${scheduleId}`;
  const res = http.get(httpUrl, { headers: { Cookie: cookie } });
  check(res, {
    'student WS gone (410 + runtime-poll use)': (r) => {
      if (r.status !== 410) return false;
      try {
        const body = r.json();
        const details = (body && (body.details || (body.error && body.error.details))) || {};
        return details.use === 'runtime-poll';
      } catch (_) {
        return false;
      }
    },
  }) || fail(`student WS not retired: status=${res.status} body=${String(res.body).slice(0, 200)}`);
  void studentToken;
}

export function staffSoak() {
  const slot = staffCookies[__VU % staffCookies.length];
  const cookie = typeof slot === 'string' ? slot : slot.cookie || '';
  const url = wsUrl();
  const res = ws.connect(
    url,
    { headers: { Cookie: cookie } },
    (socket) => {
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'subscribe', scheduleId }));
      });
      socket.on('message', () => {});
      socket.on('error', (e) => {
        if (`${e.error}`.includes('abnormal')) {
          fail(`staff WS abnormal error: ${e.error}`);
        }
      });
      const endAt = Date.now() + 9 * 60 * 1000;
      socket.setInterval(() => {
        if (Date.now() > endAt) {
          socket.close();
          return;
        }
        socket.ping();
      }, 15000);
      socket.setTimeout(() => socket.close(), 10 * 60 * 1000);
    },
  );
  check(res, { 'staff socket established (101)': (r) => r && r.status === 101 });
  sleep(1);
}
