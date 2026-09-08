import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { sha256 } from 'k6/crypto';
import { Counter, Trend } from 'k6/metrics';
import {
  bootstrapStudentSession,
  buildStudentSlice,
  clampInt,
  computeJitterSeconds,
  csrfHeader,
  ensureProdRunAllowed,
  ensureStudentRegistrations,
  getStudentSession,
  jsonHeaders,
  loginControlStaff,
  readJson,
  resolveBaseUrl,
  resolveScheduleId,
  sendHeartbeat,
  sendMutationBatch,
  shouldAutoRegisterStudents,
  submitAttempt,
  uuidV4,
} from './prod-load-helpers.js';

const EXPECT_2XX_OR_409 = http.expectedStatuses({ min: 200, max: 299 }, 409);
const DEBUG = __ENV.K6_DEBUG === 'true';

const submitRequestMs = new Trend('submit_request_ms');
const submitCorrectnessFailures = new Counter('submit_correctness_failures');
const submitMissingData = new Counter('submit_missing_data');

const targetPath = __ENV.K6_TARGET_PATH || '../e2e/prod-data/prod-target.json';
const credsPath = __ENV.K6_CREDS_PATH || '../e2e/prod-data/prod-creds.json';
const target = readJson(targetPath);
const creds = readJson(credsPath);
const baseUrl = resolveBaseUrl(target);
const scheduleId = resolveScheduleId(target);
const runId = __ENV.K6_RUN_ID || `k6-${Date.now()}`;
const { students, studentCount } = buildStudentSlice(target, __ENV.K6_STUDENTS || '200', __ENV.K6_STUDENT_OFFSET || '0');

const waitForCheckedInTimeoutSeconds = clampInt(__ENV.K6_CHECKED_IN_TIMEOUT_SECONDS || '900', 30, 7200);
const liveWaitTimeoutSeconds = clampInt(__ENV.K6_WAIT_FOR_LIVE_TIMEOUT_SECONDS || '1200', 30, 7200);
const workSeconds = clampInt(__ENV.K6_WORK_SECONDS || '20', 5, 1800);
const pollSeconds = Number(__ENV.K6_STUDENT_POLL_SECONDS || '0.5');
const heartbeatEverySeconds = clampInt(__ENV.K6_STUDENT_HEARTBEAT_SECONDS || '5', 3, 120);
const jitterSeconds = clampInt(__ENV.K6_STUDENT_JITTER_MAX_SECONDS || '2', 0, 30);

const realisticMode = __ENV.K6_REALISTIC_MODE === 'true';
const realisticTypeSteps = clampInt(__ENV.K6_REALISTIC_TYPE_STEPS || '8', 2, 30);
const realisticStepPauseMs = clampInt(__ENV.K6_REALISTIC_STEP_PAUSE_MS || '400', 50, 3000);
const maxTargetKeysPerUser = clampInt(__ENV.K6_MAX_TARGET_KEYS_PER_USER || '400', 1, 5000);
const diffDebugRaw = __ENV.K6_DIFF_DEBUG_RAW === 'true';

function progressiveValues(finalValue, steps) {
  const value = String(finalValue || '');
  if (!value) return [''];
  const slices = [];
  const span = Math.max(1, Math.ceil(value.length / steps));
  for (let i = span; i < value.length; i += span) slices.push(value.slice(0, i));
  slices.push(value);
  return slices;
}

function looksLikeRuntimeAlreadyExistsError(resp) {
  if (!resp || resp.status !== 500) return false;
  const body = String(resp.body || '');
  return body.includes('Duplicate entry') && body.includes('exam_session_runtimes.schedule_id');
}

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function canonicalObjective(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    const normalized = [];
    for (const entry of value) {
      if (typeof entry !== 'string') return ['__INVALID_TYPE__'];
      const text = normalizeText(entry);
      if (text) normalized.push(text);
    }
    return normalized;
  }
  if (typeof value === 'string') {
    const text = normalizeText(value);
    return text ? [text] : [];
  }
  return ['__INVALID_TYPE__'];
}

function canonicalWriting(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return normalizeText(value);
  return '__INVALID_TYPE__';
}

function hash12(value) {
  return sha256(JSON.stringify(value), 'hex').slice(0, 12);
}

