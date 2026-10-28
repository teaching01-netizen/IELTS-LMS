export interface RecoveryTarget {
  sectionKey: string;
  moduleAttemptId?: string;
  moduleId?: string;
}
export interface RecoveryEligibility {
  eligible: boolean;
  reason?: string;
}
export interface RecoveryStage extends RecoveryTarget {
  label: string;
  state?: string;
  originalDeadlineAt?: string;
  current: boolean;
  eligibility: RecoveryEligibility;
}
export type RecoveryGrantState =
  | "issued"
  | "claimed"
  | "started"
  | "expired"
  | "replaced"
  | "restored"
  | "locked";
export interface RecoveryGrant {
  grantId: string;
  state: RecoveryGrantState;
  expiresAt: string;
  requestedRemainingSeconds?: number;
  grantRevision: number;
  secretsAvailable?: boolean;
}
export interface RecoveryOptions {
  issuanceEnabled: boolean;
  issuance?: RecoveryIssued;
  attemptId: string;
  scheduleId: string;
  candidateName: string;
  examTitle: string;
  providerKey: string;
  leaseEpoch: number;
  controlEpoch: number;
  serverNow: string;
  lastServerSaveAt?: string;
  targets: RecoveryStage[];
  eligibility: RecoveryEligibility;
  grant?: RecoveryGrant;
}
export interface RecoveryIssued {
  grant: RecoveryGrant;
  linkSecret?: string;
  code?: string;
  recoveryPath?: string;
  serverNow: string;
}
export interface RecoveryReady {
  grantId: string;
  state: RecoveryGrantState;
  grantRevision: number;
  candidateName: string;
  examTitle: string;
  providerKey: string;
  serverNow: string;
  claimExpiresAt?: string;
  target: RecoveryTarget & { label: string };
  timePolicy: {
    mode: string;
    awardedSeconds?: number;
    originalDeadlineAt?: string;
    remainingSeconds?: number;
  };
  checkpoint: {
    responsesSaved: number;
    lastServerSaveAt?: string;
    audio?: Array<{ partId: string; mediaRevision: string; positionMs: number }>;
  };
}
export interface RecoveryBegin {
  recovery: {
    grantId: string;
    routePath: string;
    attemptId: string;
    scheduleId: string;
    candidateId: string;
  };
  clientSessionId: string;
  attemptCredential: { attemptToken: string; expiresAt: string };
}

export function parseRecoveryAward(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error("กรอกเวลาเป็น นาที:วินาที เช่น 08:00");
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  if (seconds < 1 || seconds > 86400) throw new Error("กำหนดเวลาระหว่าง 00:01 ถึง 1440:00");
  return seconds;
}
export function recoveryClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}
export function recoveryTargetKey(target: RecoveryTarget) {
  return `${target.sectionKey}/${target.moduleAttemptId ?? ""}/${target.moduleId ?? ""}`;
}

/** Staff-facing label per grant state; also the dialog's status line. */
export const recoveryGrantStateLabel: Record<RecoveryGrantState, string> = {
  issued: "รอเปิดบนเครื่องใหม่",
  claimed: "เครื่องใหม่พร้อมแล้ว",
  started: "ย้ายเครื่องแล้ว",
  expired: "รหัสหมดอายุ",
  replaced: "ออกรหัสใหม่แล้ว",
  restored: "กลับไปใช้เครื่องเดิม",
  locked: "รหัสถูกล็อก กรุณาออกรหัสใหม่",
};

// Copy keyed by the server's stable `details.reason`. Backend messages are
// English diagnostics and never shown directly in this Thai surface.
const recoveryReasonCopy: Record<string, string> = {
  RECOVERY_INVALID_CREDENTIALS: "รหัสหรือลิงก์ไม่ถูกต้อง ตรวจสอบรหัสแล้วลองอีกครั้ง",
  RECOVERY_CODE_LOCKED: "กรอกรหัสผิดหลายครั้ง ขอรหัสใหม่จากเจ้าหน้าที่",
  RECOVERY_EXPIRED: "รหัสหมดอายุแล้ว ขอรหัสใหม่จากเจ้าหน้าที่",
  RECOVERY_SUPERSEDED: "รหัสนี้ถูกแทนที่แล้ว ใช้รหัสล่าสุดจากเจ้าหน้าที่",
  RECOVERY_CLAIMED: "รหัสนี้ถูกใช้บนเครื่องอื่นแล้ว ขอรหัสใหม่จากเจ้าหน้าที่",
  RECOVERY_STALE: "ข้อมูลเปลี่ยนไปแล้ว ระบบโหลดสถานะล่าสุดให้ ตรวจสอบแล้วลองอีกครั้ง",
  RECOVERY_TIME_REQUIRED: "หมดเวลาแล้ว ต้องกำหนดเวลาเหลือใหม่ก่อนทำต่อ",
  RECOVERY_INVALID_TIME: "กำหนดเวลาระหว่าง 00:01 ถึง 1440:00",
  RECOVERY_PAUSED: "ผู้คุมสอบหยุดการสอบชั่วคราว รอให้เริ่มต่อก่อน",
  RECOVERY_MANUAL_SUBMIT: "นักเรียนส่งข้อสอบส่วนนี้แล้ว ไม่สามารถเปิดทำต่อได้",
  RECOVERY_CONTROLLED_END: "การสอบนี้ถูกปิดโดยเจ้าหน้าที่ ไม่สามารถเปิดทำต่อได้",
  RECOVERY_INELIGIBLE: "ส่วนนี้ไม่สามารถเปิดทำต่อได้",
  RECOVERY_DISABLED: "ยังไม่เปิดใช้งานการย้ายเครื่องบนระบบนี้",
  RECOVERY_UNAVAILABLE: "ระบบย้ายเครื่องไม่พร้อมใช้งานชั่วคราว ลองอีกครั้ง",
  RECOVERY_SECRET_UNAVAILABLE: "ระบบย้ายเครื่องไม่พร้อมใช้งานชั่วคราว ลองอีกครั้ง",
  OPERATION_ID_CONFLICT: "คำขอนี้ถูกใช้ไปแล้ว โหลดหน้าใหม่แล้วลองอีกครั้ง",
};

/** Reasons after which retrying the same grant can never succeed. */
const terminalRecoveryReasons = new Set([
  "RECOVERY_CODE_LOCKED",
  "RECOVERY_EXPIRED",
  "RECOVERY_SUPERSEDED",
  "RECOVERY_CLAIMED",
  "RECOVERY_MANUAL_SUBMIT",
  "RECOVERY_CONTROLLED_END",
  "RECOVERY_INELIGIBLE",
]);

export function recoveryErrorReason(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return undefined;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

export function recoveryErrorCopy(error: unknown, fallback: string): string {
  const reason = recoveryErrorReason(error);
  return (reason && recoveryReasonCopy[reason]) ?? fallback;
}

export function isTerminalRecoveryError(error: unknown): boolean {
  const reason = recoveryErrorReason(error);
  return reason !== undefined && terminalRecoveryReasons.has(reason);
}

/** Accepts pasted codes such as "123 456" or "123-456"; keeps digits only. */
export function normalizeRecoveryCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}
