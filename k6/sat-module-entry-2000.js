import http from 'k6/http';
import { check, fail as k6Fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Preprovision 2,000 unique {attemptId, token, expectedBranch?} credentials.
// Modes: initial, adaptive, lost-start, lost-enter. For adaptive, expire the
// preceding personal module at K6_WAVE_AT_MS and supply expectedBranch per
// credential ("higher"/"lower"). This measures the complete HTTP entry
// protocol. The browser runner separately measures the real first answerable
// frame, which k6 cannot render.
const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
const mode = __ENV.K6_MODE || 'initial';
const vus = Number(__ENV.K6_VUS || '2000');
if (!baseUrl || !scheduleId || !['initial', 'adaptive', 'lost-start', 'lost-enter'].includes(mode)) {
  throw new Error('Provide K6_BASE_URL, K6_SCHEDULE_ID and a valid K6_MODE');
}
const creds = JSON.parse(open(__ENV.K6_ATTEMPT_TOKENS_PATH || './attempt-creds.json'));
if (!Array.isArray(creds) || creds.length < vus || creds.slice(0, vus).some((c) => !c.attemptId || !c.token)) {
  throw new Error('Need one unique {attemptId, token} credential per VU');
}
if (new Set(creds.slice(0, vus).map((c) => c.attemptId)).size !== vus) {
  throw new Error('Each VU must use a distinct attemptId');
}
if (mode === 'adaptive' && creds.slice(0, vus).some((c) =>
  !['higher', 'lower'].includes(c.expectedBranch) || !c.expectedModuleId || !c.otherModuleId ||
  !Number.isInteger(c.expectedResponseCount) || c.expectedResponseCount < 1)) {
  throw new Error('Adaptive mode requires expectedBranch, expectedModuleId, otherModuleId, and expectedResponseCount for every credential');
}

const startMs = new Trend('sat_module_start_ms');
const enterMs = new Trend('sat_module_enter_ms');
const stateMs = new Trend('sat_module_entry_state_ms');
const visibleMs = new Trend('sat_module_visible_ms');
const protocolMs = new Trend('sat_entry_to_visible_ack_ms');
const failures = new Counter('sat_module_entry_failures');
const unexpected5xx = new Counter('sat_unexpected_5xx');
const duplicateBranches = new Counter('sat_duplicate_branches');
const wrongBranches = new Counter('sat_wrong_branches');
const recoveryReads = new Counter('sat_recovery_reads');

function fail(message) {
  failures.add(1);
  k6Fail(message);
}

export const options = {
  scenarios: {
    entry: { executor: 'per-vu-iterations', vus, iterations: 1, exec: 'studentFlow', maxDuration: '20m' },
  },
  thresholds: {
    sat_module_entry_failures: ['count==0'],
    sat_unexpected_5xx: ['count==0'],
    sat_duplicate_branches: ['count==0'],
    sat_wrong_branches: ['count==0'],
    sat_module_start_ms: ['p(99)<500'],
    sat_module_enter_ms: ['p(99)<500'],
    sat_module_entry_state_ms: ['p(99)<300'],
    sat_module_visible_ms: ['p(99)<300'],
    sat_entry_to_visible_ack_ms: ['p(95)<2500', 'p(99)<4000', 'max<5000'],
  },
};

export function setup() {
  const explicit = Number(__ENV.K6_WAVE_AT_MS || 0);
  return { waveAt: explicit > Date.now() ? explicit : Date.now() + Number(__ENV.K6_WAVE_DELAY_SECONDS || 120) * 1000 };
}

function endpoint(path) {
  return `${baseUrl}/api/v1/assessment-delivery/schedules/${scheduleId}${path}`;
}

function headers(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

const expected = http.expectedStatuses(200, 404, 409, 429, 503);
function post(token, path, body, metric) {
  const before = Date.now();
  const response = http.post(endpoint(path), JSON.stringify(body), {
    headers: headers(token), responseCallback: expected,
  });
  if (response.status >= 500 && response.status !== 503) unexpected5xx.add(1);
  if (response.status === 200) metric.add(Date.now() - before);
  return response;
}

function json(response) {
  try { return response.json(); } catch (_) { return null; }
}

function retryDelay(response) {
  const raw = Number(response.headers['Retry-After'] || response.headers['retry-after'] || 1);
  sleep(Math.min(2, Math.max(0.2, raw)) + Math.random() * 0.3);
}

function entryState(token, moduleId) {
  recoveryReads.add(1);
  for (let tries = 0; tries < 5; tries += 1) {
    const before = Date.now();
    const response = http.get(endpoint(`/modules/${encodeURIComponent(moduleId)}/entry-state`), {
      headers: headers(token), responseCallback: expected,
    });
    if (response.status >= 500 && response.status !== 503) unexpected5xx.add(1);
    if (response.status === 200) {
      stateMs.add(Date.now() - before);
      return json(response);
    }
    if (response.status === 404) return null;
    if (response.status !== 429 && response.status !== 503) break;
    retryDelay(response);
  }
  fail('Entry-state recovery failed');
}

function bootstrap(token) {
  const response = http.post(endpoint('/bootstrap'), null, { headers: headers(token) });
  if (response.status >= 500 && response.status !== 503) unexpected5xx.add(1);
  if (response.status !== 200) fail(`Bootstrap failed: ${response.status}`);
  const data = json(response);
  if (!data || data.timing?.timingModel !== 'sat_personal_v1') fail('Expected personal SAT bootstrap');
  return data;
}

function chooseInitial(data) {
  const attempts = data.attempt?.moduleAttempts || [];
  const candidate = attempts.find((a) => a.state === 'not_started' && !a.startedAt);
  const module = data.sections?.flatMap((s) => s.modules || []).find((m) => m.id === candidate?.moduleId);
  if (!candidate || !module || module.adaptiveRole !== 'base') fail('Initial base module was not seeded');
  return module.id;
}

function chooseAdaptive(token, cred, waveAt) {
  const deadline = waveAt + 30_000;
  while (Date.now() < deadline) {
    // A 404 means the worker has not routed this attempt yet. Poll the one-row
    // read instead of Bootstrap, which reconciles and would turn this test into
    // a student-driven finalization stampede.
    const selected = entryState(token, cred.expectedModuleId);
    if (!selected) { sleep(0.5 + Math.random() * 0.3); continue; }
    if (entryState(token, cred.otherModuleId)) {
      duplicateBranches.add(1);
      fail('Both adaptive branch attempts exist');
    }
    const data = bootstrap(token);
    if ((data.attempt?.responses || []).length < cred.expectedResponseCount) {
      fail(`Missing Module 1 responses: ${(data.attempt?.responses || []).length}/${cred.expectedResponseCount}`);
    }
    const modules = data.sections?.flatMap((s) => s.modules || []) || [];
    const branches = (data.attempt?.moduleAttempts || []).filter((a) =>
      modules.some((m) => m.id === a.moduleId && ['higher_branch', 'lower_branch'].includes(m.adaptiveRole)));
    if (branches.length > 1) { duplicateBranches.add(1); fail('Duplicate adaptive branches'); }
    if (branches.length === 1) {
      const module = modules.find((m) => m.id === branches[0].moduleId);
      if (module.adaptiveRole !== `${cred.expectedBranch}_branch`) {
        wrongBranches.add(1);
        fail(`Wrong adaptive branch: ${module.adaptiveRole}`);
      }
      if (module.id !== cred.expectedModuleId) {
        wrongBranches.add(1);
        fail(`Selected ${module.id}, expected ${cred.expectedModuleId}`);
      }
      return module.id;
    }
    sleep(1 + Math.random() * 0.5);
  }
  fail('Adaptive branch missing 30 seconds after deadline');
}

function armOrRecover(token, moduleId) {
  let ack = null;
  for (let tries = 0; tries < 5; tries += 1) {
    if (!ack || ack.entryState === 'none') {
      const response = post(token, '/modules/start', { moduleId, ...(ack?.entryGeneration ? { generation: ack.entryGeneration } : {}) }, startMs);
      if (response.status === 200) {
        ack = mode === 'lost-start' ? entryState(token, moduleId) : json(response);
      } else if (response.status === 429 || response.status === 503) {
        retryDelay(response);
        ack = entryState(token, moduleId);
      } else {
        ack = entryState(token, moduleId);
      }
    }
    if (!ack) continue;
    if (ack.entryState === 'entered') return ack;
    if (ack.entryState === 'confirmed') return ack;
    const lead = Date.parse(ack.entryStartsAt || '') - Date.parse(ack.serverNow || '');
    if (ack.entryState !== 'armed' || lead < 1000) { ack.entryState = 'none'; continue; }
    const response = post(token, '/modules/enter', { moduleId, generation: ack.entryGeneration }, enterMs);
    if (response.status === 200) {
      ack = mode === 'lost-enter' ? entryState(token, moduleId) : json(response);
      if (ack?.entryState === 'confirmed' || ack?.entryState === 'entered') return ack;
    } else if (response.status === 429 || response.status === 503) {
      retryDelay(response);
      ack = entryState(token, moduleId);
    } else {
      ack = entryState(token, moduleId);
    }
  }
  fail('Could not arm and confirm module');
}

export function studentFlow(data) {
  const cred = creds[__VU - 1];
  const cold = bootstrap(cred.token);
  while (Date.now() < data.waveAt) sleep(Math.min(0.1, (data.waveAt - Date.now()) / 1000));
  const authorizedAt = data.waveAt;
  const moduleId = mode === 'adaptive' ? chooseAdaptive(cred.token, cred, data.waveAt) : chooseInitial(cold);
  const ack = armOrRecover(cred.token, moduleId);
  if (ack.entryState !== 'entered') {
    const wait = Date.parse(ack.entryStartsAt || '') - Date.now();
    if (!Number.isFinite(wait)) { failures.add(1); fail('Missing confirmed start time'); }
    if (wait > 0) sleep(wait / 1000);
    const visible = post(cred.token, '/modules/visible', { moduleId, generation: ack.entryGeneration }, visibleMs);
    if (visible.status !== 200 || !json(visible)?.acknowledged) {
      failures.add(1);
      fail(`Visibility ACK failed: ${visible.status}`);
    }
  }
  const finalState = entryState(cred.token, moduleId);
  if (finalState?.entryState !== 'entered') fail(`Module did not become entered: ${finalState?.entryState}`);
  const latency = Date.now() - authorizedAt;
  protocolMs.add(latency);
  check({ latency }, { 'entry visible in under five seconds': (v) => v.latency < 5000 }) || failures.add(1);
}
