import http from "k6/http";
import { fail as k6Fail, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Trend } from "k6/metrics";

// Open-arrival throughput search for the SAT student hot paths
// (docs/plans/2026-10-23-sat-go-db-low-level-performance.md, section 7).
// constant-arrival-rate fixes the offered logical operations/s whatever the
// latency, so a passing point is one where every offered iteration started
// (dropped_iterations == 0) and the latency/failure thresholds hold. Sweep
// K6_RATE upward, then narrow around the first failing point; keep the mix
// and credentials fixed across compared runs.
//
// Each VU is bound to one synthetic attempt for its lifetime (credential
// __VU - 1), and a VU runs its iterations sequentially, so concurrency grows
// with distinct attempts, never with simultaneous writers to one attempt.
// Each attempt is paced to at most one operation per
// SAT_TP_ATTEMPT_INTERVAL_SECONDS (default 1, under the per-key write limit),
// so the offered-rate ceiling is SAT_TP_MAX_VUS / interval; beyond it k6
// reports dropped iterations, meaning the run needs more attempts.
//
// Knobs are SAT_TP_* on purpose: K6_DURATION, K6_VUS and similar are k6's
// own options and would replace this scenario.
// Credentials use the SAT recovery load fixture shape:
// {scheduleId, attemptId, token, questions: [{questionId}]}.
//
// Logical operations (deterministic per VU/iteration, no RNG):
//   save   - one new answer: a new write id at the next client version
//   replay - the VU's last acknowledged save resent unchanged (lost ack)
//   state  - the pinned lifecycle read
// HTTP attempts/s is k6's http_reqs rate; answer commands/s is
// sat_tp_answer_commands. Retried transients stay in the operation latency.
const baseUrl = String(__ENV.K6_BASE_URL || "").replace(/\/$/, "");
const rate = Number(__ENV.SAT_TP_RATE || "50");
const duration = __ENV.SAT_TP_DURATION || "10m";
const maxVUs = Number(__ENV.SAT_TP_MAX_VUS || "2000");
const intervalSeconds = Number(__ENV.SAT_TP_ATTEMPT_INTERVAL_SECONDS || "1");
const replayPercent = Number(__ENV.SAT_TP_REPLAY_PERCENT || "5");
const statePercent = Number(__ENV.SAT_TP_STATE_PERCENT || "20");
const runId = __ENV.SAT_TP_RUN_ID || String(Date.now());
const maxTries = 5;

if (__ENV.K6_CONFIRM_SAT !== "true") {
  throw new Error("Set K6_CONFIRM_SAT=true to confirm this is an isolated synthetic SAT load run.");
}
if (
  !baseUrl ||
  !Number.isFinite(rate) ||
  rate <= 0 ||
  !Number.isInteger(maxVUs) ||
  maxVUs < 1 ||
  !Number.isFinite(intervalSeconds) ||
  intervalSeconds < 0 ||
  ![replayPercent, statePercent].every((p) => Number.isFinite(p) && p >= 0) ||
  replayPercent + statePercent > 100
) {
  throw new Error(
    "Provide K6_BASE_URL, a positive SAT_TP_RATE, SAT_TP_MAX_VUS, a pacing interval and a valid operation mix."
  );
}

const credentials = new SharedArray("SAT throughput credentials", () => {
  const rows = JSON.parse(open(__ENV.K6_ATTEMPT_TOKENS_PATH || "./attempt-creds.json"));
  if (!Array.isArray(rows) || rows.length < maxVUs) {
    throw new Error("Provide one distinct synthetic credential per VU (SAT_TP_MAX_VUS).");
  }
  const selected = rows.slice(0, maxVUs);
  if (
    selected.some(
      (c) =>
        !c.scheduleId ||
        !c.attemptId ||
        !c.token ||
        !Array.isArray(c.questions) ||
        c.questions.length === 0
    ) ||
    new Set(selected.map((c) => c.attemptId)).size !== selected.length
  ) {
    throw new Error(
      "Each VU requires a distinct {scheduleId, attemptId, token, questions} credential."
    );
  }
  return selected;
});

const operations = new Counter("sat_tp_operations");
const answerCommands = new Counter("sat_tp_answer_commands");
const failures = new Counter("sat_tp_failures");
const unexpected5xx = new Counter("sat_tp_unexpected_5xx");
const retries = new Counter("sat_tp_retries");
const saveMs = new Trend("sat_tp_save_ms", true);
const replayMs = new Trend("sat_tp_replay_ms", true);
const stateMs = new Trend("sat_tp_state_ms", true);

export const options = {
  scenarios: {
    throughput: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: maxVUs,
      maxVUs,
      gracefulStop: "30s",
    },
  },
  thresholds: {
    dropped_iterations: ["count==0"],
    sat_tp_failures: ["count==0"],
    sat_tp_unexpected_5xx: ["count==0"],
    sat_tp_save_ms: ["p(99)<1000"],
    sat_tp_replay_ms: ["p(99)<1000"],
  },
};

// Per-VU state: k6 keeps module scope per VU across its iterations.
let epochs = null;
const versions = {};
let lastSave = null;
let saveSeq = 0;

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