function findByKeyDeep(root, key) {
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (value === null || value === undefined || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) stack.push(value[i]);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    for (const k of Object.keys(value)) stack.push(value[k]);
  }
  return undefined;
}

function objectiveTargetKey(target) {
  return `${target.questionId}#${target.slotIndex === undefined ? 'scalar' : String(target.slotIndex)}`;
}

function collectObjectiveTargets(contentSnapshot) {
  const targets = [];
  const blocks = [];
  const readingPassages = (((contentSnapshot || {}).reading || {}).passages || []);
  const listeningParts = (((contentSnapshot || {}).listening || {}).parts || []);
  for (const passage of Array.isArray(readingPassages) ? readingPassages : []) {
    const passageBlocks = Array.isArray(passage && passage.blocks) ? passage.blocks : [];
    blocks.push(...passageBlocks);
  }
  for (const part of Array.isArray(listeningParts) ? listeningParts : []) {
    const partBlocks = Array.isArray(part && part.blocks) ? part.blocks : [];
    blocks.push(...partBlocks);
  }

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const type = String(block.type || '');
    const blockId = typeof block.id === 'string' ? block.id : '';
    const questions = Array.isArray(block.questions) ? block.questions : [];

    if (type === 'TFNG' || type === 'CLOZE' || type === 'MATCHING' || type === 'MAP' || type === 'SHORT_ANSWER') {
      for (const q of questions) {
        if (q && typeof q.id === 'string' && q.id.trim()) targets.push({ questionId: q.id });
      }
      continue;
    }

    if (type === 'SENTENCE_COMPLETION' || type === 'NOTE_COMPLETION') {
      for (const q of questions) {
        if (!q || typeof q.id !== 'string' || !q.id.trim()) continue;
        const blanks = Array.isArray(q.blanks) ? q.blanks : [];
        for (let i = 0; i < blanks.length; i += 1) {
          targets.push({ questionId: q.id, slotIndex: i });
        }
      }
      continue;
    }

    if (type === 'SINGLE_MCQ') {
      if (questions.length > 0) {
        for (const q of questions) {
          if (q && typeof q.id === 'string' && q.id.trim()) targets.push({ questionId: q.id });
        }
      } else if (blockId) {
        targets.push({ questionId: blockId });
      }
      continue;
    }

    if (type === 'MULTI_MCQ') {
      if (blockId) targets.push({ questionId: blockId });
      continue;
    }

    if (type === 'DIAGRAM_LABELING') {
      const labels = Array.isArray(block.labels) ? block.labels : [];
      for (let i = 0; i < labels.length; i += 1) targets.push({ questionId: blockId, slotIndex: i });
      continue;
    }

    if (type === 'FLOW_CHART') {
      const steps = Array.isArray(block.steps) ? block.steps : [];
      for (let i = 0; i < steps.length; i += 1) targets.push({ questionId: blockId, slotIndex: i });
      continue;
    }

    if (type === 'TABLE_COMPLETION') {
      const cells = Array.isArray(block.cells) ? block.cells : [];
      for (let i = 0; i < cells.length; i += 1) targets.push({ questionId: blockId, slotIndex: i });
      continue;
    }

    if (type === 'CLASSIFICATION') {
      const items = Array.isArray(block.items) ? block.items : [];
      for (let i = 0; i < items.length; i += 1) targets.push({ questionId: blockId, slotIndex: i });
      continue;
    }

    if (type === 'MATCHING_FEATURES') {
      const features = Array.isArray(block.features) ? block.features : [];
      for (let i = 0; i < features.length; i += 1) targets.push({ questionId: blockId, slotIndex: i });
      continue;
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const target of targets) {
    if (!target.questionId) continue;
    const key = objectiveTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

function collectWritingTargets(contentSnapshot) {
  const tasks = (((contentSnapshot || {}).writing || {}).tasks || []);
  const targets = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const taskId = task && typeof task.taskId === 'string' ? task.taskId : '';
    if (taskId.trim()) targets.push(taskId);
  }
  return targets;
}

function buildExpectedAnswerMaps(localRunId, student, objectiveTargets, writingIds) {
  const expectedObjective = {};
  const expectedWriting = {};
  for (let i = 0; i < objectiveTargets.length; i += 1) {
    const target = objectiveTargets[i];
    expectedObjective[objectiveTargetKey(target)] = `k6 ${localRunId} ${student.wcode} objective ${i + 1}`;
  }
  for (let i = 0; i < writingIds.length; i += 1) {
    expectedWriting[writingIds[i]] = `k6 ${localRunId} ${student.wcode} writing ${i + 1}`;
  }
  return { expectedObjective, expectedWriting };
}

function buildMutationBatch(stepIndex, stepCount, objectiveTargets, writingIds, expectedObjective, expectedWriting) {
  const mutations = [];
  mutations.push({
    id: uuidV4(),
    seq: stepIndex * 100000 + 1,
    timestamp: new Date().toISOString(),
    mutationType: 'position',
    payload: {
      phase: 'exam',
      currentModule: 'listening',
      currentQuestionId: objectiveTargets[0] ? objectiveTargets[0].questionId : null,
    },
  });

  for (let i = 0; i < objectiveTargets.length; i += 1) {
    const target = objectiveTargets[i];
    const questionId = target.questionId;
    const finalValue = expectedObjective[objectiveTargetKey(target)];
    const value = realisticMode
      ? progressiveValues(finalValue, stepCount)[Math.min(stepIndex, stepCount - 1)]
      : finalValue;
    mutations.push({
      id: uuidV4(),
      seq: stepIndex * 100000 + 2 + i,
      timestamp: new Date().toISOString(),
      mutationType: 'answer',
      payload:
        target.slotIndex === undefined
          ? { questionId, value }
          : { questionId, slotIndex: target.slotIndex, value },
    });
  }

  const writingSeqBase = stepIndex * 100000 + 2 + objectiveTargets.length;
  for (let i = 0; i < writingIds.length; i += 1) {
    const taskId = writingIds[i];
    const finalValue = expectedWriting[taskId];
    const value = realisticMode
      ? progressiveValues(finalValue, stepCount)[Math.min(stepIndex, stepCount - 1)]
      : finalValue;
    mutations.push({
      id: uuidV4(),
      seq: writingSeqBase + i,
      timestamp: new Date().toISOString(),
      mutationType: 'writing_answer',
      payload: { taskId, value },
    });
  }

  return mutations;
}

function collectMismatches(attempt, objectiveTargets, expectedObjective, writingTargets, expectedWriting) {
  const mismatches = [];
  const answers = attempt && typeof attempt.answers === 'object' ? attempt.answers : {};
  const writingAnswers = attempt && typeof attempt.writingAnswers === 'object' ? attempt.writingAnswers : {};

  for (let i = 0; i < objectiveTargets.length; i += 1) {
    const target = objectiveTargets[i];
    const key = objectiveTargetKey(target);
    const expectedText = expectedObjective[key];
    const expected = target.slotIndex === undefined ? [normalizeText(expectedText)] : normalizeText(expectedText);
    const rootValue = Object.prototype.hasOwnProperty.call(answers, target.questionId)
      ? answers[target.questionId]
      : undefined;
    const fallbackRoot = rootValue === undefined ? findByKeyDeep(attempt, target.questionId) : undefined;
    const value = rootValue !== undefined ? rootValue : fallbackRoot;
    const source = rootValue !== undefined ? 'attempt.answers' : fallbackRoot !== undefined ? 'fallback.deep-search' : 'missing';
    const actual = target.slotIndex === undefined
      ? canonicalObjective(value)
      : canonicalWriting(Array.isArray(value) ? value[target.slotIndex] : undefined);
    const equal = JSON.stringify(actual) === JSON.stringify(expected);
    if (!equal) {
      mismatches.push({
        kind: 'objective',
        key: target.questionId,
        slotIndex: target.slotIndex,
        source,
        expectedHash: hash12(expected),
        actualHash: hash12(actual),
        ...(diffDebugRaw ? { expectedRaw: expected, actualRaw: actual } : {}),
      });
    }
  }

  for (let i = 0; i < writingTargets.length; i += 1) {
    const key = writingTargets[i];
    const expected = canonicalWriting(expectedWriting[key]);
    const direct = Object.prototype.hasOwnProperty.call(writingAnswers, key) ? writingAnswers[key] : undefined;
    const fallback = direct === undefined ? findByKeyDeep(attempt, key) : undefined;
    const source = direct !== undefined ? 'attempt.writingAnswers' : fallback !== undefined ? 'fallback.deep-search' : 'missing';
    const actual = canonicalWriting(direct !== undefined ? direct : fallback);
    if (actual !== expected) {
      mismatches.push({
        kind: 'writing',
        key,
        source,
        expectedHash: hash12(expected),
        actualHash: hash12(actual),
        ...(diffDebugRaw ? { expectedRaw: expected, actualRaw: actual } : {}),
      });
    }
  }
  return mismatches;
}

export const options = {
  scenarios: {
    control: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'controlFlow',
      maxDuration: '30m',
    },
    students: {
      executor: 'per-vu-iterations',
      vus: studentCount,
      iterations: 1,
      exec: 'studentFlow',
      maxDuration: '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    submit_request_ms: ['p(95)<2000', 'max<10000'],
    submit_correctness_failures: ['count==0'],
    submit_missing_data: ['count==0'],
  },
};

export function setup() {
  ensureProdRunAllowed();
  if (shouldAutoRegisterStudents()) {
    ensureStudentRegistrations(baseUrl, scheduleId, creds, students, true);
  }
  return {
    baseUrl,
    scheduleId,
    runId,
    students,
    studentCount,
  };
}

export function controlFlow(data) {
  const { jar, selectedStaffEmail } = loginControlStaff(data.baseUrl, data.scheduleId, creds, true);
  if (DEBUG) console.log(`[control] staff=${selectedStaffEmail || 'unknown'} scheduleId=${data.scheduleId} runId=${data.runId}`);

  const joinResp = http.post(
    `${data.baseUrl}/api/v1/proctor/sessions/${data.scheduleId}/presence`,
    JSON.stringify({ action: 'join' }),
    {
      jar,
      headers: jsonHeaders(csrfHeader(jar, data.baseUrl)),
      tags: { name: 'proctor_presence_join' },
    },
  );
  check(joinResp, { 'proctor presence join 200': (r) => r.status === 200 }) ||
    fail(`Presence join failed: status=${joinResp.status} body=${joinResp.body.slice(0, 200)}`);

  const threshold = clampInt(__ENV.K6_CHECKED_IN_THRESHOLD || `${data.studentCount}`, 0, data.studentCount);
  const expectedEmails = new Set(data.students.map((s) => s.email));
  const checkedInStartedAt = Date.now();
  while (Date.now() - checkedInStartedAt < waitForCheckedInTimeoutSeconds * 1000) {
    const detail = http.get(`${data.baseUrl}/api/v1/proctor/sessions/${data.scheduleId}`, {
      jar,
      headers: jsonHeaders(csrfHeader(jar, data.baseUrl)),
      tags: { name: 'proctor_session_detail' },
    });
    if (detail.status !== 200) {
      sleep(2);
      continue;
    }
    const json = detail.json();
    const sessions = ((json || {}).data || {}).sessions || [];
    const matched = Array.isArray(sessions) ? sessions.filter((s) => expectedEmails.has(String(s.studentEmail || ''))) : [];
    if (matched.length >= threshold) break;
    sleep(2);
  }

  const preRuntime = http.get(`${data.baseUrl}/api/v1/schedules/${data.scheduleId}/runtime`, {
    jar,
    headers: jsonHeaders(csrfHeader(jar, data.baseUrl)),
    tags: { name: 'runtime_snapshot_pre_start' },
  });
  let preStatus = '';
  if (preRuntime.status === 200) {
    try {
      preStatus = ((((preRuntime.json() || {}).data || {}).status || '').toString());
    } catch (_) {}
  }

  if (preStatus !== 'live') {
    const startResp = http.post(
      `${data.baseUrl}/api/v1/schedules/${data.scheduleId}/runtime/commands`,
      JSON.stringify({ action: 'start_runtime', reason: `k6 ${data.runId}` }),
      {
        jar,
        headers: jsonHeaders(csrfHeader(jar, data.baseUrl)),
        responseCallback: EXPECT_2XX_OR_409,
        tags: { name: 'start_runtime' },
      },
    );
    const startOk = startResp.status === 200 || startResp.status === 409 || looksLikeRuntimeAlreadyExistsError(startResp);
    check(startResp, { 'start runtime ok': () => startOk }) ||
      fail(`Start runtime failed: status=${startResp.status} body=${startResp.body.slice(0, 200)}`);
  }

  const liveStartedAt = Date.now();
  while (Date.now() - liveStartedAt < liveWaitTimeoutSeconds * 1000) {
    const runtime = http.get(`${data.baseUrl}/api/v1/schedules/${data.scheduleId}/runtime`, {
      jar,
      headers: jsonHeaders(csrfHeader(jar, data.baseUrl)),
      tags: { name: 'runtime_snapshot' },
    });
    if (runtime.status !== 200) {
      sleep(2);
      continue;
    }
    const json = runtime.json();
    const status = (((json || {}).data || {}).status || '').toString();
    if (status === 'live') return;
    if (status === 'completed' || status === 'cancelled') {
      fail(`Schedule runtime is already ${status}; use a fresh schedule for the submit storm test.`);
    }
    sleep(2);
  }
}

export function studentFlow(data) {
  const student = data.students[(__VU - 1) % data.students.length];
  const jar = http.cookieJar();
  const clientSessionId = uuidV4();
  const jitter = computeJitterSeconds(runId, student.wcode, jitterSeconds);
  sleep(jitter);

  const bootstrap = bootstrapStudentSession(data.baseUrl, data.scheduleId, student, jar, clientSessionId);
  let attemptToken = bootstrap.attemptToken;
  const attemptId = bootstrap.attemptId;
  const contentSnapshot = bootstrap.contentSnapshot;

  const objectiveTargets = collectObjectiveTargets(contentSnapshot);
  const writingTargets = collectWritingTargets(contentSnapshot);
  const totalTargets = objectiveTargets.length + writingTargets.length;

  if (totalTargets === 0) {
    submitMissingData.add(1);
    fail(`No answer targets found for ${student.wcode}; cannot run strict verification.`);
  }
  if (totalTargets > maxTargetKeysPerUser) {
    submitMissingData.add(1);
    fail(`Target key count ${totalTargets} exceeds K6_MAX_TARGET_KEYS_PER_USER=${maxTargetKeysPerUser} for ${student.wcode}.`);
  }

  const { expectedObjective, expectedWriting } = buildExpectedAnswerMaps(runId, student, objectiveTargets, writingTargets);

  const liveWait = (() => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < liveWaitTimeoutSeconds * 1000) {
      const sessionResp = getStudentSession(data.baseUrl, data.scheduleId, jar, '', { name: 'student_session_wait' });
      if (sessionResp.status !== 200) {
        sleep(pollSeconds);
        continue;
      }
      const json = sessionResp.json();
      const session = (json && json.data) || {};
      const runtime = session.runtime || {};
      if (runtime.status === 'live') return { session, runtime };
      if (runtime.status === 'completed' || runtime.status === 'cancelled') {
        fail(`Runtime is already ${runtime.status} for student ${student.wcode}; use a fresh live schedule.`);
      }
      sleep(pollSeconds);
    }
    fail(`Timed out waiting for live runtime for student ${student.wcode}`);
  })();
  void liveWait;

  const stepCount = realisticMode ? realisticTypeSteps : 1;
  const workStartedAt = Date.now();
  let lastHeartbeatAt = Date.now();

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    const payloads = buildMutationBatch(stepIndex, stepCount, objectiveTargets, writingTargets, expectedObjective, expectedWriting);
    const mutationResp = sendMutationBatch(
      data.baseUrl,
      data.scheduleId,
      jar,
      attemptId,
      attemptToken,
      clientSessionId,
      payloads,
      { name: realisticMode ? 'mutations_typing_batch' : 'mutations_batch' },
    );
    check(mutationResp, { 'typing mutation batch 200/409 ok': (r) => r.status === 200 || r.status === 409 }) ||
      fail(`Mutation batch failed (${student.wcode}): status=${mutationResp.status} body=${String(mutationResp.body || '').slice(0, 200)}`);

    if (mutationResp.status === 200) {
      try {
        const json = mutationResp.json();
        const refreshed = (((json || {}).data || {}).refreshedAttemptCredential || {}).attemptToken;
        if (refreshed) attemptToken = refreshed;
      } catch (_) {}
    }

    const now = Date.now();
    if (now - lastHeartbeatAt > heartbeatEverySeconds * 1000) {
      lastHeartbeatAt = now;
      const hbResp = sendHeartbeat(
        data.baseUrl,
        data.scheduleId,
        jar,
        attemptId,
        attemptToken,
        clientSessionId,
        { name: 'heartbeat' },
      );
      check(hbResp, { 'heartbeat 200': (r) => r.status === 200 }) || fail(`Heartbeat failed for ${student.wcode}`);
      if (hbResp.status === 200) {
        try {
          const json = hbResp.json();
          const refreshed = (((json || {}).data || {}).refreshedAttemptCredential || {}).attemptToken;
          if (refreshed) attemptToken = refreshed;
        } catch (_) {}
      }
    }

    if (realisticMode) sleep(realisticStepPauseMs / 1000);
  }

  while (Date.now() - workStartedAt < workSeconds * 1000) {
    sleep(0.5);
  }

  const submitResp = submitAttempt(data.baseUrl, data.scheduleId, jar, attemptId, attemptToken, { name: 'submit' });
  submitRequestMs.add(submitResp.timings.duration);
  check(submitResp, { 'submit 200/409 ok': (r) => r.status === 200 || r.status === 409 }) ||
    fail(`Submit failed (${student.wcode}): status=${submitResp.status} body=${String(submitResp.body || '').slice(0, 200)}`);

  const verify = (() => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 180 * 1000) {
      const sessionResp = getStudentSession(data.baseUrl, data.scheduleId, jar, '', { name: 'student_session_verify' });
      if (sessionResp.status !== 200) {
        sleep(1);
        continue;
      }
      const json = sessionResp.json();
      const session = (json && json.data) || {};
      const attempt = session.attempt || {};
      if (attempt.submittedAt) return { session, attempt };
      sleep(1);
    }
    fail(`Timed out waiting for submittedAt for student ${student.wcode}`);
  })();

  const attempt = verify.attempt || {};
  const finalSubmissionOk = Boolean(attempt.finalSubmission);
  if (!finalSubmissionOk) {
    submitCorrectnessFailures.add(1);
    fail(`Final submission flag missing for ${student.wcode}`);
  }

  const verifyStartedAt = Date.now();
  let mismatches = collectMismatches(attempt, objectiveTargets, expectedObjective, writingTargets, expectedWriting);
  while (mismatches.length > 0 && Date.now() - verifyStartedAt < 10_000) {
    sleep(1);
    const sessionResp = getStudentSession(data.baseUrl, data.scheduleId, jar, '', { name: 'student_session_verify_retry' });
    if (sessionResp.status !== 200) continue;
    const json = sessionResp.json();
    const refreshedAttempt = ((json && json.data) || {}).attempt || {};
    mismatches = collectMismatches(refreshedAttempt, objectiveTargets, expectedObjective, writingTargets, expectedWriting);
  }
  if (mismatches.length > 0) {
    submitCorrectnessFailures.add(1);
    fail(
      JSON.stringify({
        type: 'ANSWER_MISMATCH',
        runId,
        student: student.wcode,
        mismatchCount: mismatches.length,
        mismatches,
      }),
    );
  }

  if (DEBUG) {
    console.log(
      JSON.stringify({
        type: 'STRICT_VERIFY_OK',
        runId,
        student: student.wcode,
        objectiveCount: objectiveTargets.length,
        writingCount: writingTargets.length,
      }),
    );
  }
}

export function handleSummary(data) {
  const payload = {
    runId,
    strictAllKeys: true,
    objectiveMode: 'choice',
    maxTargetKeysPerUser,
    diffDebugRaw,
    metrics: {
      http_req_failed: data.metrics.http_req_failed ? data.metrics.http_req_failed.values : null,
      submit_correctness_failures: data.metrics.submit_correctness_failures
        ? data.metrics.submit_correctness_failures.values
        : null,
      submit_missing_data: data.metrics.submit_missing_data ? data.metrics.submit_missing_data.values : null,
      submit_request_ms: data.metrics.submit_request_ms ? data.metrics.submit_request_ms.values : null,
    },
  };

  const text = JSON.stringify(payload, null, 2);
  return {
    stdout: `${text}\n`,
    [`e2e/.generated/live-runner/answer-diff-${runId}.json`]: `${text}\n`,
  };
}
