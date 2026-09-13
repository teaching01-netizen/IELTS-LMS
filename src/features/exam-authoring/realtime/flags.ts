import {
  AUTHORING_REALTIME_FLAGS_OFF,
  type AuthoringCapabilities,
  type AuthoringRealtimeFlagName,
  type AuthoringRealtimeFlags,
} from "./contracts";

export const AUTHORING_REALTIME_FLAG_NAMES: readonly AuthoringRealtimeFlagName[] = [
  "authoring_realtime_events",
  "authoring_realtime_delivery",
  "authoring_presence",
  "authoring_conflict_compare",
];

/**
 * Frontend kill-switch env vars (VITE_ prefix per frontend convention).
 * These can only DISABLE a server-granted capability, never enable one the
 * server withheld: effective = serverCapability && !killSwitch. The server
 * remains authoritative (negotiated via the authoring.capabilities frame).
 */
export const AUTHORING_REALTIME_ENV_VARS: Record<AuthoringRealtimeFlagName, string> = {
  authoring_realtime_events: "VITE_AUTHORING_REALTIME_EVENTS",
  authoring_realtime_delivery: "VITE_AUTHORING_REALTIME_DELIVERY",
  authoring_presence: "VITE_AUTHORING_PRESENCE",
  authoring_conflict_compare: "VITE_AUTHORING_CONFLICT_COMPARE",
};

function parseBool(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/**
 * Reads the local kill-switch posture. Defaults: all flags SET (not killed)
 * is NOT the default — default is all OFF (safe) until both server grants
 * the capability and the local switch permits it (see resolveEffectiveCapabilities).
 */
export function resolveAuthoringRealtimeFlags(
  env: Record<string, unknown> = {},
): AuthoringRealtimeFlags {
  return {
    authoring_realtime_events: parseBool(env[AUTHORING_REALTIME_ENV_VARS.authoring_realtime_events]),
    authoring_realtime_delivery: parseBool(env[AUTHORING_REALTIME_ENV_VARS.authoring_realtime_delivery]),
    authoring_presence: parseBool(env[AUTHORING_REALTIME_ENV_VARS.authoring_presence]),
    authoring_conflict_compare: parseBool(env[AUTHORING_REALTIME_ENV_VARS.authoring_conflict_compare]),
  };
}

/**
 * Effective client posture: server capabilities ANDed with the local
 * kill switch. Server OFF always wins (kill switch cannot re-enable).
 */
export function resolveEffectiveCapabilities(
  server: AuthoringCapabilities,
  killSwitch: AuthoringRealtimeFlags,
): AuthoringCapabilities {
  return {
    delivery: server.delivery && killSwitch.authoring_realtime_delivery,
    presence: server.presence && killSwitch.authoring_presence,
    conflictCompare: server.conflictCompare && killSwitch.authoring_conflict_compare,
  };
}

export { AUTHORING_REALTIME_FLAGS_OFF };
export type { AuthoringCapabilities };
