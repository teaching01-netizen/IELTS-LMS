import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

/**
 * Phase 02 bootstrap-waterfall route contract (flicker-test equivalent).
 *
 * A full Playwright cold-open flicker assertion is out of scope here: the
 * SAT student path has no deterministic e2e harness (sat-student-
 * accessibility.spec.ts drives the /__dev/sat-accessibility shell, not the
 * schedule-backed StudentSessionRoute), so this suite pins the same
 * invariants at the route boundary instead:
 *
 * - the !data window renders EXACTLY ONE role=status loader, in the SAT skin
 *   (sat-ui + data-sat-loading-kind probe), with zero admin-skeleton DOM;
 * - the child forwards bootstrapSeed + initialIsLoading verbatim to
 *   useSatExamController (props/forward seam — Phase 03 owns all host/branch
 *   wrapping, so this file asserts NOTHING about withCalculatorHost).
 */

const controllerArgsMock = vi.hoisted(() => ({
  seen: [] as unknown[],
}));

vi.mock("../../hooks/useSatExamController", () => ({
  useSatExamController: (args: unknown) => {
    controllerArgsMock.seen.push(args);
    return {
      state: { phase: "loading" },
      data: null,
      result: null,
      error: null,
      commands: {},
      persistence: { flush: () => Promise.resolve() },
    };
  },
}));

describe("SatStudentSessionRoute bootstrap handoff", () => {
  beforeEach(() => {
    controllerArgsMock.seen = [];
  });

  it("renders exactly one SAT-skinned loader with zero admin-skeleton DOM while bootstrap is pending", () => {
    const { container } = render(
      <SatStudentSessionRoute
        scheduleId="sched-1"
        attemptId="attempt-1"
        candidateId="cand-1"
        attemptSnapshot={null}
        runtimeSnapshot={null}
        liveSocketConnected={false}
        attemptUpdateToken={0}
        onExit={() => {}}
      />,
    );

    // Exactly one live-region loader in the window …
    expect(screen.getAllByRole("status")).toHaveLength(1);
    // … in the SAT skin (kind probe), with the bootstrap label …
    const loader = screen.getByRole("status");
    expect(loader.getAttribute("data-sat-loading-kind")).toBe("initial");
    expect(loader.classList.contains("sat-ui")).toBe(true);
    expect(screen.getByText("Loading Digital SAT…")).toBeInTheDocument();
    // … and zero admin-skeleton DOM (grey shell + admin copy).
    expect(container.querySelector(".bg-gray-50")).toBeNull();
    expect(screen.queryByText("Loading Exam…")).not.toBeInTheDocument();
  });

  it("forwards bootstrapSeed + initialIsLoading verbatim to the controller", () => {
    const seed = {
      scheduleId: "sched-1",
      attemptId: "attempt-1",
      candidateId: "cand-1",
      attemptSnapshot: null,
      runtimeSnapshot: null,
      liveSnapshotReceivedAt: 42,
      staticVersionId: "ver-3",
      attemptRevision: null,
      runtimeRevision: null,
      deliveryEtag: '"e3"',
      seedGeneration: 5,
    };
    render(
      <SatStudentSessionRoute
        scheduleId="sched-1"
        attemptId="attempt-1"
        candidateId="cand-1"
        attemptSnapshot={null}
        runtimeSnapshot={null}
        liveSocketConnected={false}
        attemptUpdateToken={0}
        bootstrapSeed={seed}
        initialIsLoading
        onExit={() => {}}
      />,
    );

    // The route renders (StrictMode-safe: the mock may capture the args once
    // per render pass — assert on the LAST forwarded call, verbatim).
    expect(controllerArgsMock.seen.length).toBeGreaterThanOrEqual(1);
    const forwarded = controllerArgsMock.seen[controllerArgsMock.seen.length - 1] as Record<
      string,
      unknown
    >;
    expect(forwarded.bootstrapSeed).toBe(seed);
    expect(forwarded.initialIsLoading).toBe(true);
    expect(forwarded.scheduleId).toBe("sched-1");
    expect(forwarded.attemptId).toBe("attempt-1");
  });
});
