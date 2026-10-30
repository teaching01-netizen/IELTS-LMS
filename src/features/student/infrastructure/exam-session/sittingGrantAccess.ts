import {
  findSittingAttemptCredential,
  sittingAttemptAuthorizationHeaders,
} from "@services/attemptCredentialAdapter";

/**
 * Whether this browser holds an unexpired sitting grant for the route. The
 * grant is independent of the account session, so an expired login must not
 * block reload or resume. Server reads re-check the grant's binding.
 */
export function hasSittingGrant(scheduleId: string, candidateId: string): boolean {
  return findSittingAttemptCredential(scheduleId, candidateId) !== null;
}

/** Authorization header for the sitting grant, or none when absent/expired. */
export function sittingGrantHeaders(scheduleId: string, candidateId?: string): Record<string, string> {
  return sittingAttemptAuthorizationHeaders(scheduleId, candidateId);
}
