import { useEffect, useRef, useState } from "react";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentPersonalBreakSnapshot,
} from "../contracts/assessmentDelivery";
import type { SatDeliveryGateway } from "../application/ports/SatDeliveryGateway";
import { isWriterSupersededRejection } from "../application/satSubmitConflicts";

/** The server's default offer lead, the replacement fallback before a measured round trip. */
const DEFAULT_LEAD_MS = 3_000;
/**
 * First-offer lead. The break arms on the Module 2 close wave, the busiest
 * moment of the exam, where the 3s server default is easily missed and four
 * missed offers need a proctor re-arm. The break clock starts at the offered
 * start, so the longer lead costs no break time.
 */
const FIRST_OFFER_LEAD_SECONDS = 6;
const MIN_LEAD_SECONDS = 3;
const MAX_LEAD_SECONDS = 12;
/** Confirmation must be able to land before the offered start. */
const CONFIRM_MARGIN_MS = 250;
/** Consecutive failed steps before the screen reports the retry state. */
const RETRY_NOTICE_AFTER = 3;
const RETRY_DELAY_MS = 1_000;

export type SatBreakEntryStep =
  | { kind: "none" }
  | { kind: "wait"; delayMs: number }
  | { kind: "arm"; leadSeconds?: number }
  | { kind: "confirm" }
  | { kind: "visible" };

/**
 * Replacement-offer lead from the measured request round trip: twice the round
 * trip plus two seconds, kept inside the server's accepted 3–12 seconds.
 */
export function satBreakReplacementLeadSeconds(roundTripMs: number): number {
  return Math.min(MAX_LEAD_SECONDS, Math.max(MIN_LEAD_SECONDS, Math.ceil((2 * roundTripMs) / 1_000) + 2));
}

/**
 * The next break-entry action for the authoritative break row. Pure: the
 * server owns every grant, this only picks which existing request to send.
 * `roundTripMs` is null until a request has been measured.
 */
