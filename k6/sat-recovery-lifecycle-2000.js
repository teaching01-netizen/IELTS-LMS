import http from "k6/http";
import { sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Trend } from "k6/metrics";

// Read-only load gate for the recovery-policy lifecycle projection. Each VU
// needs a distinct, synthetic SAT attempt that has completed initial entry.
// Use one shared schedule for the synchronized-room case; credentials may
// carry scheduleId to spread the same 2,000 attempts across many rooms.
const baseUrl = String(__ENV.K6_BASE_URL || "").replace(/\/$/, "");
const defaultScheduleId = __ENV.K6_SCHEDULE_ID || "";
const vus = Number(__ENV.K6_VUS || "2000");
const duration = __ENV.SAT_LIFECYCLE_DURATION || "2m";
const initialJitterSeconds = Number(__ENV.K6_INITIAL_JITTER_SECONDS || 0);
const pollMinSeconds = Number(__ENV.K6_POLL_MIN_SECONDS || 10);
const pollMaxSeconds = Number(__ENV.K6_POLL_MAX_SECONDS || 20);

if (__ENV.K6_CONFIRM_SAT !== "true") {
  throw new Error("Set K6_CONFIRM_SAT=true to confirm this is an isolated synthetic SAT load run.");
}
if (
  !baseUrl ||
  !Number.isInteger(vus) ||
  vus < 1 ||
  vus > 2000 ||
  !Number.isFinite(initialJitterSeconds) ||
  initialJitterSeconds < 0 ||
  !Number.isFinite(pollMinSeconds) ||
  !Number.isFinite(pollMaxSeconds) ||
  pollMinSeconds < 1 ||
  pollMaxSeconds < pollMinSeconds
) {
  throw new Error(
    "Provide K6_BASE_URL, up to 2,000 unique credentials, and valid poll/jitter settings."
  );
}
const selected = new SharedArray("SAT lifecycle credentials", () => {
  const credentials = JSON.parse(open(__ENV.K6_ATTEMPT_TOKENS_PATH || "./attempt-creds.json"));
  if (!Array.isArray(credentials) || credentials.length < vus) {
    throw new Error("Provide one synthetic lifecycle credential per VU.");
  }
  const rows = credentials.slice(0, vus).map((credential) => ({
    ...credential,
    scheduleId: credential.scheduleId || defaultScheduleId,
  }));
  if (
    rows.some(
      (credential) => !credential.attemptId || !credential.token || !credential.scheduleId
    ) ||
    new Set(rows.map((credential) => `${credential.scheduleId}:${credential.attemptId}`)).size !==
      vus
  ) {
    throw new Error(
      "Each VU requires a distinct {scheduleId, attemptId, token} synthetic credential."
    );
  }
  return rows;
});

const requestMs = new Trend("sat_lifecycle_state_request_ms");
const failures = new Counter("sat_lifecycle_state_failures");
const unexpected5xx = new Counter("sat_lifecycle_state_unexpected_5xx");
const projectionLeaks = new Counter("sat_lifecycle_state_projection_leaks");
const invalidPolicies = new Counter("sat_lifecycle_state_invalid_policies");

export const options = {
  scenarios: {
    lifecycle: {
      executor: "constant-vus",
      vus,
      duration,
      gracefulStop: "10s",
    },
  },
  thresholds: {
    sat_lifecycle_state_failures: ["count==0"],
    sat_lifecycle_state_unexpected_5xx: ["count==0"],
    sat_lifecycle_state_projection_leaks: ["count==0"],
    sat_lifecycle_state_invalid_policies: ["count==0"],
  },
};

export default function () {
  const credential = selected[__VU - 1];
  if (!credential) {
    failures.add(1);
    return;
  }
  if (__ITER === 0 && initialJitterSeconds > 0) {
    sleep(Math.random() * initialJitterSeconds);
  }

  const before = Date.now();
  const response = http.get(
    `${baseUrl}/api/v1/assessment-delivery/schedules/${encodeURIComponent(credential.scheduleId)}/state`,
    {
      headers: { authorization: `Bearer ${credential.token}`, accept: "application/json" },
      timeout: "10s",
    }
  );
  requestMs.add(Date.now() - before);
  if (response.status >= 500) unexpected5xx.add(1);
  if (response.status !== 200) {
    failures.add(1);
  } else {
    let state = null;
    try {
      state = response.json();
    } catch (_) {
      /* counted as an invalid projection below */
    }
    const attempt = state?.attempt;
    if (
      state?.satDeliveryPolicy?.version !== "sat_recovery_v1" ||
      attempt?.id !== credential.attemptId ||
      !Array.isArray(attempt?.moduleAttempts) ||
      attempt.moduleAttempts.length === 0
    ) {
      invalidPolicies.add(1);
    }
    if (
      !Array.isArray(state?.sections) ||
      state.sections.length !== 0 ||
      !Array.isArray(attempt?.responses) ||
      attempt.responses.length !== 0
    ) {
      projectionLeaks.add(1);
    }
  }
  sleep(pollMinSeconds + Math.random() * (pollMaxSeconds - pollMinSeconds));
}