function attemptUrl(credential, suffix) {
  return `${baseUrl}/api/v2/student/attempts/${encodeURIComponent(credential.attemptId)}/${suffix}`;
}

function failOp(operation, message) {
  failures.add(1, { operation });
  k6Fail(message);
}

function parse(response) {
  try {
    return response.json();
  } catch (_) {
    return null;
  }
}

// request retries transient statuses with the identical request (the same
// write id for saves), bounded; anything else is a failed operation.
function request(operation, send) {
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const response = send();
    if (response.status >= 500 && response.status !== 503) {
      unexpected5xx.add(1, { operation, status: String(response.status) });
    }
    if (response.status === 200) return parse(response);
    if (![0, 429, 502, 503, 504].includes(response.status)) {
      failOp(
        operation,
        `${operation} rejected with HTTP ${response.status} for VU ${__VU}: ${String(response.body).slice(0, 300)}`
      );
    }
    retries.add(1, { operation, status: String(response.status) });
    sleep((Math.min(2000, 200 * 2 ** attempt) + ((__VU * 37 + attempt * 101) % 200)) / 1000);
  }
  failOp(operation, `${operation} did not succeed after ${maxTries} tries for VU ${__VU}`);
}

function loadEpochs(credential) {
  const snapshot = request("snapshot", () =>
    http.get(attemptUrl(credential, "responses"), {
      headers: headers(credential.token),
      timeout: "20s",
      responseCallback: http.expectedStatuses(200, 429, 502, 503, 504),
    })
  );
  if (
    !Number.isSafeInteger(snapshot?.leaseEpoch) ||
    !Number.isSafeInteger(snapshot?.controlEpoch)
  ) {
    failOp("snapshot", `invalid response snapshot for ${credential.attemptId}`);
  }
  for (const row of snapshot.responses || [])
    versions[row.questionId] = Number(row.clientVersion) || 0;
  epochs = { leaseEpoch: snapshot.leaseEpoch, controlEpoch: snapshot.controlEpoch };
}

function postSave(credential, body, operation, trend) {
  const started = Date.now();
  const serialized = JSON.stringify(body);
  const ack = request(operation, () =>
    http.post(attemptUrl(credential, "responses:batch"), serialized, {
      headers: headers(credential.token),
      timeout: "20s",
      tags: { operation },
      responseCallback: http.expectedStatuses(200, 429, 502, 503, 504),
    })
  );
  trend.add(Date.now() - started);
  const command = body.commands[0];
  const acks = ack?.acknowledgements;
  const want = operation === "replay" ? "duplicate" : "applied";
  if (
    !Array.isArray(acks) ||
    acks.length !== 1 ||
    acks[0].writeId !== command.writeId ||
    acks[0].clientVersion !== command.clientVersion ||
    acks[0].outcome !== want
  ) {
    failOp(
      operation,
      `${operation} acknowledgement mismatch for VU ${__VU}: ${JSON.stringify(acks).slice(0, 300)}`
    );
  }
  answerCommands.add(1, { operation });
}

function save(credential) {
  const question = credential.questions[saveSeq % credential.questions.length];
  const version = (versions[question.questionId] || 0) + 1;
  const body = {
    leaseEpoch: epochs.leaseEpoch,
    controlEpoch: epochs.controlEpoch,
    commands: [
      {
        writeId: `tp-${runId}-${__VU}-${saveSeq}`,
        questionId: question.questionId,
        clientVersion: version,
        response: {
          answer: "ABCD"[saveSeq % 4],
          markedForReview: false,
          eliminatedOptions: [],
          annotations: [],
        },
      },
    ],
  };
  saveSeq += 1;
  postSave(credential, body, "save", saveMs);
  versions[question.questionId] = version;
  lastSave = body;
}

function state(credential) {
  const started = Date.now();
  const body = request("state", () =>
    http.get(
      `${baseUrl}/api/v1/assessment-delivery/schedules/${encodeURIComponent(credential.scheduleId)}/state`,
      {
        headers: { authorization: `Bearer ${credential.token}`, accept: "application/json" },
        timeout: "20s",
        tags: { operation: "state" },
        responseCallback: http.expectedStatuses(200, 429, 502, 503, 504),
      }
    )
  );
  stateMs.add(Date.now() - started);
  if (body?.attempt?.id !== credential.attemptId || (body?.sections || []).length !== 0) {
    failOp("state", `lifecycle state mismatch or content leak for VU ${__VU}`);
  }
}

export default function () {
  const startedAt = Date.now();
  const credential = credentials[__VU - 1];
  if (!credential) failOp("bind", `no credential bound to VU ${__VU}`);
  if (!epochs) loadEpochs(credential);
  const slot = (__ITER * 37 + __VU * 11) % 100;
  let operation = "save";
  if (slot < replayPercent && lastSave) operation = "replay";
  else if (slot >= replayPercent && slot < replayPercent + statePercent) operation = "state";
  if (operation === "replay") postSave(credential, lastSave, "replay", replayMs);
  else if (operation === "state") state(credential);
  else save(credential);
  operations.add(1, { operation });
  const rest = intervalSeconds * 1000 - (Date.now() - startedAt);
  if (rest > 0) sleep(rest / 1000);
}
