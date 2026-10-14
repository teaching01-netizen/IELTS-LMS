import type { CreateSatRoomRequest } from "../contracts/satCreateRoom";

export interface PendingSatRoomAttempt {
  operationKey: string;
  request: CreateSatRoomRequest | null;
}

const prefix = "sat-room-pending:";
const bodyLifetimeMs = 30 * 60 * 1000;
const requests = new Map<string, { request: CreateSatRoomRequest; savedAt: number }>();

export function satRoomAttemptScope(actorId: string, examId: string): string {
  return prefix + JSON.stringify([actorId, examId]);
}

/** Only the opaque key survives reload; student roster data stays in memory. */
export function readSatRoomAttempt(scope: string): PendingSatRoomAttempt | null {
  const key = sessionStorage.getItem(scope);
  if (!key) return null;
  const saved = requests.get(scope);
  if (saved && Date.now() - saved.savedAt < bodyLifetimeMs && saved.request.operationKey === key) {
    return { operationKey: key, request: saved.request };
  }
  requests.delete(scope);
  // Never expire uncertainty into permission to create another room.
  return { operationKey: key, request: null };
}

export function retainSatRoomAttempt(scope: string, request: CreateSatRoomRequest): void {
  // Fail before POST if the recovery key cannot survive navigation/reload.
  sessionStorage.setItem(scope, request.operationKey);
  requests.set(scope, { request, savedAt: Date.now() });
}

export function clearSatRoomAttempt(scope: string): void {
  sessionStorage.removeItem(scope);
  requests.delete(scope);
}
