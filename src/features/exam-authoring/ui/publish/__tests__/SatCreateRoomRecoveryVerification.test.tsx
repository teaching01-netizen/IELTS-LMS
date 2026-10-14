import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../../shared/api-client/errors";
import type { SatRoomFields } from "../../../contracts/satCreateRoom";

const mocks = vi.hoisted(() => ({ create: vi.fn(), operation: vi.fn(), refresh: vi.fn(), actor: "staff-1" }));
vi.mock("../../../../auth/authSession", () => ({
  useOptionalAuthSession: () => ({ session: { user: { id: mocks.actor } } }),
}));
vi.mock("../../../api/satCreateRoomApi", () => ({ satCreateRoomApi: mocks }));
vi.mock("../../../api/examQueries", () => ({
  useExamQuery: () => ({ refetch: async () => ({ data: { revision: 18 } }) }),
}));
vi.mock("../../../application/authoringShellLifecycle", () => ({
  useAuthoringShellLifecycle: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../../../realtime/coedit", () => ({ useSatAuthoringCollaboration: () => null }));
vi.mock("../../../api/authoringQueryEffects", () => ({
  authoringEffects: { published: vi.fn(), accessChanged: vi.fn() },
}));

import { useCreateSatRoom } from "../useCreateSatRoom";

const fields: SatRoomFields = {
  name: "Same human request", audienceType: "anyone", accessMode: "student_code",
  availabilityType: "anytime", selectedStudents: [],
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(({ examId }) => useCreateSatRoom(examId), {
    initialProps: { examId: "exam-1" },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  sessionStorage.clear();
  mocks.actor = "staff-1";
  mocks.refresh.mockResolvedValue({ kind: "no-draft" });
});

describe("SAT room recovery verification regressions", () => {
  it("retains the unresolved key and request when its owner unmounts", async () => {
    mocks.create.mockRejectedValue(new ApiError({ code: "SERVICE_UNAVAILABLE", status: 503, message: "ACK lost" }));
    const first = mount();
    await act(async () => { await first.result.current.submit(fields); });
    expect(first.result.current.hasUnresolvedAttempt).toBe(true);
    const originalKey = mocks.create.mock.calls[0]![1].operationKey;
    first.unmount();

    const second = mount();
    expect(second.result.current.hasUnresolvedAttempt).toBe(true);
    await act(async () => { await second.result.current.submit(fields); });
    expect(mocks.create).toHaveBeenCalledOnce();
    await act(async () => { await second.result.current.retryUnknown(); });
    expect(mocks.create.mock.calls[1]![1].operationKey).toBe(originalKey);
    second.unmount();
  });

  it("retains the key on a generic 404 that may follow a committed legacy attempt", async () => {
    // CreateRoom can commit and then Get(linkID) return NOT_FOUND if the room
    // was deleted before the post-commit read (service.go:451).
    mocks.create.mockRejectedValue(new ApiError({ code: "NOT_FOUND", status: 404, message: "Access link was not found." }));
    const view = mount();
    await act(async () => { await view.result.current.submit(fields); });
    expect(view.result.current.hasUnresolvedAttempt).toBe(true);
    const originalKey = mocks.create.mock.calls[0]![1].operationKey;
    await act(async () => { await view.result.current.submit(fields); });
    expect(mocks.create).toHaveBeenCalledOnce();
    await act(async () => { await view.result.current.retryUnknown(); });
    expect(mocks.create.mock.calls[1]![1].operationKey).toBe(originalKey);
    view.unmount();
  });

  it("clears recovery state after the definitive Classroom-disabled refusal", async () => {
    mocks.create
      .mockRejectedValueOnce(new ApiError({ code: "SAT_CLASSROOM_DISABLED", status: 503, message: "Classroom disabled" }))
      .mockResolvedValueOnce({ room: { id: "practice-room" }, version: { createdNow: false } });
    const view = mount();

    await act(async () => { await view.result.current.submit({ ...fields, satSessionMode: "classroom" }); });
    expect(view.result.current.hasUnresolvedAttempt).toBe(false);
    expect(view.result.current.state.status).toBe("failed");
    expect(sessionStorage.length).toBe(0);

    await act(async () => { await view.result.current.submit(fields); });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1]![1].operationKey).not.toBe(mocks.create.mock.calls[0]![1].operationKey);
    view.unmount();
  });

  it("keeps an in-progress 409 ambiguous and replays the identical request", async () => {
    mocks.create.mockRejectedValue(new ApiError({ code: "OPERATION_IN_PROGRESS", status: 409, message: "Still running" }));
    const view = mount();
    await act(async () => { await view.result.current.submit(fields); });
    expect(view.result.current.hasUnresolvedAttempt).toBe(true);
    await act(async () => { await view.result.current.retryUnknown(); });
    expect(mocks.create.mock.calls[1]![1]).toEqual(mocks.create.mock.calls[0]![1]);
    view.unmount();
  });

  it("retains only the opaque recovery key after the roster body expires", async () => {
    mocks.create.mockRejectedValue(new ApiError({ code: "SERVICE_UNAVAILABLE", status: 503, message: "ACK lost" }));
    const first = mount();
    await act(async () => { await first.result.current.submit({ ...fields, name: "Private roster label" }); });
    const key = mocks.create.mock.calls[0]![1].operationKey;
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(key);
    first.unmount();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60 * 1000);
    const second = mount();
    expect(second.result.current.hasUnresolvedAttempt).toBe(true);
    expect(second.result.current.canRetryUnknown).toBe(false);
    mocks.operation.mockResolvedValue({ room: { id: "original" }, version: { createdNow: false } });
    await act(async () => { await second.result.current.checkStatus(); });
    expect(mocks.operation).toHaveBeenCalledWith(key);
    expect(second.result.current.hasUnresolvedAttempt).toBe(false);
    expect(sessionStorage.length).toBe(0);
    second.unmount();
  });

  it("does not restore another staff member's pending attempt", async () => {
    mocks.create.mockRejectedValue(new ApiError({ code: "SERVICE_UNAVAILABLE", status: 503, message: "ACK lost" }));
    const first = mount();
    await act(async () => { await first.result.current.submit(fields); });
    first.unmount();
    mocks.actor = "staff-2";
    const second = mount();
    expect(second.result.current.hasUnresolvedAttempt).toBe(false);
    second.unmount();
  });

  it("does not start an abandoned submit after the save/read barrier completes", async () => {
    let release: (value: { kind: "no-draft" }) => void = () => {};
    mocks.refresh.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const view = mount();
    let submission: Promise<unknown> | undefined;
    act(() => { submission = view.result.current.submit(fields); });
    view.unmount();
    await act(async () => { release({ kind: "no-draft" }); await submission; });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps each exam's unresolved attempt when the global form switches exams", async () => {
    mocks.create.mockRejectedValue(new ApiError({ code: "SERVICE_UNAVAILABLE", status: 503, message: "ACK lost" }));
    const view = mount();
    await act(async () => { await view.result.current.submit(fields); });
    const originalKey = mocks.create.mock.calls[0]![1].operationKey;
    view.rerender({ examId: "exam-2" });
    expect(view.result.current.hasUnresolvedAttempt).toBe(false);
    await act(async () => { await view.result.current.submit(fields); });
    expect(mocks.create.mock.calls[1]![0]).toBe("exam-2");
    view.rerender({ examId: "exam-1" });
    expect(view.result.current.hasUnresolvedAttempt).toBe(true);
    await act(async () => { await view.result.current.retryUnknown(); });
    expect(mocks.create.mock.calls[2]![0]).toBe("exam-1");
    expect(mocks.create.mock.calls[2]![1].operationKey).toBe(originalKey);
    view.unmount();
  });
});
