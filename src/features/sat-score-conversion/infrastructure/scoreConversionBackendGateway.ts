/**
 * The feature's only door to the legacy `@services` transport. Every other
 * module in `sat-score-conversion` imports the backend client from here, which
 * keeps the architecture guard's approved-adapter list to one directory per
 * feature (see src/test/architecture/README.md).
 */
export { backendGet, backendPost, backendPut, hasBackendStatusCode } from '@services/backendBridge';
