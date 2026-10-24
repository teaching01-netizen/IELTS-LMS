import http from "k6/http";
import { check, fail, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  bootstrapStudentSession,
  buildStudentSlice,
  clampInt,
  csrfHeader,
  jsonHeaders,
  loginControlStaff,
  readJson,
  resolveBaseUrl,
  resolveScheduleId,
  uuidV4,
} from "./prod-load-helpers.js";

const target = readJson(
  __ENV.K6_TARGET_PATH || "../e2e/.generated/ielts-personal-load-target.json"
);
const creds = readJson(__ENV.K6_CREDS_PATH || "../e2e/.generated/ielts-personal-load-creds.json");
const baseUrl = resolveBaseUrl(target);
const scheduleId = resolveScheduleId(target);
const { students, studentCount } = buildStudentSlice(target, __ENV.K6_STUDENTS || "500", "0");
const delayedWcode = __ENV.K6_DELAYED_WCODE || target.delayedWcode || students[0]?.wcode;
const delayedSeconds = clampInt(__ENV.K6_DELAYED_SECONDS || "30", 1, 120);
const pollSeconds = Number(__ENV.K6_STUDENT_POLL_SECONDS || "5");
const liveWaitSeconds = clampInt(__ENV.K6_WAIT_FOR_LIVE_SECONDS || "120", 10, 600);

const readyLatencyMs = new Trend("ielts_personal_ready_latency_ms");
const transitionLatencyMs = new Trend("ielts_personal_transition_latency_ms");
const submitLatencyMs = new Trend("ielts_personal_submit_latency_ms");
const readySuccess = new Rate("ielts_personal_ready_success");
const readyFailures = new Counter("ielts_personal_ready_failures");
const transitionFailures = new Counter("ielts_personal_transition_failures");
const reconnectSuccess = new Rate("ielts_personal_reconnect_success");
const submitSuccess = new Rate("ielts_personal_submission_success");
const submitFailures = new Counter("ielts_personal_submission_failures");
const loadHttpFailures = new Counter("ielts_load_http_failures");
const loadHttpFailureRate = new Rate("ielts_load_http_failure_rate");
const loadFlowFailures = new Counter("ielts_load_flow_failures");

function recordHttpFailure(phase, response) {
  const failed = response.status < 200 || response.status >= 400;
  loadHttpFailureRate.add(failed);
  if (failed) {
    loadHttpFailures.add(1, { phase, status: String(response.status) });
  }
}

function jsonOrEmpty(response) {
  try {
    return response.json() || {};
  } catch (_) {
    return {};
  }
}

function isTransientHttpFailure(status) {
  return status === 0 || [429, 500, 502, 503, 504].includes(status);
}

function transientRetryDelay(response, retryIndex) {
  const details = jsonOrEmpty(response).details || {};
  const retryAfterSeconds = Number(details.retryAfterSeconds || 0);
  const backoffSeconds = Math.min(0.25 * 2 ** retryIndex, 2);
  return Math.max(retryAfterSeconds, backoffSeconds) + Math.random() * 0.25;
}

function refreshStudentSession(data, jar, clientSessionId) {
  const url = `${data.baseUrl}/api/v1/student/sessions/${data.scheduleId}?refreshAttemptCredential=true&clientSessionId=${encodeURIComponent(clientSessionId)}`;
  let response;
  for (let retryIndex = 0; retryIndex <= 3; retryIndex += 1) {
    response = http.get(url, {
      jar,
      headers: jsonHeaders(),
      responseCallback: http.expectedStatuses(200, 429, 500, 502, 503, 504),
      tags: { name: "ielts_personal_reconnect" },
    });
    recordHttpFailure("personal-reconnect", response);
    if (response.status === 200 || !isTransientHttpFailure(response.status) || retryIndex === 3) {
      return response;
    }
    sleep(transientRetryDelay(response, retryIndex));
  }
  return response;
}

