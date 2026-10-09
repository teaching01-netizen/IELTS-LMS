import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ summaries: {} as Record<string, unknown> }));

vi.mock("../../../../proctor/api/proctorQueries", () => ({
  proctorKeys: { sessions: (key?: string) => ["proctor", "sessions", key] },
  useProctorSessionSummaries: () => state.summaries,
}));

import { useAccessSessionBindings } from "../useAccessSessionBindings";

function bindings(canRun = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAccessSessionBindings({ canRun, onOpenRoom: vi.fn(), onOpenResults: vi.fn() }), { wrapper }).result.current;
}

beforeEach(() => {
  state.summaries = { data: undefined, isError: false, isFetched: false, isFetching: false };
});
describe("useAccessSessionBindings", () => {
  it("maps runtime summaries to room info keyed by schedule", () => {
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

  it("is never stale for roles that do not read room state", () => {
    state.summaries = { data: undefined, isError: true, isFetched: true, isFetching: false };
    expect(bindings(false).stale).toBe(false);
  });
});