export function decideSatBreakEntryStep(
  brk: Pick<AssessmentPersonalBreakSnapshot, "state" | "entryStartsAt" | "startsAt" | "entryConfirmedAt" | "entryEnteredAt">,
  serverNowMs: number,
  roundTripMs: number | null,
): SatBreakEntryStep {
  if (brk.state === "completed") return { kind: "none" };
  if (brk.state === "active") {
    // Confirmed: never re-arm. Acknowledge the first visible frame once the
    // server-issued start has arrived, so the clock cannot be reset later.
    if (brk.entryEnteredAt) return { kind: "none" };
    const startsAt = brk.startsAt ? Date.parse(brk.startsAt) : Number.NaN;
    if (Number.isFinite(startsAt) && startsAt > serverNowMs) {
      return { kind: "wait", delayMs: startsAt - serverNowMs + 1 };
    }
    return { kind: "visible" };
  }
  const offerAt = brk.state === "armed" && brk.entryStartsAt ? Date.parse(brk.entryStartsAt) : Number.NaN;
  if (!Number.isFinite(offerAt)) return { kind: "arm", leadSeconds: FIRST_OFFER_LEAD_SECONDS };
  const remaining = offerAt - serverNowMs;
  if (remaining <= 0) {
    // Only an unconfirmed, expired offer is replaced.
    return { kind: "arm", leadSeconds: satBreakReplacementLeadSeconds(roundTripMs ?? DEFAULT_LEAD_MS) };
  }
  if (roundTripMs !== null && remaining <= roundTripMs + CONFIRM_MARGIN_MS) {
    // Too little lead left to confirm in time: keep preparing and request a
    // replacement once this offer expires.
    return { kind: "wait", delayMs: remaining + 1 };
  }
  return { kind: "confirm" };
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function errorReason(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as { details?: unknown; backendDetails?: unknown };
  const details = (record.details ?? record.backendDetails) as { reason?: unknown } | undefined;
  return details && typeof details.reason === "string" ? details.reason : null;
}

/** Refusals another request cannot fix; the proctor's re-arm can. */
function isTerminalBreakRefusal(error: unknown): boolean {
  const reason = errorReason(error);
  if (reason === "BREAK_RETRY_EXHAUSTED" || reason === "ADMISSION_CLOSED") return true;
  const status = errorStatus(error);
  return status === 401 || status === 403 || isWriterSupersededRejection(error);
}

export interface UseSatBreakEntryOptions {
  /** Changes on schedule/attempt/candidate rotation. */
  identity: string;
  /** Break surface mounted, attempt live and not paused. */
  enabled: boolean;
  personalBreak: AssessmentPersonalBreakSnapshot | null;
  serverClockOffsetMs: number;
  scheduleId: string;
  attemptId: string;
  gateway: Pick<SatDeliveryGateway, "startBreak" | "enterBreak" | "markBreakVisible">;
  withControlEpoch: <T>(request: (epoch: number | null | undefined) => Promise<T>) => Promise<T>;
  /** The controller's single commit path (acceptPayloadAndRoute). */
  commit: (payload: AssessmentDeliveryBootstrap) => void;
  /** Authoritative read after an uncertain or refused request. */
  refresh: () => Promise<unknown>;
}

export interface SatBreakEntryState {
  /** Several consecutive steps failed; preparation keeps retrying. */
  retrying: boolean;
  /** A refusal only the proctor can resolve; preparation stopped. */
  blocked: string | null;
}

/**
 * One owner for scheduled-break entry: arm a server-issued future start, then
 * confirm it before it arrives, through the existing break-entry endpoints.
 * One request flight per attempt and break; results after an identity or
 * break change are ignored. A lost response is followed by an authoritative
 * read: a confirmed break resumes its deadline, and only an unconfirmed
 * expired offer is re-armed.
 */
export function useSatBreakEntry({
  identity,
  enabled,
  personalBreak,
  serverClockOffsetMs,
  scheduleId,
  attemptId,
  gateway,
  withControlEpoch,
  commit,
  refresh,
}: UseSatBreakEntryOptions): SatBreakEntryState {
  const [tick, setTick] = useState(0);
  // Preparation starts only while the student can see the break surface.
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const [failures, setFailures] = useState(0);
  const [blocked, setBlocked] = useState<{ key: string; message: string } | null>(null);
  const flightRef = useRef<string | null>(null);
  const roundTripRef = useRef<number | null>(null);
  const visibleAckedRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const identityRef = useRef(identity);
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    generationRef.current += 1;
    flightRef.current = null;
    roundTripRef.current = null;
    visibleAckedRef.current = null;
  }

  const breakId = personalBreak?.id ?? null;
  const breakKey = personalBreak
    ? `${identity}:${personalBreak.id}:${personalBreak.revision}`
    : null;
  const blockedForBreak = blocked !== null && blocked.key === breakKey ? blocked.message : null;

  useEffect(() => {
    setFailures(0);
  }, [breakId, identity]);

  useEffect(() => {
    if (!enabled || !documentVisible || !personalBreak || !breakKey || blockedForBreak) return;
    if (!gateway.startBreak || !gateway.enterBreak) return;
    if (flightRef.current !== null) return;
    const brk = personalBreak;
    const visibleKey = `${identity}:${brk.id}:${brk.entryGeneration}`;
    const step = decideSatBreakEntryStep(brk, Date.now() + serverClockOffsetMs, roundTripRef.current);
    if (step.kind === "none" || (step.kind === "visible" && (visibleAckedRef.current === visibleKey || !gateway.markBreakVisible))) {
      return;
    }
    if (step.kind === "wait") {
      const timer = window.setTimeout(() => setTick((value) => value + 1), step.delayMs);
      return () => window.clearTimeout(timer);
    }
    const generation = generationRef.current;
    const current = () => generationRef.current === generation;
    flightRef.current = breakKey;
    const started = Date.now();
    const request = (epoch: number | null | undefined): Promise<AssessmentDeliveryBootstrap> => {
      const controlEpoch = typeof epoch === "number" ? epoch : undefined;
      if (step.kind === "arm") {
        return gateway.startBreak!(scheduleId, attemptId, brk.id, {
          ...(controlEpoch === undefined ? {} : { controlEpoch }),
          ...(step.leadSeconds === undefined ? {} : { leadSeconds: step.leadSeconds }),
        });
      }
      const entry = {
        breakId: brk.id,
        generation: brk.entryGeneration,
        ...(controlEpoch === undefined ? {} : { controlEpoch }),
      };
      return step.kind === "confirm"
        ? gateway.enterBreak!(scheduleId, attemptId, entry)
        : gateway.markBreakVisible!(scheduleId, attemptId, entry);
    };
    if (step.kind === "visible") visibleAckedRef.current = visibleKey;
    void withControlEpoch(request)
      .then((payload) => {
        if (!current()) return;
        if (step.kind !== "visible") roundTripRef.current = Date.now() - started;
        commit(payload);
        setFailures(0);
      })
      .catch(async (error: unknown) => {
        if (!current()) return;
        if (step.kind === "visible") {
          // Best effort: the countdown already runs from the confirmed start.
          // Retry only a frame acknowledged a moment before the server start.
          if (errorReason(error) === "ENTRY_NOT_STARTED") visibleAckedRef.current = null;
          return;
        }
        if (isTerminalBreakRefusal(error)) {
          setBlocked({
            key: breakKey,
            message: "Your break could not be started. Please ask your proctor for help.",
          });
          return;
        }
        // The request may have committed, or the offer moved on: read the
        // authoritative break before deciding the next step.
        await refresh();
        if (!current()) return;
        setFailures((value) => value + 1);
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
      })
      .finally(() => {
        if (!current()) return;
        flightRef.current = null;
        setTick((value) => value + 1);
      });
    return undefined;
    // tick re-runs the decision after a flight or wait; the break row fields
    // are the authoritative inputs.
  }, [
    attemptId,
    blockedForBreak,
    breakKey,
    commit,
    documentVisible,
    enabled,
    gateway,
    identity,
    personalBreak,
    refresh,
    scheduleId,
    serverClockOffsetMs,
    tick,
    withControlEpoch,
  ]);

  return { retrying: failures >= RETRY_NOTICE_AFTER && !blockedForBreak, blocked: blockedForBreak };
}