function readySection(data, sectionKey, attemptId, clientSessionId, attemptToken, jar) {
  const url = `${data.baseUrl}/api/v1/student/sessions/${data.scheduleId}/sections/${encodeURIComponent(sectionKey)}/ready`;
  const body = JSON.stringify({
    attemptId,
    clientSessionId,
    roundTripMs: 5,
    contentReady: true,
    localStorageReady: true,
    audioReady: sectionKey === "listening",
  });
  const params = {
    jar,
    headers: jsonHeaders(
      Object.assign({}, csrfHeader(jar, data.baseUrl), { authorization: `Bearer ${attemptToken}` })
    ),
    responseCallback: http.expectedStatuses(200, 409, 429, 502, 503, 504),
    tags: { name: `ielts_personal_${sectionKey}_ready` },
  };
  const startedAt = Date.now();
  const readyDeadline = Date.now() + 120_000;
  let lastResponse;
  let lastView = {};
  let lastFailure = "";

  while (Date.now() < readyDeadline) {
    lastResponse = http.post(url, body, params);
    recordHttpFailure(`personal-${sectionKey}-ready`, lastResponse);
    const payload = jsonOrEmpty(lastResponse);
    lastView = payload.data || {};
    if (
      lastResponse.status === 200 &&
      lastView.status === "active" &&
      lastView.startedAt &&
      lastView.deadlineAt
    ) {
      return { view: lastView, latencyMs: Date.now() - startedAt };
    }
    if (
      lastResponse.status === 200 &&
      (lastView.status === "unable" || lastView.status === "completed")
    ) {
      lastFailure = `status=${lastResponse.status} body=${String(lastResponse.body).slice(0, 240)}`;
      break;
    }
    if (lastResponse.status !== 200) {
      if ([429, 502, 503, 504, 0].includes(lastResponse.status)) {
        sleep(0.5 + Math.random() * 0.5);
        continue;
      }
      lastFailure = `status=${lastResponse.status} body=${String(lastResponse.body).slice(0, 240)}`;
      break;
    }

    const untilExpectedSeconds =
      lastView.expectedStartAt && lastView.serverNow
        ? (Date.parse(lastView.expectedStartAt) - Date.parse(lastView.serverNow)) / 1000
        : pollSeconds;
    sleep(
      Math.max(
        0.5,
        Math.min(pollSeconds, untilExpectedSeconds > 0 ? untilExpectedSeconds : pollSeconds)
      )
    );
  }

  throw new Error(
    `IELTS ${sectionKey} readiness failed: ${lastFailure || `status=${lastResponse?.status} body=${String(lastResponse?.body).slice(0, 240)}`}`
  );
}

function waitForSectionDeadline(view) {
  const deadlineMs = Date.parse(view.deadlineAt || "");
  if (!Number.isFinite(deadlineMs))
    fail("IELTS timeline did not include a valid section deadline.");
  const serverNowMs = Date.parse(view.serverNow || "");
  const serverOffsetMs = Number.isFinite(serverNowMs) ? serverNowMs - Date.now() : 0;
  const remainingMs = deadlineMs - (Date.now() + serverOffsetMs);
  if (remainingMs > 0) sleep((remainingMs + 1000) / 1000);
  else sleep(1);
}

