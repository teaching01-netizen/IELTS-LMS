import http from "k6/http";
import { fail as k6Fail, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Trend } from "k6/metrics";
import { uuidV4 } from "./prod-load-helpers.js";

// IELTS personal-timing throughput qualification
// (docs/plans/2026-10-24-ielts-go-db-throughput-core-plan.md, step 5).
// k6/ielts-personal-timing-500.js stays the localhost full-flow gate; this
// script measures capacity for an explicit synthetic target, in three phases
// that the harness (cmd/api/ielts_throughput_mysql_test.go) runs in order:
//
//   IELTS_TP_PHASE=ready   every VU reports readiness for its room's open
//                          section at once (a readiness wave), then retries it
//                          and requires the same stored start/deadline.
//   IELTS_TP_PHASE=steady  open-arrival mix at IELTS_TP_RATE logical
//                          operations/s: new saves, offline-flush batches,
//                          exact replays (lost ack) and runtime polls.
//   IELTS_TP_PHASE=submit  every VU submits at once, then resubmits the same
//                          submission (lost ack) and requires the same digest.
//
// constant-arrival-rate fixes the offered rate whatever the latency, so a
// passing steady point is one where every offered iteration started
// (dropped_iterations == 0) and the latency/failure thresholds hold. Each VU
// is bound to one synthetic attempt (credential __VU - 1) and paced to one
// operation per IELTS_TP_ATTEMPT_INTERVAL_SECONDS, so the offered-rate
// ceiling is IELTS_TP_MAX_VUS / interval.
//
// Answers are a pure function of the client version ("ABCD"[version % 4]),
// so the harness verifies every stored cell and the sealed submission
// without trusting a server digest.
//
// Guards against mutating a real exam: K6_CONFIRM_IELTS=true, the target host
// repeated in K6_CONFIRM_IELTS_TARGET, and a credential file the harness marks
// {"synthetic": true}. Knobs are IELTS_TP_* on purpose: K6_DURATION, K6_VUS
// and similar are k6's own options.
const baseUrl = String(__ENV.K6_BASE_URL || "").replace(/\/$/, "");
const phase = __ENV.IELTS_TP_PHASE || "";
const rate = Number(__ENV.IELTS_TP_RATE || "50");
const duration = __ENV.IELTS_TP_DURATION || "10m";
const maxVUs = Number(__ENV.IELTS_TP_MAX_VUS || "500");
const intervalSeconds = Number(__ENV.IELTS_TP_ATTEMPT_INTERVAL_SECONDS || "1");
const replayPercent = Number(__ENV.IELTS_TP_REPLAY_PERCENT || "5");
const pollPercent = Number(__ENV.IELTS_TP_POLL_PERCENT || "20");
const flushPercent = Number(__ENV.IELTS_TP_FLUSH_PERCENT || "5");
const flushSize = Number(__ENV.IELTS_TP_FLUSH_SIZE || "20");
const runId = __ENV.IELTS_TP_RUN_ID || String(Date.now());
// Spreads each wave's first requests evenly over this many seconds (default
// 0: a synchronized wave). Local hosts with a small accept backlog
// (kern.ipc.somaxconn=128) reset simultaneous dials; a real target should
// keep 0.
const startSpreadSeconds = Number(__ENV.IELTS_TP_START_SPREAD_SECONDS || "0");
const maxTries = 5;

