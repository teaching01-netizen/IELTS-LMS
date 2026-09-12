/**
 * Shared response-durability status mapper (repair-plan WP5).
 *
 * Single owner of the WP4 UX status vocabulary used by BOTH the IELTS
 * StudentAttemptProvider and the SAT useSatResponsePersistence hook, so the
 * two apps cannot drift ("saved" vs "needs attention") under exam stress.
 *
 * SINGLE PATH: both providers import mapEngineStatus (and the gate copy
 * below) from THIS module. There are no forked status literals and no forked
 * gate copy in the providers — the mapper-contract test asserts both import
 * sites. useResponseDurabilityStatus (below) has zero in-src consumers and
 * is kept only as a documented optional helper; providers read the engine
 * directly inside their own status/state publishes (they need per-render
 * pending/quarantine counts the hook does not own). Do not add a second
 * mapper or a second gate-copy string.
 *
 * Status vocabulary (fixed): saving | saved_locally | blocked_attention |
 * conflict | saved | error. Only server-acknowledged writes report "saved".
 * Blocked / unacked / quarantined drafts stay visible with an explicit state.
 *
 * This module imports types only (plus react for the hook). No storage
 * imports here and none are added to the providers.
 */

import { useMemo } from "react";
import type { DurabilitySyncStatus } from "./types";

export type UnifiedDurabilityDisplay =
  | "saving"
  | "saved_locally"
  | "blocked_attention"
  | "conflict"
  | "saved"
  | "error";

/**
 * Shared exam-stress-safe submit-gate copy (WP4/WP5). Single owner next to
 * the mapper so IELTS and SAT cannot drift. Zero behavior change: byte-
 * identical to the pre-extract provider strings.
 *
 * Providers throw this (with the blocked count interpolated) when blocked or
 * quarantined drafts are present at submit time; the engine guard
 * ("Blocked drafts need attention before submit. ...") stays as the
 * provider-independent backstop (never surfaced verbatim to students).
 */
export function blockedSubmitGateMessage(blockedCount: number, quarantinedCount: number): string {
  if (blockedCount > 0) {
    const noun = blockedCount === 1 ? "question" : "questions";
    return "Your latest answer is kept on this device and needs attention before submit (" + blockedCount + " " + noun + "). Re-checking with the exam usually clears this; if it does not, ask your proctor before submitting.";
  }
  return "Some saved answers need review before submit (" + quarantinedCount + " kept safely on this device). Ask your proctor before submitting.";
}

/**
 * Outcome of a best-effort reconcileBlockedResponse call. "reconciled" means
 * the question is no longer blocked afterwards; "not-blocked" means there
 * was nothing to do; "refusal" means the engine refused (lease fence,
 * terminal state, server-newer, superseded, in-progress); "error:*" carries
 * the exception message when the call itself threw.
 */
export type ReconcileBlockedResult = "reconciled" | "not-blocked" | "refusal" | `error:${string}`;

/**
 * Map an engine DurabilitySyncStatus + blocked count to the shared display
 * vocabulary. BANNED: never map unacked/blocked work to "saved".
 */
export function mapEngineStatus(
  status: DurabilitySyncStatus,
  blockedCount: number
): UnifiedDurabilityDisplay {
  const blocked = Number.isFinite(blockedCount) && blockedCount > 0;
  // Blocked wins over every raw status: even a "synced" engine with blocked
  // drafts must show "needs attention", never "saved".
  if (status === "blocked_attention" || blocked) return "blocked_attention";
  if (status === "conflict_fenced" || status === "conflict_terminal") return "conflict";
  if (status === "durability_fault") return "error";
  if (status === "saved_locally") return "saved_locally";
  if (status === "saving") return "saving";
  // "synced" is the only status that reports "saved": only server-acked
  // writes ever reach it.
  return "saved";
}

/**
 * Structural engine shape. The real DurableResponseEngine satisfies this
 * structurally; the mapper never imports the engine implementation.
 */
export interface DurabilityStatusEngineLike {
  getStatus(): DurabilitySyncStatus;
  getBlockedQuestionIds(): string[];
  getQuarantined(): readonly unknown[];
}

export type DurabilityStatusEngineSource =
  | DurabilityStatusEngineLike
  | { current: DurabilityStatusEngineLike | null }
  | (() => DurabilityStatusEngineLike | null)
  | null
  | undefined;

function unwrapEngine(source: DurabilityStatusEngineSource): DurabilityStatusEngineLike | null {
  if (!source) return null;
  if (typeof source === "function") {
    try {
      return (source as () => DurabilityStatusEngineLike | null)() ?? null;
    } catch {
      return null;
    }
  }
  const maybeRef = source as { current?: DurabilityStatusEngineLike | null };
  if (typeof maybeRef.current !== "undefined") return maybeRef.current ?? null;
  return source as DurabilityStatusEngineLike;
}

export interface ResponseDurabilityStatus {
  display: UnifiedDurabilityDisplay;
  blockedIds: string[];
  blockedCount: number;
  quarantinedCount: number;
  needsAttention: boolean;
}

/**
 * Read the shared durability display for an engine (ref object, getter, or
 * direct instance). Computed synchronously each render: providers re-render on
 * engine onStatusChange/onStateChange, which refreshes this hook. A null
 * engine reports "saving" (never "saved") so UI cannot claim durability it
 * has not measured.
 */
export function useResponseDurabilityStatus(
  source: DurabilityStatusEngineSource
): ResponseDurabilityStatus {
  const engine = unwrapEngine(source);

  let status: DurabilitySyncStatus = "saving";
  let freshBlockedIds: string[] = [];
  let quarantinedCount = 0;
  if (engine) {
    try {
      status = engine.getStatus();
    } catch {
      status = "saving";
    }
    try {
      const ids = engine.getBlockedQuestionIds() ?? [];
      freshBlockedIds = Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      freshBlockedIds = [];
    }
    try {
      quarantinedCount = engine.getQuarantined()?.length ?? 0;
    } catch {
      quarantinedCount = 0;
    }
  }

  // Stabilize identity across renders while the set is unchanged so consumers
  // can safely depend on blockedIds without effect loops.
  const blockedKey = freshBlockedIds.join("");
  const blockedIds = useMemo<string[]>(
    () => freshBlockedIds.slice(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockedKey]
  );
  const blockedCount = blockedIds.length;
  const display = mapEngineStatus(status, blockedCount);
  const needsAttention =
    blockedCount > 0 ||
    quarantinedCount > 0 ||
    display === "blocked_attention" ||
    display === "conflict" ||
    display === "error";

  return { display, blockedIds, blockedCount, quarantinedCount, needsAttention };
}