function saveIELTSAnswer(data, attemptId, attemptToken, jar, questionId, answer, phase) {
  const writeId = uuidV4();
  const snapshotUrl = `${data.baseUrl}/api/v2/student/attempts/${attemptId}/responses`;
  const batchUrl = `${data.baseUrl}/api/v2/student/attempts/${attemptId}/responses:batch`;
  const startedAt = Date.now();

  for (let retry = 0; retry < 5; retry += 1) {
    const snapshotResponse = http.get(snapshotUrl, {
      jar,
      headers: jsonHeaders({ authorization: `Bearer ${attemptToken}` }),
      responseCallback: http.expectedStatuses(200, 429, 502, 503, 504),
      tags: { name: `ielts_${phase}_response_snapshot` },
    });
    recordHttpFailure(`${phase}-response-snapshot`, snapshotResponse);
    if (snapshotResponse.status !== 200) {
      if ([429, 502, 503, 504, 0].includes(snapshotResponse.status)) {
        sleep(Math.min(2, 0.25 * 2 ** retry) + Math.random() * 0.25);
        continue;
      }
      fail(
        `IELTS ${phase} response snapshot failed for ${attemptId}: ${snapshotResponse.status} ${String(snapshotResponse.body).slice(0, 200)}`
      );
    }

    const snapshot = jsonOrEmpty(snapshotResponse);
    const existing = (snapshot.responses || []).find((row) => row.questionId === questionId);
    const command = {
      writeId,
      questionId,
      clientVersion: Number(existing?.clientVersion || 0) + 1,
      response: {
        answer,
        markedForReview: false,
        eliminatedOptions: [],
        annotations: [],
      },
    };
    const response = http.post(
      batchUrl,
      JSON.stringify({
        leaseEpoch: Number(snapshot.leaseEpoch || 1),
        controlEpoch: Number(snapshot.controlEpoch || 1),
        commands: [command],
      }),
      {
        jar,
        headers: jsonHeaders(
          Object.assign({}, csrfHeader(jar, data.baseUrl), {
            authorization: `Bearer ${attemptToken}`,
          })
        ),
        responseCallback: http.expectedStatuses(200, 409, 429, 502, 503, 504),
        tags: { name: `ielts_${phase}_response_save` },
      }
    );
    recordHttpFailure(`${phase}-response-save`, response);
    if (response.status === 200) {
      const result = jsonOrEmpty(response);
      const acknowledgements = result.acknowledgements || result.data?.acknowledgements || [];
      const accepted =
        acknowledgements.length === 1 &&
        acknowledgements[0].writeId === writeId &&
        ["applied", "duplicate"].includes(acknowledgements[0].outcome);
      if (!accepted) {
        loadFlowFailures.add(1, { phase: `${phase}-response-ack` });
        fail(
          `IELTS ${phase} answer did not receive its exact server acknowledgement for ${attemptId}.`
        );
      }
      return Date.now() - startedAt;
    }

    const errorPayload = jsonOrEmpty(response);
    const error = errorPayload.error || errorPayload;
    if (response.status === 409 && error.code === "CONTROL_EPOCH_STALE") {
      sleep(0.1 + Math.random() * 0.2);
      continue;
    }
    if ([429, 502, 503, 504, 0].includes(response.status)) {
      sleep(Math.min(2, 0.25 * 2 ** retry) + Math.random() * 0.25);
      continue;
    }
    loadFlowFailures.add(1, { phase: `${phase}-response-save` });
    fail(
      `IELTS ${phase} answer was rejected for ${attemptId}: ${response.status} ${String(response.body).slice(0, 240)}`
    );
  }

  loadFlowFailures.add(1, { phase: `${phase}-response-retry` });
  fail(`IELTS ${phase} answer did not settle after bounded retries for ${attemptId}.`);
}

