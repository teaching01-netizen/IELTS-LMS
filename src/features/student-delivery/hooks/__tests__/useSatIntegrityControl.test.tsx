import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSatIntegrityControl } from "../useSatIntegrityControl";

/**
 * Executable acceptance specification (ATDD) — SAT tab/app-switch integrity.
 *
 * Scenarios (same contract as the IELTS/ACT branch, different adapter):
 *   AC-SAT-01 hidden -> visible during a module = exactly one delivery audit
 *   AC-SAT-02 browser lifecycle noise = still one audit
 *   AC-SAT-03 two excursions = two audits
 *   AC-SAT-04 blur / keyboard (page still visible) = zero audits
 *   AC-SAT-05 directions, break, review-of-nothing, completed = zero audits
 *   AC-SAT-06 the SAT-styled warning is raised on return and cleared by
 *             acknowledgement only
 */

const apiMocks = vi.hoisted(() => ({
  heartbeat: vi.fn().mockResolvedValue({}),
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/assessmentDeliveryApi", () => ({
  assessmentDeliveryApi: apiMocks,
}));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    writable: true,
    configurable: true,
    value: state,
  });
  Object.defineProperty(document, "hidden", {
    writable: true,
    configurable: true,
    value: state === "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** One `visible -> hidden -> visible` excursion of the exam document. */
function leaveAndReturn() {
  setVisibility("hidden");
  setVisibility("visible");
}

function violations() {
  return apiMocks.recordAudit.mock.calls.filter(
    ([, , actionType]) => actionType === "VIOLATION_DETECTED",
  );
}

function renderControl(active = true) {
  return renderHook(
    ({ enforceInteractionGuards }: { enforceInteractionGuards: boolean }) =>
      useSatIntegrityControl({
        scheduleId: "schedule-1",
        attemptId: "attempt-1",
        expectedDeviceFingerprintHash: null,
        enforceInteractionGuards,
      }),
    { initialProps: { enforceInteractionGuards: active } },
  );
}

describe("useSatIntegrityControl visibility integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-SAT-01: records one TAB_SWITCH audit with the visibility evidence", () => {
    const { result } = renderControl();

    act(leaveAndReturn);

    expect(violations()).toHaveLength(1);
    expect(apiMocks.recordAudit).toHaveBeenCalledWith(
      "schedule-1",
      "attempt-1",
      "VIOLATION_DETECTED",
      expect.objectContaining({
        violationType: "TAB_SWITCH",
        severity: "medium",
        source: "page_visibility",
      }),
    );
    const payload = violations()[0]?.[3] as Record<string, unknown>;
    expect(typeof payload.hiddenAt).toBe("string");
    expect(Number.isFinite(Date.parse(String(payload.hiddenAt)))).toBe(true);
    expect(Number.isFinite(Date.parse(String(payload.returnedAt)))).toBe(true);
    expect(payload.hiddenDurationMs).toBe(
      Date.parse(String(payload.returnedAt)) - Date.parse(String(payload.hiddenAt)),
    );
    expect(typeof payload.violationId).toBe("string");
    // The browser cannot see what the student opened; never claim it can.
    expect(payload).not.toHaveProperty("openedOtherTab");
    expect(payload).not.toHaveProperty("cheated");
  });

  it("AC-SAT-06: raises the SAT hold on return, cleared only by acknowledgement", () => {
    const { result } = renderControl();

    expect(result.current.pendingTabSwitchWarning).toBeNull();

    act(leaveAndReturn);
    expect(result.current.pendingTabSwitchWarning).not.toBeNull();

    act(() => {
      result.current.acknowledgeTabSwitchWarning();
    });

    expect(result.current.pendingTabSwitchWarning).toBeNull();
    // Acknowledging is not a second violation, and not a second audit.
    expect(violations()).toHaveLength(1);
  });

  it("AC-SAT-02: one excursion under lifecycle noise stays one audit", () => {
    renderControl();

    act(() => {
      window.dispatchEvent(new Event("blur"));
      setVisibility("hidden");
      setVisibility("hidden");
      window.dispatchEvent(new Event("pagehide"));
      setVisibility("visible");
      setVisibility("visible");
      window.dispatchEvent(new Event("blur"));
    });

    expect(violations()).toHaveLength(1);
  });

  it("AC-SAT-03: two excursions are two audits", () => {
    renderControl();

    act(() => {
      leaveAndReturn();
      leaveAndReturn();
    });

    expect(violations()).toHaveLength(2);
  });

  it("AC-SAT-04: blur and keyboard focus loss while the page stays visible is not a switch", () => {
    const { result } = renderControl();

    act(() => {
      window.dispatchEvent(new Event("blur"));
      setVisibility("visible");
      window.dispatchEvent(new Event("blur"));
    });

    expect(violations()).toHaveLength(0);
    expect(result.current.pendingTabSwitchWarning).toBeNull();
  });

  it("AC-SAT-05: directions, break and completion phases record nothing", () => {
    const { result, rerender } = renderControl(false);

    act(leaveAndReturn);

    expect(violations()).toHaveLength(0);
    expect(result.current.pendingTabSwitchWarning).toBeNull();

    // Still nothing once the student is answering only if the phase says so:
    // the assertion above is the same `enforceInteractionGuards` signal the
    // controller passes for every non-answering phase.
    rerender({ enforceInteractionGuards: false });
    act(leaveAndReturn);
    expect(violations()).toHaveLength(0);
  });

  it("does not audit a hide that started before the answering phase", () => {
    const { rerender } = renderControl(false);

    act(() => {
      setVisibility("hidden");
    });
    // The module opens while the student is still away.
    rerender({ enforceInteractionGuards: true });
    act(() => {
      setVisibility("visible");
    });

    expect(violations()).toHaveLength(0);
  });
});

/**
 * Executable acceptance specification (ATDD) — SAT context-menu guard.
 *
 *   AC-SAT-07 answering phases: the menu is prevented AND audited as CONTEXT_MENU
 *   AC-SAT-08 non-answering phases: the menu is left to the browser, no audit
 *
 * This contract is provider-specific and therefore has to live here: the IELTS
 * branch's context-menu guard is `StudentKeyboardProvider`, which never mounts
 * on the SAT route. This hook IS the SAT branch's context-menu protection, so a
 * regression here is invisible from the IELTS side and vice versa.
 */
describe("useSatIntegrityControl context menu guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setVisibility("visible");
  });

  it("AC-SAT-07: prevents the context menu and records one CONTEXT_MENU audit while answering", () => {
    renderControl(true);

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(violations()).toHaveLength(1);
    expect(violations()[0]?.[3]).toEqual(
      expect.objectContaining({
        violationType: "CONTEXT_MENU",
        interactionSurface: "exam",
      }),
    );
  });

  it("AC-SAT-08: leaves the context menu to the browser outside the answering phases", () => {
    renderControl(false);

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });

    // Directions, break, complete and terminated are not exam surfaces: the
    // guard is phase-scoped exactly like the visibility rule beside it.
    expect(event.defaultPrevented).toBe(false);
    expect(violations()).toHaveLength(0);
  });

  it("stops protecting once the answering phase ends", () => {
    const { rerender } = renderControl(false);

    rerender({ enforceInteractionGuards: true });
    const duringModule = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(duringModule);
    });
    expect(duringModule.defaultPrevented).toBe(true);

    rerender({ enforceInteractionGuards: false });
    const afterSubmit = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(afterSubmit);
    });
    expect(afterSubmit.defaultPrevented).toBe(false);
    // Cleanup must not leave a second listener behind.
    expect(violations()).toHaveLength(1);
  });
});