const targetHost = (/^https?:\/\/([^/]+)/.exec(baseUrl) || [])[1] || "";
if (__ENV.K6_CONFIRM_IELTS !== "true" || !targetHost || __ENV.K6_CONFIRM_IELTS_TARGET !== targetHost) {
  throw new Error(
    "Set K6_CONFIRM_IELTS=true and K6_CONFIRM_IELTS_TARGET=<host:port of K6_BASE_URL> to confirm an isolated synthetic IELTS load run."
  );
}
if (
  !["ready", "steady", "submit"].includes(phase) ||
  !Number.isFinite(rate) ||
  rate <= 0 ||
  !Number.isInteger(maxVUs) ||
  maxVUs < 1 ||
  !Number.isFinite(intervalSeconds) ||
  intervalSeconds < 0 ||
  !Number.isFinite(startSpreadSeconds) ||
  startSpreadSeconds < 0 ||
  !Number.isInteger(flushSize) ||
  flushSize < 2 ||
  flushSize > 100 ||
  ![replayPercent, pollPercent, flushPercent].every((p) => Number.isFinite(p) && p >= 0) ||
  replayPercent + pollPercent + flushPercent > 100
) {
  throw new Error(
    "Provide IELTS_TP_PHASE (ready|steady|submit), a positive IELTS_TP_RATE, IELTS_TP_MAX_VUS, a pacing interval, IELTS_TP_FLUSH_SIZE 2..100 and a valid operation mix."
  );
}

const credentials = new SharedArray("IELTS throughput credentials", () => {
  const file = JSON.parse(open(__ENV.K6_ATTEMPT_TOKENS_PATH || "./ielts-throughput-creds.json"));
  if (file?.synthetic !== true || !Array.isArray(file.candidates)) {
    throw new Error("The credential file must be a harness-generated {synthetic: true, candidates} fixture.");
  }
  if (file.candidates.length < maxVUs) {
    throw new Error("Provide one distinct synthetic credential per VU (IELTS_TP_MAX_VUS).");
  }
  const selected = file.candidates.slice(0, maxVUs);
  if (
    selected.some(
      (c) =>
        !c.scheduleId ||
        !c.attemptId ||
        !c.token ||
        !c.sectionKey ||
        !Array.isArray(c.questions) ||
        c.questions.length < flushSize
    ) ||
    new Set(selected.map((c) => c.attemptId)).size !== selected.length
  ) {
    throw new Error(
      "Each VU requires a distinct {scheduleId, attemptId, token, sectionKey, questions} credential with at least IELTS_TP_FLUSH_SIZE questions."
    );
  }
  return selected;
});

const operations = new Counter("ielts_tp_operations");
const answerCommands = new Counter("ielts_tp_answer_commands");
const failures = new Counter("ielts_tp_failures");
const unexpected5xx = new Counter("ielts_tp_unexpected_5xx");
const retries = new Counter("ielts_tp_retries");
const readyMs = new Trend("ielts_tp_ready_ms", true);
const readyRetryMs = new Trend("ielts_tp_ready_retry_ms", true);
const saveMs = new Trend("ielts_tp_save_ms", true);
const flushMs = new Trend("ielts_tp_flush_ms", true);
const replayMs = new Trend("ielts_tp_replay_ms", true);
const pollMs = new Trend("ielts_tp_poll_ms", true);
const submitMs = new Trend("ielts_tp_submit_ms", true);
const resubmitMs = new Trend("ielts_tp_resubmit_ms", true);

// The plan's proposed qualification objectives; the existing 500-user flow
// gates (readiness p95 < 10 s, submit p95 < 15 s) are far looser.
const scenarios = {
  ready: {
    executor: "per-vu-iterations",
    vus: maxVUs,
    iterations: 1,
    maxDuration: duration,
  },
  steady: {
    executor: "constant-arrival-rate",
    rate,
    timeUnit: "1s",
    duration,
    preAllocatedVUs: maxVUs,
    maxVUs,
    gracefulStop: "30s",
  },
  submit: {
    executor: "per-vu-iterations",
    vus: maxVUs,
    iterations: 1,
    maxDuration: duration,
  },
};
const thresholds = {
  ielts_tp_failures: ["count==0"],
  ielts_tp_unexpected_5xx: ["count==0"],
};
if (phase === "ready") {
  thresholds.ielts_tp_ready_ms = ["p(95)<1000", "p(99)<2000"];
} else if (phase === "steady") {
  thresholds.dropped_iterations = ["count==0"];
  thresholds.ielts_tp_save_ms = ["p(99)<1000"];
  thresholds.ielts_tp_flush_ms = ["p(99)<1000"];
  thresholds.ielts_tp_replay_ms = ["p(99)<1000"];
} else {
  thresholds.ielts_tp_submit_ms = ["p(95)<1000", "p(99)<2000"];
}

