import {
  storeAttemptCredential as storeCredential,
  type AttemptCredentialRef,
  type BackendAttemptCredential,
} from "@services/attemptCredentialAdapter";

export function storeAttemptCredential(
  attempt: AttemptCredentialRef,
  credential: BackendAttemptCredential | null | undefined
): void {
  storeCredential(attempt, credential);
}
