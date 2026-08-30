export { backendPatch, backendPost, hasBackendStatusCode } from '@services/backendBridge';
export { tryBuildAttemptAuthorizationHeader } from '@services/studentAttemptRepository';
export {
  isAttemptCredentialExpiringWithin,
  refreshAttemptCredential,
  storeAttemptCredential,
  type BackendAttemptCredential,
} from '@services/attemptCredentialAdapter';
export type { ApiRequestConfig } from '@shared/api/apiClient';