function submitIELTSAttempt(data, attemptId, attemptToken, jar) {
  const snapshotUrl = `${data.baseUrl}/api/v2/student/attempts/${attemptId}/responses`;
  const submitUrl = `${data.baseUrl}/api/v2/student/attempts/${attemptId}/submit`;
  const snapshotResponse = http.get(snapshotUrl, {
    jar,
    headers: jsonHeaders({ authorization: `Bearer ${attemptToken}` }),
    responseCallback: http.expectedStatuses(200),
    tags: { name: "ielts_submit_response_snapshot" },
  });
  recordHttpFailure("submit-response-snapshot", snapshotResponse);
  if (snapshotResponse.status !== 200)
    fail(`IELTS submit snapshot failed: ${snapshotResponse.status}`);

  const snapshot = jsonOrEmpty(snapshotResponse);
  const request = {
    submissionId: uuidV4(),
    leaseEpoch: Number(snapshot.leaseEpoch || 1),
    controlEpoch: Number(snapshot.controlEpoch || 1),
    expectedAttemptRevision: Number(snapshot.attemptRevision || 0),
    finalCommands: [],
  };
  const startedAt = Date.now();
  const submitted = http.post(submitUrl, JSON.stringify(request), {
    jar,
    headers: jsonHeaders(
      Object.assign({}, csrfHeader(jar, data.baseUrl), {
        authorization: `Bearer ${attemptToken}`,
      })
    ),
    responseCallback: http.expectedStatuses(200, 409, 429, 502, 503, 504),
    tags: { name: "ielts_personal_final_submit" },
  });
  recordHttpFailure("personal-final-submit", submitted);
  const accepted = submitted.status === 200;
  submitSuccess.add(accepted);
  if (!accepted) {
    submitFailures.add(1);
    loadFlowFailures.add(1, { phase: "final-submit" });
    fail(
      `IELTS final submission failed for ${attemptId}: ${submitted.status} ${String(submitted.body).slice(0, 240)}`
    );
  }

  // Replay the exact identity and payload to verify that retries return the
  // committed receipt instead of creating a second submission.
  const replay = http.post(submitUrl, JSON.stringify(request), {
    jar,
    headers: jsonHeaders(
      Object.assign({}, csrfHeader(jar, data.baseUrl), {
        authorization: `Bearer ${attemptToken}`,
      })
    ),
    responseCallback: http.expectedStatuses(200, 409),
    tags: { name: "ielts_personal_final_submit_replay" },
  });
  recordHttpFailure("personal-final-submit-replay", replay);
  const replayed = replay.status === 200;
  submitSuccess.add(replayed);
  if (!replayed) {
    submitFailures.add(1);
    loadFlowFailures.add(1, { phase: "final-submit-replay" });
    fail(
      `IELTS final submission replay failed for ${attemptId}: ${replay.status} ${String(replay.body).slice(0, 240)}`
    );
  }
  submitLatencyMs.add(Date.now() - startedAt);
}

export const options = {
  scenarios: {
    control: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      exec: "controlFlow",
      maxDuration: "10m",
    },
    students: {
      executor: "per-vu-iterations",
      vus: studentCount,
      iterations: 1,
      exec: "studentFlow",
      maxDuration: "10m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    ielts_load_flow_failures: ["count==0"],
    ielts_load_http_failure_rate: ["rate<0.03"],
    ielts_personal_ready_failures: ["count==0"],
    ielts_personal_ready_success: ["rate==1"],
    ielts_personal_ready_latency_ms: ["p(95)<10000"],
    ielts_personal_transition_failures: ["count==0"],
    ielts_personal_transition_latency_ms: ["p(95)<20000"],
    ielts_personal_reconnect_success: ["rate==1"],
    ielts_personal_submission_failures: ["count==0"],
    ielts_personal_submission_success: ["rate==1"],
    ielts_personal_submit_latency_ms: ["p(95)<15000"],
  },
};

export function setup() {
  const localHost = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    baseUrl
  );
  if (!localHost) {
    throw new Error(`IELTS local load test refuses non-local host ${baseUrl}.`);
  }
  if (students.length !== 500) {
    throw new Error(`IELTS load test requires 500 students; received ${students.length}.`);
  }
  return {
    baseUrl,
    scheduleId,
    students,
    studentCount,
    delayedWcode,
    delayedSeconds,
    admissionJitterSeconds: Number(target.admissionJitterSeconds || 0),
    liveWaitSeconds,
    pollSeconds,
    runtimeReadyDelaySeconds: Number(target.runtimeReadyDelaySeconds || 0),
    readinessJitterSeconds: Number(target.readinessJitterSeconds || 0),
    listeningQuestionId: target.listeningQuestionId || "listening-q1",
    readingQuestionId: target.readingQuestionId || "reading-q1",
    writingTaskId: target.writingTaskId || "task1",
    sectionSeconds: Number(target.sectionSeconds || 60),
  };
}

