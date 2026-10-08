import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ summaries: {} as Record<string, unknown>, fetch: vi.fn(), start: vi.fn() }));

vi.mock("../../../../proctor/api/proctorQueries", () => ({
  proctorKeys: { sessions: (key?: string) => ["proctor", "sessions", key] },
  fetchProctorSessionSummaries: state.fetch,
  useProctorSessionSummaries: () => state.summaries,
}));
vi.mock("../../../../proctor/application/proctorFacade", () => ({
  proctorFacade: { delivery: { startRuntime: state.start, resumeRuntime: vi.fn() } },
}));

import { useAccessSessionBindings } from "../useAccessSessionBindings";

function bindings(canRun = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAccessSessionBindings({ canRun, onOpenRoom: vi.fn(), onOpenResponses: vi.fn() }), { wrapper }).result.current;
}

beforeEach(() => {
  state.fetch.mockReset();
  state.start.mockReset();
  state.summaries = { data: undefined, isError: false, isFetched: false, isFetching: false };
});

describe("useAccessSessionBindings", () => {
  it("maps runtime summaries to session info keyed by schedule", () => {
    state.summaries = {
      data: [{ schedule: { id: "s1", status: "scheduled" }, runtime: { status: "live", timingModel: "cohort_section_v3" }, studentCount: 9, joinReadyCount: 9, joinTotalCount: 15 }],
      isError: false, isFetched: true, isFetching: false,
    };
    const result = bindings();
    expect(result.infoFor("s1")).toEqual({ phase: "live", timingModel: "cohort_section_v3", joined: 15, ready: 9 });
    expect(result.infoFor("other")).toBeNull();
    expect(result.stale).toBe(false);
  });

  it("treats a malformed payload as stale instead of crashing the page", () => {
    state.summaries = { data: {}, isError: false, isFetched: true, isFetching: false };
    const result = bindings();
    expect(result.infoFor("s1")).toBeNull();
    expect(result.stale).toBe(true);
  });

  it("is never stale for roles that do not read session state", () => {
    state.fetch.mockReset();
  state.start.mockReset();
  state.summaries = { data: undefined, isError: true, isFetched: true, isFetching: false };
    expect(bindings(false).stale).toBe(false);
  });
});


describe("session command confirmation", () => {
  it("reads fresh status and refuses Start when another staff member already started it", async () => {
    state.fetch.mockResolvedValue([{ schedule: { id: "s1", status: "scheduled" }, runtime: { status: "live" } }]);
    await expect(bindings().onStart("s1")).rejects.toThrow("Session status changed");
    expect(state.start).not.toHaveBeenCalled();
  });

  it("refuses commands when the staff role cannot run sessions", async () => {
    await expect(bindings(false).onStart("s1")).rejects.toThrow("permission");
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
  });

  it("does not report a lost response as proof that nothing started", async () => {
    state.fetch.mockResolvedValue([{ schedule: { id: "s1", status: "scheduled" }, runtime: { status: "not_started" } }]);
    state.start.mockResolvedValue({ success: false, error: "Network request failed" });
    await expect(bindings().onStart("s1")).rejects.toThrow("Refresh status to confirm the outcome");
  });
});
