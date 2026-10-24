import http from "k6/http";
import { fail as k6Fail, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { randomBytes, sha256 } from "k6/crypto";
import { SharedArray } from "k6/data";

// End-to-end API rehearsal for the SAT frozen-answer close protocol. Credentials
// must belong to an isolated synthetic schedule and an active personal SAT
// Module 1 whose database deadline matches K6_WAVE_AT_MS. By default, 10% of
// connected, non-delayed candidates make a final edit; the rest close against
// their latest confirmed write, matching the browser's durable close envelope.
const baseUrl = String(__ENV.K6_BASE_URL || "").replace(/\/$/, "");
const vus = Number(__ENV.K6_VUS || "2000");
const saveLeadMs = Number(__ENV.K6_SAVE_LEAD_MS || "30000");
const offlinePercent = Number(__ENV.K6_OFFLINE_PERCENT || "20");
const offlineDelaySeconds = Number(__ENV.K6_OFFLINE_DELAY_SECONDS || "45");
const entryDelayPercent = Number(__ENV.K6_ENTRY_DELAY_PERCENT || "1");
// Keep the default delayed-entry cohort safely inside the 120-second window;
// cutoff-expiry behavior is exercised by the dedicated expiry E2E scenario.
const nextEntryDelaySeconds = Number(__ENV.K6_NEXT_ENTRY_DELAY_SECONDS || "60");
const finalEditPercent = Number(__ENV.K6_FINAL_EDIT_PERCENT || "10");
const recoveryLimitSeconds = Number(__ENV.K6_RECOVERY_LIMIT_SECONDS || "120");
const closeReplayPercent = Number(__ENV.K6_CLOSE_REPLAY_PERCENT || "1");
const saveSpreadMs = Number(__ENV.K6_SAVE_SPREAD_MS || "10000");
const closeJitterMs = Number(__ENV.K6_CLOSE_JITTER_MS || "2000");
const chunkBudgetBytes = 150 * 1024;
const offlineCount = Math.floor((vus * offlinePercent) / 100);
const entryDelayCount = Math.floor((vus * entryDelayPercent) / 100);
const finalEditCount = Math.floor(
  ((vus - offlineCount - entryDelayCount) * finalEditPercent) / 100
);

if (__ENV.K6_CONFIRM_SAT !== "true") {
  throw new Error("Set K6_CONFIRM_SAT=true only for an isolated synthetic SAT load run.");
}
if (
  !baseUrl ||
  !Number.isInteger(vus) ||
  vus < 1 ||
  vus > 2000 ||
  !Number.isFinite(saveLeadMs) ||
  saveLeadMs < 250 ||
  saveLeadMs > 60000 ||
  !Number.isFinite(offlinePercent) ||
  offlinePercent < 0 ||
  offlinePercent > 100 ||
  !Number.isFinite(offlineDelaySeconds) ||
  offlineDelaySeconds < 0 ||
  !Number.isFinite(entryDelayPercent) ||
  entryDelayPercent < 0 ||
  entryDelayPercent > 100 ||
  !Number.isFinite(nextEntryDelaySeconds) ||
  nextEntryDelaySeconds < 0 ||
  nextEntryDelaySeconds >= 120 ||
  !Number.isFinite(finalEditPercent) ||
  finalEditPercent < 0 ||
  finalEditPercent > 100 ||
  offlineCount + entryDelayCount > vus ||
  offlineCount + entryDelayCount + finalEditCount > vus ||
  !Number.isFinite(recoveryLimitSeconds) ||
  recoveryLimitSeconds < 1 ||
  offlineDelaySeconds >= recoveryLimitSeconds ||
  !Number.isFinite(closeReplayPercent) ||
  closeReplayPercent < 0 ||
  closeReplayPercent > 100 ||
  !Number.isFinite(saveSpreadMs) ||
  saveSpreadMs < 0 ||
  saveSpreadMs > Math.max(0, saveLeadMs - 1000) ||
  !Number.isFinite(closeJitterMs) ||
  closeJitterMs < 0 ||
  closeJitterMs > 10000
) {
  throw new Error("Provide valid load settings and one complete synthetic credential per VU.");
}

const selected = new SharedArray("SAT recovery close credentials", () => {
  const credentials = JSON.parse(open(__ENV.K6_ATTEMPT_TOKENS_PATH || "./sat-close-creds.json"));
  if (!Array.isArray(credentials) || credentials.length < vus) {
    throw new Error("Provide one complete synthetic credential per VU.");
  }
  const rows = credentials.slice(0, vus).map((credential) => ({
    ...credential,
    scheduleId: credential.scheduleId || __ENV.K6_SCHEDULE_ID || "",
  }));
  if (
    rows.some(
      (credential) =>
        !credential.attemptId ||
        !credential.token ||
        !credential.scheduleId ||
        !credential.moduleId ||
        !credential.moduleAttemptId ||
        !credential.expectedNextModuleId ||
        !Array.isArray(credential.questions) ||
        credential.questions.length < 1 ||
        credential.questions.length > 200 ||
        credential.questions.some(
          (question) =>
            !question.questionId || !Object.prototype.hasOwnProperty.call(question, "answer")
        )
    ) ||
    new Set(rows.map((credential) => `${credential.scheduleId}:${credential.attemptId}`)).size !==
      vus
  ) {
    throw new Error(
      "Each VU needs a unique attempt, module identities, expected next module, and 1–200 synthetic answers."
    );
  }
  return rows;
});

const failures = new Counter("sat_close_failures");
const unexpected5xx = new Counter("sat_close_unexpected_5xx");
const saveAckMs = new Trend("sat_close_save_ack_ms");
const registrationMs = new Trend("sat_close_registration_ms");
const closeAckMs = new Trend("sat_close_request_ack_ms");
const closeReplayMs = new Trend("sat_close_replay_ack_ms");
const manifestPreparationMs = new Trend("sat_close_manifest_preparation_ms");
const activationAckMs = new Trend("sat_close_next_module_activation_ack_ms");
const healthyTransitionMs = new Trend("sat_close_healthy_transition_start_ack_ms");
const healthyDeadlineWakeLagMs = new Trend("sat_close_healthy_deadline_wake_lag_ms");
const healthyCloseDispatchLagMs = new Trend("sat_close_healthy_close_dispatch_lag_ms");
const healthyDeadlineToCloseAckMs = new Trend("sat_close_healthy_deadline_to_close_ack_ms");
const healthyCloseToStartDispatchMs = new Trend("sat_close_healthy_close_to_start_dispatch_ms");
const healthyActivationAckMs = new Trend("sat_close_healthy_activation_ack_ms");
const offlineRecoveryMs = new Trend("sat_close_offline_recovery_start_ack_ms");
const entryWindowMs = new Trend("sat_close_next_module_entry_delay_ms");
const closeReplayFailures = new Counter("sat_close_replay_failures");
const lostFrozenAnswers = new Counter("sat_close_lost_frozen_answers");
const startControlEpochRetries = new Counter("sat_start_control_epoch_retries");
const snapshotReadRetries = new Counter("sat_close_snapshot_read_retries");
const retryableResponses = new Counter("sat_recovery_retryable_responses");
const retryableResponseMs = new Trend("sat_recovery_retryable_response_ms");
const retryableTimeouts = new Counter("sat_recovery_retryable_transport_errors");
const retryable429s = new Counter("sat_recovery_retryable_429s");
const retryable502s = new Counter("sat_recovery_retryable_502s");
const retryable503s = new Counter("sat_recovery_retryable_503s");
const retryable504s = new Counter("sat_recovery_retryable_504s");

const thresholds = {
  sat_close_failures: ["count==0"],
  sat_close_unexpected_5xx: ["count==0"],
  sat_close_replay_failures: ["count==0"],
  sat_close_lost_frozen_answers: ["count==0"],
  sat_close_save_ack_ms: ["p(99)<=1000"],
};
if (offlineCount > 0) {
  thresholds.sat_close_offline_recovery_start_ack_ms = [`max<${recoveryLimitSeconds * 1000}`];
}
if (offlineCount + entryDelayCount < vus) {
  thresholds.sat_close_healthy_transition_start_ack_ms = ["p(95)<=3000", "p(99)<=5000"];
}
if (entryDelayCount > 0) {
  thresholds.sat_close_next_module_entry_delay_ms = ["max<120000"];
}

export const options = {
  scenarios: {
    frozen_close: {
      executor: "per-vu-iterations",
      vus,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds,
};

export function setup() {
  const deadlineAt = Number(__ENV.K6_WAVE_AT_MS || 0);
  if (!Number.isFinite(deadlineAt) || deadlineAt <= Date.now() + saveLeadMs + 5000) {
    throw new Error(
      "K6_WAVE_AT_MS must match the seeded module deadlines and be at least 5 seconds ahead."
    );
  }
  return { deadlineAt, offlineCount, entryDelayCount, finalEditCount };
}

function uuid() {
  const bytes = new Uint8Array(randomBytes(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function goJSONString(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function canonicalJSON(value, inArray = false) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return goJSONString(value);
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJSON(entry, true)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${goJSONString(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
  }
  if (inArray) return "null";
  throw new Error("Unsupported synthetic response value.");
}

function json(response) {
  try {
    return response.json();
  } catch (_) {
    return null;
  }
}

function fail(message, counter = failures) {
  counter.add(1);
  k6Fail(message);
}

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

function endpoint(credential, path) {
  return `${baseUrl}/api/v1/assessment-delivery/schedules/${encodeURIComponent(credential.scheduleId)}${path}`;
}

function attemptUrl(credential, suffix) {
  return `${baseUrl}/api/v2/student/attempts/${encodeURIComponent(credential.attemptId)}/${suffix}`;
}

function countUnexpected5xx(response, operation) {
  if (response.status >= 500 && response.status !== 503) {
    unexpected5xx.add(1, { operation, status: String(response.status) });
  }
}

function countRetryableResponse(response, operation, startedAt) {
  if ([0, 429, 502, 503, 504].includes(response.status)) {
    const tags = { operation, status: String(response.status) };
    retryableResponses.add(1, tags);
    retryableResponseMs.add(Date.now() - startedAt, tags);
    if (response.status === 0) retryableTimeouts.add(1, { operation });
    else if (response.status === 429) retryable429s.add(1, { operation });
    else if (response.status === 502) retryable502s.add(1, { operation });
    else if (response.status === 503) retryable503s.add(1, { operation });
    else if (response.status === 504) retryable504s.add(1, { operation });
  }
}

function retryDelaySeconds(response, attempt) {
  const backoffSeconds = (Math.min(2000, 200 * 2 ** attempt) + Math.random() * 200) / 1000;
  const retryAfterHeader = Object.entries(response?.headers || {}).find(
    ([name]) => name.toLowerCase() === "retry-after"
  )?.[1];
  if (retryAfterHeader === undefined) return backoffSeconds;

  const raw = String(retryAfterHeader).trim();
  const seconds = Number(raw);
  const retryAt = Number.isFinite(seconds) ? Number.NaN : Date.parse(raw);
  if (!Number.isFinite(seconds) && !Number.isFinite(retryAt)) return backoffSeconds;
  const retryAfterSeconds = Number.isFinite(seconds)
    ? Math.max(0, seconds)
    : Math.max(0, (retryAt - Date.now()) / 1000);
  return Math.max(backoffSeconds, retryAfterSeconds);
}

function postJson(credential, url, body, metric, label) {
  const startedAt = Date.now();
  const serialized = JSON.stringify(body);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const attemptStartedAt = Date.now();
    const response = http.post(url, serialized, {
      headers: headers(credential.token),
      timeout: "20s",
      responseCallback: http.expectedStatuses(200, 400, 409, 429, 502, 503, 504),
    });
    countUnexpected5xx(response, label);
    countRetryableResponse(response, label, attemptStartedAt);
    if (response.status === 200) {
      metric.add(Date.now() - startedAt);
      return json(response);
    }
    if (![0, 429, 502, 503, 504].includes(response.status)) {
      fail(
        `${label} rejected with HTTP ${response.status} for VU ${__VU}: ${JSON.stringify(json(response)).slice(0, 400)}.`
      );
    }
    sleep(retryDelaySeconds(response, attempt));
  }
  fail(`${label} did not receive a successful response.`);
}

function startNextModule(credential, closeAck) {
  const url = endpoint(credential, "/modules/start");
  const startedAt = Date.now();
  let controlEpoch = Number(closeAck?.controlEpoch);
  if (!Number.isSafeInteger(controlEpoch) || controlEpoch < 1) {
    fail("The close receipt omitted the current control epoch.");
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const attemptStartedAt = Date.now();
    const response = http.post(
      url,
      JSON.stringify({
        moduleId: closeAck.nextModuleId,
        controlEpoch,
        needContent: true,
      }),
      {
        headers: headers(credential.token),
        timeout: "20s",
        responseCallback: http.expectedStatuses(200, 400, 409, 429, 502, 503, 504),
      }
    );
    countUnexpected5xx(response, "next-module activation");
    countRetryableResponse(response, "next-module activation", attemptStartedAt);
    if (response.status === 200) {
      activationAckMs.add(Date.now() - startedAt);
      return json(response);
    }
    const body = json(response);
    const currentEpoch = Number(body?.details?.currentControlEpoch);
    if (
      response.status === 409 &&
      body?.code === "CONTROL_EPOCH_STALE" &&
      Number.isSafeInteger(currentEpoch) &&
      currentEpoch > controlEpoch
    ) {
      controlEpoch = currentEpoch;
      startControlEpochRetries.add(1);
      continue;
    }
    if (![0, 429, 502, 503, 504].includes(response.status)) {
      fail(
        `Next-module activation rejected with HTTP ${response.status} for VU ${__VU}: ${JSON.stringify(body).slice(0, 400)}.`
      );
    }
    sleep(retryDelaySeconds(response, attempt));
  }
  fail("Next-module activation did not receive a successful response.");
}

function responsePayload(answer) {
  return {
    answer: answer === undefined ? null : answer,
    markedForReview: false,
    eliminatedOptions: [],
    annotations: [],
  };
}

function assertAcknowledgements(body, commands) {
  const acknowledgements = body?.acknowledgements;
  if (!Array.isArray(acknowledgements) || acknowledgements.length !== commands.length) {
    lostFrozenAnswers.add(1);
    fail("A frozen response batch did not acknowledge every command.", lostFrozenAnswers);
  }
  const byWrite = new Map(acknowledgements.map((ack) => [ack.writeId, ack]));
  for (const command of commands) {
    const ack = byWrite.get(command.writeId);
    if (
      !ack ||
      ack.questionId !== command.questionId ||
      ack.clientVersion !== command.clientVersion ||
      !["applied", "duplicate"].includes(ack.outcome) ||
      ack.contentHash !== sha256(canonicalJSON(command.response), "hex") ||
      JSON.stringify(ack.canonicalResponse?.answer) !== JSON.stringify(command.response.answer)
    ) {
      lostFrozenAnswers.add(1);
      fail("A frozen response acknowledgement did not confirm the exact write.", lostFrozenAnswers);
    }
  }
}

function saveSnapshot(credential) {
  let response;
  let snapshot;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const attemptStartedAt = Date.now();
    response = http.get(attemptUrl(credential, "responses"), {
      headers: headers(credential.token),
      timeout: "20s",
      responseCallback: http.expectedStatuses(200, 401, 403, 429, 502, 503, 504),
    });
    snapshot = json(response);
    countRetryableResponse(response, "authoritative response snapshot", attemptStartedAt);
    if (response.status === 200) {
      if (
        !Number.isSafeInteger(snapshot?.leaseEpoch) ||
        snapshot.leaseEpoch < 1 ||
        !Number.isSafeInteger(snapshot?.controlEpoch) ||
        snapshot.controlEpoch < 1 ||
        !Array.isArray(snapshot.responses)
      ) {
        fail(
          `Could not read valid authoritative response epochs for ${credential.attemptId} (HTTP 200: ${JSON.stringify(snapshot).slice(0, 300)}).`
        );
      }
      return snapshot;
    }
    if (![0, 429, 502, 503, 504].includes(response.status)) {
      fail(
        `Could not read the authoritative response epochs for ${credential.attemptId} (HTTP ${response.status}: ${JSON.stringify(snapshot).slice(0, 300)}).`
      );
    }
    if (attempt < 4) {
      snapshotReadRetries.add(1);
      sleep(retryDelaySeconds(response, attempt));
    }
  }
  fail(
    `Could not read the authoritative response epochs for ${credential.attemptId} after 5 attempts (HTTP ${response?.status ?? 0}: ${JSON.stringify(snapshot).slice(0, 300)}).`
  );
}

function waitUntil(timeMs) {
  if (timeMs > Date.now()) sleep((timeMs - Date.now()) / 1000);
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function splitCommands(snapshot, commands, moduleClose = null) {
  const chunks = [];
  let current = [];
  for (const command of commands) {
    const candidate = [...current, command];
    const body = {
      leaseEpoch: snapshot.leaseEpoch,
      controlEpoch: snapshot.controlEpoch,
      ...(moduleClose ? { moduleClose } : {}),
      commands: candidate,
    };
    if (candidate.length > 100 || utf8ByteLength(JSON.stringify(body)) > chunkBudgetBytes) {
      if (current.length === 0)
        fail("One synthetic answer exceeds the bounded recovery chunk size.");
      chunks.push(current);
      current = [command];
      const one = {
        leaseEpoch: snapshot.leaseEpoch,
        controlEpoch: snapshot.controlEpoch,
        ...(moduleClose ? { moduleClose } : {}),
        commands: current,
      };
      if (utf8ByteLength(JSON.stringify(one)) > chunkBudgetBytes) {
        fail("One synthetic answer exceeds the bounded recovery chunk size.");
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export default function ({ deadlineAt, offlineCount, entryDelayCount, finalEditCount }) {
  const credential = selected[__VU - 1];
  const snapshot = saveSnapshot(credential);
  const existingVersions = new Map(
    snapshot.responses.map((row) => [row.questionId, Number(row.clientVersion) || 0])
  );
  const baselineCommands = credential.questions.map((question) => {
    const version =
      Math.max(
        existingVersions.get(question.questionId) || 0,
        Number(question.clientVersion) || 0
      ) + 1;
    return {
      writeId: uuid(),
      questionId: question.questionId,
      clientVersion: version,
      response: responsePayload(question.answer),
    };
  });

  const isOfflineWave = __VU <= offlineCount;
  const isEntryDelayWave = __VU > offlineCount && __VU <= offlineCount + entryDelayCount;
  const isFinalEditWave =
    __VU > offlineCount + entryDelayCount &&
    __VU <= offlineCount + entryDelayCount + finalEditCount;

  // VUs share one load generator. Prepare deterministic hashes before the
  // synchronized deadline so local CPU contention does not masquerade as API
  // close latency; the frozen envelope is still sent only at its policy time.
  const manifestPreparationStartedAt = Date.now();
  const finalCommands = [];
  const manifestCommands = credential.questions.map((question, index) => {
    if (!isOfflineWave && !isFinalEditWave) return baselineCommands[index];
    const response = responsePayload(
      Object.prototype.hasOwnProperty.call(question, "frozenAnswer")
        ? question.frozenAnswer
        : question.answer
    );
    if (canonicalJSON(response) === canonicalJSON(baselineCommands[index].response)) {
      return baselineCommands[index];
    }
    const command = {
      writeId: uuid(),
      questionId: question.questionId,
      clientVersion: baselineCommands[index].clientVersion + 1,
      response,
    };
    finalCommands.push(command);
    return command;
  });
  const manifest = manifestCommands
    .map((command) => ({
      questionId: command.questionId,
      writeId: command.writeId,
      clientVersion: command.clientVersion,
      contentHash: sha256(canonicalJSON(command.response), "hex"),
    }))
    .sort((a, b) => (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0));
  const manifestHash = sha256(canonicalJSON(manifest), "hex");
  const operationId = uuid();
  const closeRequest = {
    protocol: "sat_recovery_v1",
    moduleId: credential.moduleId,
    moduleAttemptId: credential.moduleAttemptId,
    closeId: operationId,
    leaseEpoch: snapshot.leaseEpoch,
    controlEpoch: snapshot.controlEpoch,
    answers: manifest,
    finalCommands: isOfflineWave ? [] : finalCommands,
  };
  manifestPreparationMs.add(Date.now() - manifestPreparationStartedAt);

  waitUntil(deadlineAt - saveLeadMs);
  if (saveSpreadMs > 0) sleep((Math.random() * saveSpreadMs) / 1000);
  for (const commands of splitCommands(snapshot, baselineCommands)) {
    const baselineAck = postJson(
      credential,
      attemptUrl(credential, "responses:batch"),
      {
        leaseEpoch: snapshot.leaseEpoch,
        controlEpoch: snapshot.controlEpoch,
        commands,
      },
      saveAckMs,
      "pre-deadline save"
    );
    assertAcknowledgements(baselineAck, commands);
  }

  waitUntil(deadlineAt);
  const deadlineWakeAt = Date.now();
  if (isOfflineWave && offlineDelaySeconds > 0) sleep(offlineDelaySeconds);
  if (closeJitterMs > 0) sleep((Math.random() * closeJitterMs) / 1000);
  if (isOfflineWave && finalCommands.length > 0) {
    const registration = postJson(
      credential,
      endpoint(credential, "/modules/close-intent"),
      {
        protocol: "sat_recovery_v1",
        moduleId: credential.moduleId,
        moduleAttemptId: credential.moduleAttemptId,
        registrationId: operationId,
        leaseEpoch: snapshot.leaseEpoch,
        controlEpoch: snapshot.controlEpoch,
        answers: manifest,
      },
      registrationMs,
      "frozen frontier registration"
    );
    if (
      registration?.manifestHash !== manifestHash ||
      registration?.moduleAttemptId !== credential.moduleAttemptId
    ) {
      fail("The server registered a different frozen answer frontier.");
    }

    const chunks = splitCommands(snapshot, finalCommands, {
      moduleAttemptId: credential.moduleAttemptId,
      manifestHash,
    });
    for (const commands of chunks) {
      const chunkBody = {
        leaseEpoch: snapshot.leaseEpoch,
        controlEpoch: snapshot.controlEpoch,
        moduleClose: { moduleAttemptId: credential.moduleAttemptId, manifestHash },
        commands,
      };
      const chunkAck = postJson(
        credential,
        attemptUrl(credential, "responses:batch"),
        chunkBody,
        saveAckMs,
        "frozen answer chunk"
      );
      assertAcknowledgements(chunkAck, commands);
    }
  }

  const closeDispatchAt = Date.now();
  const isHealthyTransition = !isOfflineWave && !isEntryDelayWave;
  if (isHealthyTransition) {
    healthyDeadlineWakeLagMs.add(deadlineWakeAt - deadlineAt);
    healthyCloseDispatchLagMs.add(closeDispatchAt - deadlineAt);
  }
  const closeAck = postJson(
    credential,
    endpoint(credential, "/modules/close"),
    closeRequest,
    closeAckMs,
    "module close"
  );
  if (!isOfflineWave && finalCommands.length > 0) {
    assertAcknowledgements({ acknowledgements: closeAck?.finalAcks }, finalCommands);
  }
  if (!closeAck?.closed || closeAck.boundaryPhase !== "settled" || !closeAck.nextModuleId) {
    fail("The recovery close did not settle and select the next module.");
  }
  const closeAckReceivedAt = Date.now();
  if (isHealthyTransition) healthyDeadlineToCloseAckMs.add(closeAckReceivedAt - deadlineAt);
  const closeEligibleAt = Date.parse(closeAck.serverNow);
  if (!Number.isFinite(closeEligibleAt))
    fail("The close receipt omitted its authoritative eligibility time.");
  if (closeEligibleAt - deadlineAt >= recoveryLimitSeconds * 1000) {
    fail("The frozen answer frontier settled outside its fixed recovery allowance.");
  }
  const expectedNextModuleId =
    finalCommands.length > 0
      ? credential.expectedNextModuleId
      : credential.expectedUnchangedNextModuleId || credential.expectedNextModuleId;
  if (closeAck.nextModuleId !== expectedNextModuleId) {
    fail("The recovery close selected an unexpected next module.");
  }

  const attemptRows = closeAck.moduleAttempts || [];
  const closedModule = attemptRows.find((row) => row.id === credential.moduleAttemptId);
  if (!closedModule || !["locked", "submitted"].includes(closedModule.state)) {
    fail("The settled close did not return a terminal Module 1 row.");
  }

  if (isEntryDelayWave && nextEntryDelaySeconds > 0) sleep(nextEntryDelaySeconds);
  const startDispatchAt = Date.now();
  if (isHealthyTransition) healthyCloseToStartDispatchMs.add(startDispatchAt - closeAckReceivedAt);
  const startAck = startNextModule(credential, closeAck);
  if (startAck?.state !== "active" || startAck.moduleId !== closeAck.nextModuleId) {
    fail("The next module did not enter its server-owned active state.");
  }
  const startAckReceivedAt = Date.now();
  if (isEntryDelayWave) {
    const startedAt = Date.parse(startAck?.startedAt);
    if (!Number.isFinite(startedAt))
      fail("The next-module activation omitted its authoritative start time.");
    const timeFromEligibility = startedAt - closeEligibleAt;
    entryWindowMs.add(timeFromEligibility);
    if (timeFromEligibility < 0 || timeFromEligibility >= 120000)
      fail("The next module started outside its separate 120-second entry allowance.");
  }
  // Keep the primary transition wave representative. A 100% receipt replay
  // is a separate failure-stress mode; a deterministic modulo sample exercises
  // exact replay without adding one extra transaction per student by default.
  if ((__VU * 37) % 100 < closeReplayPercent) {
    const replay = postJson(
      credential,
      endpoint(credential, "/modules/close"),
      closeRequest,
      closeReplayMs,
      "idempotent module close replay"
    );
    if (!replay?.closed || replay.nextModuleId !== closeAck.nextModuleId) {
      closeReplayFailures.add(1);
      fail(
        "The close replay changed or failed to recover its committed route.",
        closeReplayFailures
      );
    }
  }
  const elapsedFromDeadline = startAckReceivedAt - deadlineAt;
  if (isOfflineWave) {
    offlineRecoveryMs.add(elapsedFromDeadline);
    if (elapsedFromDeadline >= recoveryLimitSeconds * 1000) {
      fail("The offline answer recovery completed outside its fixed allowance.");
    }
  } else if (!isEntryDelayWave) {
    healthyActivationAckMs.add(startAckReceivedAt - startDispatchAt);
    healthyTransitionMs.add(elapsedFromDeadline);
  }
}