export function controlFlow(data) {
  const { jar } = loginControlStaff(data.baseUrl, data.scheduleId, creds, true);
  const expectedEmails = new Set(data.students.map((student) => student.email.toLowerCase()));
  const rosterDeadline = Date.now() + data.liveWaitSeconds * 1000;
  let matched = 0;
  while (Date.now() < rosterDeadline) {
    const response = http.get(`${data.baseUrl}/api/v1/proctor/sessions/${data.scheduleId}`, {
      jar,
      headers: jsonHeaders(csrfHeader(jar, data.baseUrl)),
      tags: { name: "ielts_load_roster" },
    });
    recordHttpFailure("proctor-roster", response);
    if (response.status === 200) {
      const roster = response.json() || {};
      const sessions = roster.sessions || roster.data?.sessions || [];
      matched = sessions.filter((session) =>
        expectedEmails.has(String(session.studentEmail || "").toLowerCase())
      ).length;
      if (matched === data.studentCount) break;
    }
    sleep(0.5);
  }
  if (matched !== data.studentCount) {
    loadFlowFailures.add(1, { phase: "control-roster" });
    fail(`Only ${matched}/${data.studentCount} IELTS candidates reached the proctor roster.`);
  }

  let started;
  for (let retry = 0; retry < 5; retry += 1) {
    started = http.post(
      `${data.baseUrl}/api/v1/schedules/${data.scheduleId}/runtime/commands`,
      JSON.stringify({
        action: "start_runtime",
        reason: "local IELTS 500 candidate readiness test",
      }),
      {
        jar,
        headers: jsonHeaders(csrfHeader(jar, data.baseUrl)),
        responseCallback: http.expectedStatuses(200, 409, 429, 500, 502, 503, 504),
        tags: { name: "ielts_load_start_runtime" },
      }
    );
    recordHttpFailure("control-start", started);
    if (started.status === 200 || started.status === 409) break;
    if (![0, 429, 500, 502, 503, 504].includes(started.status)) break;
    sleep(Math.min(2, 0.25 * 2 ** retry) + Math.random() * 0.25);
  }
  const startAccepted = started.status === 200 || started.status === 409;
  if (!startAccepted) {
    loadFlowFailures.add(1, { phase: "control-start" });
    console.error(
      `IELTS_LOAD_CONTROL_START_FAILURE status=${started.status} body=${String(started.body).slice(0, 200)}`
    );
  }
  check(started, { "IELTS runtime start accepted": () => startAccepted }) ||
    fail(`IELTS runtime start failed: ${started.status} ${String(started.body).slice(0, 200)}`);
}

