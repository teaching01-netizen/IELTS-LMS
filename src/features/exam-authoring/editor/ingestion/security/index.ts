/**
 * Phase 01 — security barrel.
 */
export type { EnforceLimitsOutcome } from "./guards";
export { capTable, enforceLimits } from "./guards";
export type { StripExecutablesOutcome } from "./policy";
export {
  BLOCKED_INLINE_PATTERNS,
  BLOCKED_URL_SCHEMES,
  stripExecutables,
} from "./policy";
