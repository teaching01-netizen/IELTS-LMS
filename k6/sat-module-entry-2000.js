import http from 'k6/http';
import { check, fail as k6Fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Preprovision 2,000 unique {attemptId, token, expectedBranch?} credentials.
// Modes: initial, adaptive, lost-start, lost-enter. For adaptive, expire the
// preceding personal module at K6_WAVE_AT_MS and supply expectedBranch per
// credential ("higher"/"lower"). This measures the complete HTTP entry
// protocol. The browser runner separately measures the real first answerable
// frame, which k6 cannot render.
//
// Two additions serve the time-expiry release gate:
//   - Every Bootstrap response body is scanned for the UNAssigned branch's
//     module id (adaptive mode). The server delivers both adaptive branches in
//     one immutable version tree, so a body that mentions otherModuleId means
//     the delivered-branch fence regressed.
//   - K6_SAVE_LOOP=1 keeps each candidate answering while its module's window
//     elapses, then waits for the server (worker sweep or the candidate's own
//     lazy reconcile) to close it. It records expiry -> locked latency and
//     proves no already-accepted answer was lost by the close.
const baseUrl = __ENV.K6_BASE_URL;
const scheduleId = __ENV.K6_SCHEDULE_ID;
const mode = __ENV.K6_MODE || 'initial';
const vus = Number(__ENV.K6_VUS || '2000');
const saveLoop = __ENV.K6_SAVE_LOOP === '1';
const savePollMs = Number(__ENV.K6_SAVE_POLL_MS || '250');
const closeWaitSeconds = Number(__ENV.K6_CLOSE_WAIT_SECONDS || '120');
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
  !Array.isArray(c.otherQuestionIds) || c.otherQuestionIds.length === 0 ||
  !Number.isInteger(c.expectedResponseCount) || c.expectedResponseCount < 1)) {
  // The unassigned branch's QUESTION ids are required, not just its module id:
  // a body that drops the module but still carries its questions is the same
  // leak, and the module id alone would not catch it.
  throw new Error('Adaptive mode requires expectedBranch, expectedModuleId, otherModuleId, otherQuestionIds, and expectedResponseCount for every credential');
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
// Expiry -> routed-branch-visible latency (wave at K6_WAVE_AT_MS).
const branchVisibleMs = new Trend('sat_branch_visible_ms');
// A Bootstrap body that mentions the unassigned branch's module id.
const otherBranchLeaks = new Counter('sat_other_branch_leaks');
// A Bootstrap body that mentions a QUESTION of the unassigned branch.
const otherBranchQuestionLeaks = new Counter('sat_other_branch_question_leaks');
// The delivered branch changed identity after its module closed (route drift).
const routeDrift = new Counter('sat_route_drift');
// An already-accepted answer missing from the server's response projection.
const lostSaves = new Counter('sat_lost_saves');
// Authoritative module deadline -> the module reading locked/submitted.
const timeoutCloseMs = new Trend('sat_timeout_close_ms');

// Credential of the current VU, set at the top of studentFlow. Bootstrap is
// the single funnel for every delivery read, so the branch fence is asserted
// once, inside it.
let otherModuleId = null;
let otherQuestionIds = [];

function fail(message) {
  failures.add(1);
  k6Fail(message);
}

// Thresholds on a metric that never receives a sample are only added where the
// metric is guaranteed to be populated, so a non-adaptive run cannot fail on an
// empty trend. The branch-visibility numbers are the proposed release bar
// (p99 under 10 s, max under 30 s); agree them with the exam team before
// treating a failure as a release blocker.
const thresholds = {
  sat_module_entry_failures: ['count==0'],
  sat_unexpected_5xx: ['count==0'],
  sat_duplicate_branches: ['count==0'],
  sat_wrong_branches: ['count==0'],
  sat_module_start_ms: ['p(99)<500'],
  sat_module_enter_ms: ['p(99)<500'],
  sat_module_entry_state_ms: ['p(99)<300'],
  sat_module_visible_ms: ['p(99)<300'],
  sat_entry_to_visible_ack_ms: ['p(95)<2500', 'p(99)<4000', 'max<5000'],
};
if (mode === 'adaptive') {
  thresholds.sat_other_branch_leaks = ['count==0'];
  thresholds.sat_other_branch_question_leaks = ['count==0'];
  thresholds.sat_branch_visible_ms = ['p(50)<5000', 'p(95)<8000', 'p(99)<10000', 'max<30000'];
  if (saveLoop) {
    thresholds.sat_lost_saves = ['count==0'];
    thresholds.sat_timeout_close_ms = ['p(95)<15000', 'max<60000'];
    thresholds.sat_route_drift = ['count==0'];
  }
}

export const options = {
  scenarios: {
    entry: { executor: 'per-vu-iterations', vus, iterations: 1, exec: 'studentFlow', maxDuration: '20m' },
  },
  thresholds,
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
  // SEV-1 fence, verified on the RAW body so any field that re-exposes the
  // unassigned branch fails the run rather than only the sections tree.
  const body = String(response.body);
  if (otherModuleId && body.includes(otherModuleId)) {
    otherBranchLeaks.add(1);
    fail(`Bootstrap exposed the unassigned branch module ${otherModuleId}`);
  }
  for (const questionId of otherQuestionIds) {
    if (questionId && body.includes(questionId)) {
      otherBranchQuestionLeaks.add(1);
      fail(`Bootstrap exposed a question of the unassigned branch: ${questionId}`);
    }
  }
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
    const deliveredBranches = modules.filter((m) => ['higher_branch', 'lower_branch'].includes(m.adaptiveRole));
    if (deliveredBranches.length > 1) {
      otherBranchLeaks.add(1);
      fail(`Delivery carried both adaptive branches: ${deliveredBranches.map((m) => m.id).join(',')}`);
    }
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
      // Expiry -> branch visible, the release-gate latency.
      branchVisibleMs.add(Date.now() - waveAt);
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

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// One accepted answer write. 409 (stale revision / module already closed) is an
// expected race and is NOT counted; only 200 lands in the "nothing lost"
// ledger below.
//
// `response` is a bare JSON scalar, matching the wire contract
// (`response: string | null`): the scorer reads the legacy column as a string,
// so an object would store successfully and score as incorrect — the answers
// this gate saves have to be the ones the route is computed from.
function saveAnswer(token, examQuestionId, answer) {
  const response = http.patch(
    endpoint(`/responses/${encodeURIComponent(examQuestionId)}`),
    JSON.stringify({
      revision: 0,
      response: String(answer),
      markedForReview: false,
      eliminatedOptions: [],
      annotations: {},
      clientWriteId: uuid(),
    }),
    { headers: headers(token), responseCallback: expected },
  );
  if (response.status >= 500 && response.status !== 503) unexpected5xx.add(1);
  return response.status === 200;
}

// The adaptive branch modules a payload delivers. Exactly one per adaptive
// section is legal; the branch the candidate was NOT routed into must be absent.
function deliveredBranchIds(data) {
  return ((data && data.sections) || [])
    .flatMap((s) => s.modules || [])
    .filter((m) => m.adaptiveRole === 'higher_branch' || m.adaptiveRole === 'lower_branch')
    .map((m) => m.id);
}

// Synchronized timeout capacity (K6_SAVE_LOOP=1). Every candidate keeps
// answering while the module's authoritative window elapses, then waits for the
// server to close it — the 1s worker sweep and the candidate's own lazy
// reconcile both race here. Records expiry -> closed latency, proves the close
// did not drop an answer the server had already accepted, and proves the branch
// the candidate was sent to did not change when the module closed.
//
// What this CANNOT check: whether the branch matches the score of the saved
// answers. The answer key is redacted from every student payload by design, so
// the client has no way to recompute the expected route; that parity lives in
// the server-side integration suite, and here we pin the observable half
// (stable, correct branch identity across the close).
function exerciseTimeoutCapacity(cred, moduleId) {
  const token = cred.token;
  let data = bootstrap(token);
  const delivered = (data.sections || [])
    .flatMap((s) => s.modules || [])
    .find((m) => m.id === moduleId);
  const questions = ((delivered && delivered.questions) || [])
    .map((q) => q.examQuestionId || q.question_id || q.id)
    .filter(Boolean);
  if (questions.length === 0) fail(`Module ${moduleId} delivered no questions to answer`);

  const stopAt = Date.now() + closeWaitSeconds * 1000;
  let accepted = 0;
  let nextQuestion = 0;
  let deadlineAt = null;
  let branchBefore = deliveredBranchIds(data);
  while (Date.now() < stopAt) {
    if (nextQuestion < questions.length && saveAnswer(token, questions[nextQuestion], 'A')) {
      accepted += 1;
      nextQuestion += 1;
    }
    data = bootstrap(token);
    const attempt = (data.attempt?.moduleAttempts || []).find((a) => a.moduleId === moduleId);
    if (!attempt) fail(`Module ${moduleId} vanished from the attempt projection`);
    if (attempt.deadlineAt) deadlineAt = Date.parse(attempt.deadlineAt);

    // Route drift: the delivered branch must not change while the module
    // closes, and it must stay the branch the credential names.
    const branchNow = deliveredBranchIds(data);
    if (branchNow.join(',') !== branchBefore.join(',')) {
      routeDrift.add(1);
      fail(`Delivered branch changed across the close: ${JSON.stringify(branchBefore)} -> ${JSON.stringify(branchNow)}`);
      branchBefore = branchNow;
    }
    if (mode === 'adaptive' && branchNow.length > 0 && !branchNow.includes(cred.expectedModuleId)) {
      routeDrift.add(1);
      fail(`Delivered branch does not match the routing decision: ${JSON.stringify(branchNow)} vs ${cred.expectedModuleId}`);
    }

    if (attempt.state === 'locked' || attempt.state === 'submitted') {
      const stored = (data.attempt?.responses || []).filter((r) =>
        questions.includes(r.examQuestionId)).length;
      if (stored < accepted) {
        lostSaves.add(1);
        fail(`Module close lost accepted answers: ${stored} stored of ${accepted} accepted`);
      }
      if (Number.isFinite(deadlineAt)) timeoutCloseMs.add(Date.now() - deadlineAt);
      return;
    }
    if (savePollMs > 0) sleep(savePollMs / 1000);
  }
  fail(`Module ${moduleId} was not closed ${closeWaitSeconds}s after the save loop started`);
}

export function studentFlow(data) {
  const cred = creds[__VU - 1];
  otherModuleId = mode === 'adaptive' ? cred.otherModuleId : null;
  otherQuestionIds = mode === 'adaptive' ? (cred.otherQuestionIds || []) : [];
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

  // Runs AFTER the entry latency is recorded, so the entry thresholds stay
  // about entry and the timeout-capacity wait cannot pollute them.
  if (saveLoop) exerciseTimeoutCapacity(cred, moduleId);
}