export function studentFlow(data) {
  const studentIndex = exec.scenario.iterationInTest;
  const student = data.students[studentIndex];
  if (!student) {
    loadFlowFailures.add(1, { phase: "student-fixture" });
    fail(`No IELTS candidate fixture exists for student iteration ${studentIndex}.`);
  }
  if (data.admissionJitterSeconds > 0) {
    // Spread first-time check-in across a short realistic arrival wave while
    // still starting all candidates together after the roster is ready.
    sleep((studentIndex / data.studentCount) * data.admissionJitterSeconds);
  }
  const jar = http.cookieJar();
  const clientSessionId = uuidV4();
  let bootstrap;
  try {
    bootstrap = bootstrapStudentSession(
      data.baseUrl,
      data.scheduleId,
      student,
      jar,
      clientSessionId,
      {
        entryRetries: 5,
        bootstrapRetries: 3,
        precheckRetries: 3,
        onEntryResponse: (response, attempt) => {
          recordHttpFailure("student-entry", response);
          if (response.status < 200 || response.status >= 400) {
            console.error(
              `IELTS_LOAD_ENTRY_FAILURE wcode=${student.wcode} retry=${attempt} status=${response.status} body=${String(response.body).slice(0, 220)}`
            );
          }
        },
        onBootstrapResponse: (response, attempt) => {
          recordHttpFailure("student-bootstrap", response);
          if (response.status < 200 || response.status >= 400) {
            console.error(
              `IELTS_LOAD_BOOTSTRAP_FAILURE wcode=${student.wcode} retry=${attempt} status=${response.status} body=${String(response.body).slice(0, 220)}`
            );
          }
        },
        onPrecheckResponse: (response, attempt) => {
          recordHttpFailure("student-precheck", response);
          if (response.status < 200 || response.status >= 400) {
            console.error(
              `IELTS_LOAD_PRECHECK_FAILURE wcode=${student.wcode} retry=${attempt} status=${response.status} body=${String(response.body).slice(0, 220)}`
            );
          }
        },
      }
    );
  } catch (error) {
    loadFlowFailures.add(1, { phase: "student-bootstrap" });
    fail(`Candidate ${student.wcode} bootstrap failed: ${String(error)}`);
  }
  const attemptId = bootstrap.attemptId;
  let attemptToken = bootstrap.attemptToken;

  const deadline = Date.now() + data.liveWaitSeconds * 1000;
  let currentSectionKey = "";
  let runtimeRevision = 0;
  let runtimePollSeconds = data.pollSeconds;
  while (Date.now() < deadline) {
    const response = http.get(
      `${data.baseUrl}/api/v1/student/sessions/${data.scheduleId}/runtime?sinceRevision=${runtimeRevision}`,
      {
        jar,
        headers: jsonHeaders({ authorization: `Bearer ${attemptToken}` }),
        responseCallback: http.expectedStatuses(200, 304),
        tags: { name: "ielts_load_runtime_poll" },
      }
    );
    recordHttpFailure("student-session", response);
    if (response.status === 304) {
      sleep(runtimePollSeconds);
      continue;
    }
    if (response.status === 200) {
      const runtime = response.json() || {};
      if (Number.isInteger(runtime.revision) && runtime.revision >= 0) {
        runtimeRevision = runtime.revision;
      }
      if (runtime.status === "live" && runtime.activeSection) {
        currentSectionKey = runtime.activeSection;
        break;
      }
      const nextPollSeconds = Number(runtime.pollAfterSecs);
      if (Number.isFinite(nextPollSeconds) && nextPollSeconds > 0) {
        runtimePollSeconds = Math.max(1, Math.min(30, nextPollSeconds));
      }
    } else if ([0, 429, 502, 503, 504].includes(response.status)) {
      sleep(0.5 + Math.random() * 0.5);
      continue;
    }
    sleep(runtimePollSeconds);
  }
  if (!currentSectionKey) {
    readyFailures.add(1);
    readySuccess.add(false);
    fail(`Candidate ${student.wcode} did not observe the live IELTS runtime.`);
  }

  // The local E2E harness shortens the shared room clock after the proctor
  // starts it. Wait briefly so personal timelines use that test duration.
  if (data.runtimeReadyDelaySeconds > 0) sleep(data.runtimeReadyDelaySeconds);
  if (student.wcode !== data.delayedWcode && data.readinessJitterSeconds > 0) {
    sleep((studentIndex / data.studentCount) * data.readinessJitterSeconds);
  }
  if (student.wcode === data.delayedWcode) sleep(data.delayedSeconds);
  const sentAt = Date.now();
  let firstSection;
  try {
    firstSection = readySection(
      data,
      currentSectionKey,
      attemptId,
      clientSessionId,
      attemptToken,
      jar
    );
  } catch (error) {
    readyFailures.add(1);
    readySuccess.add(false);
    loadFlowFailures.add(1, { phase: "first-section-ready" });
    fail(`Candidate ${student.wcode} readiness failed: ${String(error)}`);
  }
  const view = firstSection.view;
  readyLatencyMs.add(Date.now() - sentAt);
  readySuccess.add(true);
  check(view, {
    "candidate received an active personal section timeline": (timeline) =>
      timeline.status === "active" && Boolean(timeline.startedAt && timeline.deadlineAt),
  }) || fail(`Candidate ${student.wcode} did not receive an active personal section timeline.`);
  if (Date.parse(view.deadlineAt) - Date.parse(view.startedAt) !== data.sectionSeconds * 1000) {
    loadFlowFailures.add(1, { phase: "first-section-duration" });
    fail(`Candidate ${student.wcode} did not receive the full Listening duration.`);
  }

  const listeningSaveMs = saveIELTSAnswer(
    data,
    attemptId,
    attemptToken,
    jar,
    data.listeningQuestionId,
    `ielts-load-listening-${student.wcode}`,
    "listening"
  );
  transitionLatencyMs.add(listeningSaveMs);

  // Reopen the same attempt on the same device identity, then repeat the
  // idempotent readiness request. The start and deadline must remain fixed.
  const reconnectClientSessionId = clientSessionId;
  const reconnect = refreshStudentSession(data, jar, reconnectClientSessionId);
  let reconnected = reconnect.status === 200;
  let reconnectedToken = attemptToken;
  if (reconnected) {
    const reconnectPayload = jsonOrEmpty(reconnect);
    const reconnectData = reconnectPayload.data || reconnectPayload;
    const rotated = reconnectData.attemptCredential?.attemptToken;
    if (rotated) reconnectedToken = rotated;
    reconnected = Boolean(reconnectData.attempt?.id === attemptId && reconnectedToken);
  }
  let repeatedTimeline = null;
  if (reconnected) {
    try {
      const repeat = readySection(
        data,
        currentSectionKey,
        attemptId,
        reconnectClientSessionId,
        reconnectedToken,
        jar
      );
      repeatedTimeline = repeat.view;
    } catch (_) {
      reconnected = false;
    }
  }
  const unchangedTimeline =
    reconnected &&
    repeatedTimeline.startedAt === view.startedAt &&
    repeatedTimeline.deadlineAt === view.deadlineAt;
  reconnectSuccess.add(unchangedTimeline);
  if (!unchangedTimeline) {
    loadFlowFailures.add(1, { phase: "personal-reconnect" });
    fail(`Candidate ${student.wcode} lost or changed the Listening timeline on reconnect.`);
  }
  attemptToken = reconnectedToken;

  waitForSectionDeadline(view);
  const readingStartedAt = Date.now();
  let reading;
  try {
    reading = readySection(data, "reading", attemptId, reconnectClientSessionId, attemptToken, jar);
  } catch (error) {
    transitionFailures.add(1, { section: "reading" });
    loadFlowFailures.add(1, { phase: "reading-ready" });
    fail(`Candidate ${student.wcode} could not open Reading: ${String(error)}`);
  }
  transitionLatencyMs.add(
    Math.max(0, readingStartedAt - Date.parse(view.deadlineAt)) + reading.latencyMs
  );
  if (
    Date.parse(reading.view.deadlineAt) - Date.parse(reading.view.startedAt) !==
    data.sectionSeconds * 1000
  ) {
    transitionFailures.add(1, { section: "reading-duration" });
    fail(`Candidate ${student.wcode} did not receive the full Reading duration.`);
  }
  saveIELTSAnswer(
    data,
    attemptId,
    attemptToken,
    jar,
    data.readingQuestionId,
    `ielts-load-reading-${student.wcode}`,
    "reading"
  );

  waitForSectionDeadline(reading.view);
  const writingStartedAt = Date.now();
  let writing;
  try {
    writing = readySection(data, "writing", attemptId, reconnectClientSessionId, attemptToken, jar);
  } catch (error) {
    transitionFailures.add(1, { section: "writing" });
    loadFlowFailures.add(1, { phase: "writing-ready" });
    fail(`Candidate ${student.wcode} could not open Writing: ${String(error)}`);
  }
  transitionLatencyMs.add(
    Math.max(0, writingStartedAt - Date.parse(reading.view.deadlineAt)) + writing.latencyMs
  );
  if (
    Date.parse(writing.view.deadlineAt) - Date.parse(writing.view.startedAt) !==
    data.sectionSeconds * 1000
  ) {
    transitionFailures.add(1, { section: "writing-duration" });
    fail(`Candidate ${student.wcode} did not receive the full Writing duration.`);
  }
  saveIELTSAnswer(
    data,
    attemptId,
    attemptToken,
    jar,
    data.writingTaskId,
    `IELTS Writing response from ${student.wcode}.`,
    "writing"
  );

  waitForSectionDeadline(writing.view);
  submitIELTSAttempt(data, attemptId, attemptToken, jar);
}