export const options = {
  scenarios: { [phase]: scenarios[phase] },
  thresholds,
};

// Per-VU state: k6 keeps module scope per VU across its iterations.
let epochs = null;
const versions = {};
let lastSave = null;
let saveSeq = 0;
let pollETag = "";

function answerFor(version) {
  return "ABCD"[version % 4];
}

function bearer(token, extra) {
  return Object.assign(
    { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    extra || {}
  );
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
// write or submission id), bounded; any other status is a failed operation.
function request(operation, send, okStatuses) {
  const ok = okStatuses || [200];
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const response = send();
    if (response.status >= 500 && response.status !== 503) {
      unexpected5xx.add(1, { operation, status: String(response.status) });
    }
    if (ok.includes(response.status)) return response;
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

const transient = http.expectedStatuses(200, 304, 429, 502, 503, 504);

function loadEpochs(credential) {
  const snapshot = parse(
    request("snapshot", () =>
      http.get(attemptUrl(credential, "responses"), {
        headers: bearer(credential.token),
        timeout: "20s",
        responseCallback: transient,
      })
    )
  );
  if (!Number.isSafeInteger(snapshot?.leaseEpoch) || !Number.isSafeInteger(snapshot?.controlEpoch)) {
    failOp("snapshot", `invalid response snapshot for ${credential.attemptId}`);
  }
  for (const row of snapshot.responses || []) versions[row.questionId] = Number(row.clientVersion) || 0;
  epochs = { leaseEpoch: snapshot.leaseEpoch, controlEpoch: snapshot.controlEpoch };
}

function ready(credential, trend) {
  const started = Date.now();
  const body = parse(
    request("ready", () =>
      http.post(
        `${baseUrl}/api/v1/student/sessions/${encodeURIComponent(credential.scheduleId)}/sections/${encodeURIComponent(credential.sectionKey)}/ready`,
        JSON.stringify({
          attemptId: credential.attemptId,
          contentReady: true,
          localStorageReady: true,
          audioReady: true,
        }),
        { headers: bearer(credential.token), timeout: "20s", tags: { operation: "ready" }, responseCallback: transient }
      )
    )
  );
  trend.add(Date.now() - started);
  const data = body?.data;
  if (data?.status !== "active" || !data.startedAt || !data.deadlineAt) {
    failOp("ready", `readiness did not activate the section for VU ${__VU}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return data;
}

function command(credential, index) {
  const questionId = credential.questions[index % credential.questions.length];
  const version = (versions[questionId] || 0) + 1;
  versions[questionId] = version;
  return {
    writeId: `itp-${runId}-${__VU}-${saveSeq}-${index}`,
    questionId,
    clientVersion: version,
    response: { answer: answerFor(version), markedForReview: false, eliminatedOptions: [], annotations: [] },
  };
}

function postBatch(credential, body, operation, trend) {
  const started = Date.now();
  const serialized = JSON.stringify(body);
  const ack = parse(
    request(operation, () =>
      http.post(attemptUrl(credential, "responses:batch"), serialized, {
        headers: bearer(credential.token),
        timeout: "20s",
        tags: { operation },
        responseCallback: transient,
      })
    )
  );
  trend.add(Date.now() - started);
  const acks = ack?.acknowledgements;
  const want = operation === "replay" ? "duplicate" : "applied";
  if (
    !Array.isArray(acks) ||
    acks.length !== body.commands.length ||
    acks.some(
      (a, i) =>
        a.writeId !== body.commands[i].writeId ||
        a.clientVersion !== body.commands[i].clientVersion ||
        a.outcome !== want
    )
  ) {
    failOp(operation, `${operation} acknowledgement mismatch for VU ${__VU}: ${JSON.stringify(acks).slice(0, 300)}`);
  }
  answerCommands.add(body.commands.length, { operation });
}

function save(credential, size, operation, trend) {
  const commands = [];
  for (let i = 0; i < size; i += 1) commands.push(command(credential, saveSeq + i));
  const body = { leaseEpoch: epochs.leaseEpoch, controlEpoch: epochs.controlEpoch, commands };
  saveSeq += size;
  postBatch(credential, body, operation, trend);
  lastSave = body;
}

function poll(credential) {
  const started = Date.now();
  const response = request(
    "poll",
    () =>
      http.get(`${baseUrl}/api/v1/student/sessions/${encodeURIComponent(credential.scheduleId)}/runtime`, {
        headers: bearer(credential.token, pollETag ? { "if-none-match": pollETag } : {}),
        timeout: "20s",
        tags: { operation: "poll" },
        responseCallback: transient,
      }),
    [200, 304]
  );
  pollMs.add(Date.now() - started);
  pollETag = response.headers.Etag || response.headers.ETag || pollETag;
}

function submit(credential) {
  loadEpochs(credential);
  const body = JSON.stringify({
    submissionId: uuidV4(),
    leaseEpoch: epochs.leaseEpoch,
    controlEpoch: epochs.controlEpoch,
    finalCommands: [],
  });
  const send = (trend) => {
    const started = Date.now();
    const receipt = parse(
      request("submit", () =>
        http.post(attemptUrl(credential, "submit"), body, {
          headers: bearer(credential.token),
          timeout: "20s",
          tags: { operation: "submit" },
          responseCallback: transient,
        })
      )
    );
    trend.add(Date.now() - started);
    if (receipt?.status !== "submitted" || !receipt.finalResponseDigest) {
      failOp("submit", `submit did not seal for VU ${__VU}: ${JSON.stringify(receipt).slice(0, 300)}`);
    }
    return receipt;
  };
  const first = send(submitMs);
  // Lost acknowledgement: the same submission returns the committed receipt.
  const again = send(resubmitMs);
  if (again.finalResponseDigest !== first.finalResponseDigest || again.submissionId !== first.submissionId) {
    failOp("submit", `resubmit changed the receipt for VU ${__VU}`);
  }
}

export default function () {
  const credential = credentials[__VU - 1];
  if (!credential) failOp("bind", `no credential bound to VU ${__VU}`);
  if (phase !== "steady" && startSpreadSeconds > 0) sleep(((__VU - 1) / maxVUs) * startSpreadSeconds);
  if (phase === "ready") {
    const first = ready(credential, readyMs);
    const retry = ready(credential, readyRetryMs);
    if (retry.startedAt !== first.startedAt || retry.deadlineAt !== first.deadlineAt) {
      failOp("ready", `readiness retry allocated new time for VU ${__VU}`);
    }
    operations.add(2, { operation: "ready" });
    return;
  }
  if (phase === "submit") {
    submit(credential);
    operations.add(2, { operation: "submit" });
    return;
  }
  const startedAt = Date.now();
  if (!epochs) loadEpochs(credential);
  const slot = (__ITER * 37 + __VU * 11) % 100;
  let operation = "save";
  if (slot < replayPercent) operation = lastSave ? "replay" : "save";
  else if (slot < replayPercent + pollPercent) operation = "poll";
  else if (slot < replayPercent + pollPercent + flushPercent) operation = "flush";
  if (operation === "replay") postBatch(credential, lastSave, "replay", replayMs);
  else if (operation === "poll") poll(credential);
  else if (operation === "flush") save(credential, flushSize, "flush", flushMs);
  else save(credential, 1, "save", saveMs);
  operations.add(1, { operation });
  const rest = intervalSeconds * 1000 - (Date.now() - startedAt);
  if (rest > 0) sleep(rest / 1000);
}
