/**
 * The single route decision for every committed bootstrap payload (Phase 04
 * commit layer, C1): at most one phase action, computed from the payload
 * argument plus the pre-commit phase — never from state read back after an
 * await.
 *
 * The hint says which producer committed the payload (poll, the first
 * bootstrap, or a mutation response). Mutation responses route through the
 * same table as polls so a stale one cannot take a privileged bypass around
 * the monotonic commit guard (audit SAT-005).
 *
 * Pure: no React, no gateway, no clock. `identity` is the runner's own
 * schedule/candidate so a result-carrying payload can complete the runner.
 */

import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
} from "../contracts/assessmentDelivery";
import type { SatRunnerAction, SatRunnerState } from "./satRunnerReducer";
import {
  findActiveAttempt,
  findAttemptForModule,
  findPendingAttempt,
  matchesFinalModuleState,
  moduleForAttempt,
  sectionForModule,
} from "./satRuntimeSelectors";
import { timingForAttempt } from "../domain/satTiming";
import { resolveSatExamToolPolicy, toSatToolCapabilities } from "../domain/satToolPolicy";

export type SatCommitHint =
  | { kind: "bootstrap" }
  | { kind: "poll" }
  | { kind: "startModule"; moduleId: string }
  | { kind: "submitModule"; moduleId: string };

export interface SatCommitIdentity {
  scheduleId: string;
  candidateId: string;
}

/**
 * Pure route computation for a module-opening commit, shared by the directions
 * safety net and the commit layer so both produce the identical routeToModule
 * action. Null when the payload does not resolve a started module to route
 * into.
 */
export function startModuleRouteAction(
  payload: AssessmentDeliveryBootstrap,
  module: AssessmentDeliveryModule,
): SatRunnerAction | null {
  const section = sectionForModule(payload, module.id);
  const attempt = findAttemptForModule(payload, module.id);
  if (!section || !attempt?.startedAt) return null;
  const timing = timingForAttempt(payload, attempt);
  const sectionKey = section.sectionKey === "math" ? "math" : "reading-writing";
  return {
    type: "routeToModule",
    sectionKey,
    moduleKey: module.moduleKey,
    questionIds: module.questions.map((question) => question.examQuestionId),
    startedAt: timing.startedAt,
    endsAt: timing.endsAt,
    toolCapabilities: toSatToolCapabilities(
      resolveSatExamToolPolicy(sectionKey, module.toolPolicy),
    ),
  };
}

export function decideSatCommitRoute(
  preState: SatRunnerState,
  payload: AssessmentDeliveryBootstrap,
  hint: SatCommitHint,
  identity: SatCommitIdentity,
): SatRunnerAction | null {
  switch (hint.kind) {
    case "bootstrap":
      return preState.phase === "loading"
        ? ({ type: "bootstrapLoaded", assessmentId: payload.versionId } as const)
        : null;
    case "startModule": {
      // SAT-005: mutation responses use the same decision path as polls.
      const activeModule = moduleForAttempt(payload, findActiveAttempt(payload));
      if (!activeModule) return null;
      return startModuleRouteAction(payload, activeModule);
    }
    case "submitModule": {
      // SAT-005: the post-submit route (submit / break / directions) is derived
      // from the payload argument, never from data read back after await.
      const nextAttempt = findPendingAttempt(payload);
      const nextModule = moduleForAttempt(payload, nextAttempt);
      if (!nextModule) return { type: "submit" } as const;
      const currentSection = sectionForModule(payload, hint.moduleId);
      const nextSection = sectionForModule(payload, nextModule.id);
      if (currentSection && nextSection && nextSection.id !== currentSection.id) {
        return {
          type: "startBreak",
          nextSectionKey: nextSection.sectionKey === "math" ? "math" : "reading-writing",
          resumeAt: nextAttempt?.availableAt ?? payload.serverNow,
        } as const;
      }
      return { type: "showDirections" } as const;
    }
    case "poll": {
      if (payload.result && preState.phase !== "complete") {
        return {
          type: "recover",
          state: {
            phase: "complete",
            scheduleId: identity.scheduleId,
            candidateId: identity.candidateId,
            assessmentId: payload.versionId,
            resultId: payload.result.id,
          },
        } as const;
      }
      if (
        (preState.phase === "module" || preState.phase === "review") &&
        "moduleKey" in preState
      ) {
        const currentModule = payload.sections
          .flatMap((section) => section.modules)
          .find((candidate) => candidate.moduleKey === preState.moduleKey);
        const attempt = currentModule
          ? findAttemptForModule(payload, currentModule.id)
          : undefined;
        if (attempt && matchesFinalModuleState(attempt.state)) {
          const nextAttempt = findPendingAttempt(payload);
          const nextModule = moduleForAttempt(payload, nextAttempt);
          if (nextModule && nextModule.moduleKey !== preState.moduleKey) {
            return { type: "showDirections" } as const;
          }
          if (!nextModule) {
            // SAT-002: the last module was finalized server-side (timeout
            // reconciler / another client) while the result is absent. Begin
            // finalization from wherever the student is — waiting for a Review
            // visit left the runner stuck in `module` with no retry.
            return { type: "submit" } as const;
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
}
