import { describe, expect, it } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import {
  toAuthoringShellErrorState,
  toAuthoringShellState,
  type AuthoringShellState,
} from "../authoringShellLifecycle";
import type {
  AssessmentAuthoringShell,
  AssessmentAuthoringShellResult,
} from "../../contracts/assessment";

/**
 * Contract tests for the ONE place a shell response becomes a lifecycle state.
 *
 * These drive the real mapper with real ApiError instances — no mocked status
 * helpers — so the mapping cannot drift from the transport it describes. The
 * previous suite's central assertion was "404 === no editable draft", an
 * assumption that must no longer exist anywhere in the codebase.
 */

const SHELL: AssessmentAuthoringShell = {
  examId: "exam-1",
  providerKey: "sat",
  versionId: "v-1",
  versionRevision: 7,
  sections: [],
};

function apiError(status: number, code: string): ApiError {
  return new ApiError({ code, message: `${code} failure`, status });
}

function successState(result: AssessmentAuthoringShellResult): AuthoringShellState {
  return toAuthoringShellState(result);
}

describe("authoring shell lifecycle mapping", () => {
  it("200 READY -> ready with the shell", () => {
    expect(successState({ state: "READY", shell: SHELL })).toEqual({
      kind: "ready",
      shell: SHELL,
    });
  });

  it("200 NO_DRAFT -> no-draft, never an error", () => {
    expect(successState({ state: "NO_DRAFT", shell: null })).toEqual({ kind: "no-draft" });
  });

  it("READY without a shell is a contract violation, not a downgrade to no-draft", () => {
    // Collapsing this into no-draft would offer \"Open draft\" for an exam that
    // already has one, and the POST would then clone on top of it.
    const state = successState({ state: "READY", shell: null });
    expect(state.kind).toBe("error");
  });

  it("404 EXAM_NOT_FOUND -> exam-not-found", () => {
    expect(toAuthoringShellErrorState(apiError(404, "EXAM_NOT_FOUND"))).toEqual({
      kind: "exam-not-found",
    });
  });

  it("403 FORBIDDEN -> forbidden", () => {
    expect(toAuthoringShellErrorState(apiError(403, "FORBIDDEN"))).toEqual({ kind: "forbidden" });
  });

  it("500 INTERNAL -> error", () => {
    const state = toAuthoringShellErrorState(apiError(500, "INTERNAL"));
    expect(state.kind).toBe("error");
    if (state.kind === "error") {
      expect(state.error.message).toBe("INTERNAL failure");
    }
  });

  it("a non-Error rejection still produces an error state", () => {
    const state = toAuthoringShellErrorState("boom");
    expect(state.kind).toBe("error");
    if (state.kind === "error") {
      expect(state.error).toBeInstanceOf(Error);
    }
  });

  it("keeps the states mutually exclusive: exactly one state per answer", () => {
    const answers: AuthoringShellState[] = [
      successState({ state: "READY", shell: SHELL }),
      successState({ state: "NO_DRAFT", shell: null }),
      toAuthoringShellErrorState(apiError(404, "EXAM_NOT_FOUND")),
      toAuthoringShellErrorState(apiError(403, "FORBIDDEN")),
      toAuthoringShellErrorState(apiError(503, "SERVICE_UNAVAILABLE")),
    ];
    const kinds = answers.map((state) => state.kind);
    expect(kinds).toEqual(["ready", "no-draft", "exam-not-found", "forbidden", "error"]);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
