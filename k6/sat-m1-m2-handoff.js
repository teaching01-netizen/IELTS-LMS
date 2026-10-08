import http from 'k6/http';
import { fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { satAttemptUrl, satBatchRequest, assertSatAcknowledgements, assertSatStoredResponses } from './sat-response-contract.js';

// Use synthetic, preprovisioned attempts on one shared SAT runtime. Each
// credential supplies {attemptId, token, moduleId, moduleAttemptId,
// expectedModuleId, otherModuleId, answers:[{questionId, answer, clientVersion}]}.
// Answers must be the final 1–3 synthetic answers whose expected route is known.
// HTTP receipt is a proxy only: measure the actual answerable frame with the
// browser's sat_first_answerable_frame_at.m2AllotmentDeltaSeconds alongside this run.
const base = __ENV.K6_BASE_URL;
const schedule = __ENV.K6_SCHEDULE_ID;
const vus = Number(__ENV.K6_VUS || 400);
const windowSeconds = Number(__ENV.SAT_PERSONAL_CLOSE_WINDOW_SECS || 15);
const baseline = __ENV.K6_BASELINE === '1';
const delayMs = Number(__ENV.K6_FINAL_SAVE_DELAY_MS || 0);
const credentials = JSON.parse(open(__ENV.K6_ATTEMPT_TOKENS_PATH || './attempt-creds.json'));
if (!base || !schedule || !Number.isInteger(vus) || vus < 1 || credentials.length < vus) {
  throw new Error('Set K6_BASE_URL, K6_SCHEDULE_ID, and K6_ATTEMPT_TOKENS_PATH with one credential per VU');
}
if (new Set(credentials.slice(0, vus).map((c) => c.attemptId)).size !== vus ||
    credentials.slice(0, vus).some((c) => !c.token || !c.moduleId || !c.moduleAttemptId ||
      !c.expectedModuleId || !c.otherModuleId || !Array.isArray(c.answers) ||
      c.answers.length < 1 || c.answers.length > 3 ||
      c.answers.some((a) => !a.questionId || !Number.isSafeInteger(a.clientVersion) || a.clientVersion < 1))) {
  throw new Error('Credentials require distinct attempts, M1/M2 identities, and 1–3 final answers with increasing clientVersion values');
}

const finalAck = new Trend('sat_final_batch_ack_after_deadline_seconds');
const routeObserved = new Trend('sat_route_observed_lag_seconds');
const startTransfer = new Trend('sat_m2_start_response_ms');
const httpDelta = new Trend('sat_m2_http_allotment_delta_seconds');
const rejections = new Counter('sat_m1_boundary_rejections');
const failed = new Counter('sat_handoff_failures');
const duplicates = new Counter('sat_handoff_duplicate_branches');
const leaks = new Counter('sat_handoff_content_leaks');
const lost = new Counter('sat_handoff_lost_final_writes');
const thresholds = {
  sat_handoff_failures: ['count==0'],
  sat_handoff_duplicate_branches: ['count==0'],
  sat_handoff_content_leaks: ['count==0'],
  sat_handoff_lost_final_writes: ['count==0'],
};
if (!baseline) {
  thresholds.sat_m1_boundary_rejections = ['count==0'];
  thresholds.sat_m2_http_allotment_delta_seconds = ['p(99)<=2'];
  thresholds.sat_m2_start_response_ms = ['p(99)<=3000'];
  thresholds.sat_route_observed_lag_seconds = [`p(99)<=${windowSeconds + 2}`];
}
export const options = {
  scenarios: { handoff: { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: '5m' } },
  thresholds,
};
export function setup() {
  const deadline = Number(__ENV.K6_WAVE_AT_MS);
  if (!Number.isFinite(deadline) || deadline <= Date.now() + 5000) {
    throw new Error('K6_WAVE_AT_MS must match the seeded M1 deadlines and be at least 5 seconds ahead');
  }
  return { deadline };
}
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
function waitUntil(time) { if (time > Date.now()) sleep((time - Date.now()) / 1000); }
function body(response) { try { return response.json(); } catch { return null; } }
function delivery(path) { return `${base}/api/v1/assessment-delivery/schedules/${schedule}${path}`; }
function refusal(message) { failed.add(1); fail(message); }

export default function ({ deadline }) {
  // Register zero-valued counters so a run with no defects still exports them.
  for (const metric of [failed, duplicates, leaks, lost, rejections]) metric.add(0);
  const cred = credentials[__VU - 1];
  const params = { headers: { authorization: `Bearer ${cred.token}`, 'content-type': 'application/json', 'accept-encoding': 'gzip' }, timeout: '20s' };
  const snapshotURL = satAttemptUrl(base, cred.attemptId, 'responses');
  let snapshot = body(http.get(snapshotURL, params));
  if (!snapshot) refusal('Could not read the initial response snapshot');
  satBatchRequest(snapshot, []);
  waitUntil(deadline - 500);
  const commands = cred.answers.map((answer) => ({
    questionId: answer.questionId, clientVersion: answer.clientVersion, writeId: answer.writeId || uuid(),
    response: { answer: answer.answer, markedForReview: false, eliminatedOptions: [], annotations: [] },
  }));
  // Delay the final packet, keeping its synthetic click 0.5s before zero.
  waitUntil(deadline - 500 + delayMs);
  const saveURL = satAttemptUrl(base, cred.attemptId, 'responses:batch');
  const saveBody = JSON.stringify(satBatchRequest(snapshot, commands));
  let saved;
  for (let retry = 0; retry < 4; retry += 1) {
    saved = http.post(saveURL, saveBody, params);
    if (![0, 429, 502, 503, 504].includes(saved.status)) break;
    sleep((250 * 2 ** retry + Math.random() * 250) / 1000);
  }
  if (saved.status === 200) {
    const acks = assertSatAcknowledgements(body(saved), commands);
    finalAck.add((Date.now() - deadline) / 1000);
    const replay = assertSatAcknowledgements(body(http.post(saveURL, saveBody, params)), commands);
    const revisions = new Map(acks.map((ack) => [ack.writeId, ack.serverRevision]));
    if (replay.some((ack) => ack.serverRevision !== revisions.get(ack.writeId))) refusal('Save replay changed its committed revision');
  }
  else {
    const error = body(saved)?.error ?? body(saved);
    if (['DEADLINE_EXPIRED', 'ATTEMPT_NOT_WRITABLE'].includes(error?.code)) rejections.add(1);
    if (!baseline || saved.status !== 422 || !['DEADLINE_EXPIRED', 'ATTEMPT_NOT_WRITABLE'].includes(error?.code)) {
      refusal(`Final batch rejected: HTTP ${saved.status}`);
    }
  }
  waitUntil(deadline + 20);
  let close = null;
  if (!baseline) {
    const request = JSON.stringify({ moduleId: cred.moduleId, moduleAttemptId: cred.moduleAttemptId, closeId: uuid(), answers: commands.map(({questionId, writeId, clientVersion}) => ({questionId, writeId, clientVersion})) });
    while (Date.now() < deadline + windowSeconds * 1000 + 2000) {
      const response = http.post(delivery('/modules/close'), request, params);
      if (response.status === 200) { close = body(response); break; }
      if (![409, 429, 503].includes(response.status)) refusal(`Close failed: HTTP ${response.status}`);
      sleep(0.5 + Math.random() * 0.5);
    }
    if (!close) refusal('Module close did not settle within its window');
    // Lost-response replay must retain exactly the same route and module IDs.
    const replay = body(http.post(delivery('/modules/close'), request, params));
    if (!replay || replay.nextModuleId !== close.nextModuleId) refusal('Close replay changed the route');
  }
  let data = close;
  while (!data?.moduleAttempts && Date.now() < deadline + 120000) {
    const response = http.get(delivery('/state'), params);
    const state = body(response);
    const rows = state?.attempt?.moduleAttempts;
    if (rows?.some((m) => m.moduleId === cred.moduleId && ['locked', 'submitted'].includes(m.state))) data = { moduleAttempts: rows };
    else sleep(baseline ? 10 + Math.random() * 10 : 1 + Math.random());
  }
  if (!data) refusal('Module 1 did not close');
  const branches = data.moduleAttempts.filter((m) => [cred.expectedModuleId, cred.otherModuleId].includes(m.moduleId));
  if (branches.length !== 1) { duplicates.add(1); refusal('Expected exactly one M2 attempt'); }
  if (branches[0].moduleId !== cred.expectedModuleId) refusal('Route did not match the final answers');
  routeObserved.add((Date.now() - deadline) / 1000);
  const beforeStart = body(http.post(delivery('/bootstrap'), '{}', params));
  if (!Array.isArray(beforeStart?.sections)) refusal('Could not inspect content before M2 start');
  for (const section of beforeStart?.sections || []) for (const module of section.modules || []) {
    if (module.id === cred.otherModuleId || (branches[0].state === 'not_started' && module.id === cred.expectedModuleId && module.questions?.length)) { leaks.add(1); refusal('Branch content fence failed'); }
  }
  const before = Date.now();
  const started = body(http.post(delivery('/modules/start'), JSON.stringify({ moduleId: cred.expectedModuleId, needContent: true }), params));
  startTransfer.add(Date.now() - before);
  if (!started?.startedAt || !started?.deadlineAt) refusal('M2 did not start');
  // Server time differences capture time already consumed by an active M2
  // on the baseline; adding the full request duration conservatively covers transfer.
  httpDelta.add(Math.max(0, Date.parse(started.serverNow) - Date.parse(started.startedAt)) / 1000 + (Date.now() - before) / 1000);
  snapshot = body(http.get(snapshotURL, params));
  if (!snapshot) refusal('Could not verify final answers');
  if (saved.status === 200) {
    try { assertSatStoredResponses(snapshot, commands); }
    catch (_) { lost.add(1); refusal('An acknowledged final answer was lost or changed'); }
  }
  const m2 = started.selectedSection?.modules?.find((module) => module.id === cred.expectedModuleId);
  if (!m2?.questions?.length) refusal('M2 start omitted selected content');
  const questionId = m2.questions[0].examQuestionId;
  const previousVersion = snapshot.responses.find((response) => response.questionId === questionId)?.clientVersion || 0;
  const nextCommands = [{ questionId, writeId: uuid(), clientVersion: previousVersion + 1,
    response: { answer: cred.m2Answer || 'A', markedForReview: false, eliminatedOptions: [], annotations: [] } }];
  const nextWrite = http.post(saveURL, JSON.stringify(satBatchRequest(snapshot, nextCommands)), params);
  if (nextWrite.status !== 200) refusal(`M2 write blocked after handoff: HTTP ${nextWrite.status}`);
  assertSatAcknowledgements(body(nextWrite), nextCommands);
  assertSatStoredResponses(body(http.get(snapshotURL, params)), nextCommands);
}
