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
import { isSatPersonalTimingModel } from "../../../types/domain";

export type SatCommitHint =
  | { kind: "bootstrap" }
  | { kind: "poll" }
  | { kind: "startModule"; moduleId: string };

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
  if (
    isSatPersonalTimingModel(payload.timing.timingModel) &&
    attempt.entryStartsAt &&
    Date.parse(payload.serverNow) < Date.parse(attempt.entryStartsAt)
  ) return null;
  const timing = timingForAttempt(payload, attempt);
  const sectionKey = section.sectionKey === "math" ? "math" : "reading-writing";
  return {
    type: "routeToModule",
    sectionKey,
    // The server-selected module ID is the runtime identity; moduleKey only
    // rides along as display metadata.
    moduleId: module.id,
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
        "moduleId" in preState
      ) {
        // Identity comparison by id: a key lookup could resolve the OTHER
        // adaptive branch (or a same-key module in another section) and then
        // treat the already-finalized current module as still open.
        const currentModule = payload.sections
          .flatMap((section) => section.modules)
          .find((candidate) => candidate.id === preState.moduleId);
        const attempt = currentModule
          ? findAttemptForModule(payload, currentModule.id)
          : undefined;
        if (attempt && matchesFinalModuleState(attempt.state)) {
          const nextAttempt = findPendingAttempt(payload);
          const nextModule = moduleForAttempt(payload, nextAttempt);
          if (nextModule && nextModule.id !== preState.moduleId) {
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
