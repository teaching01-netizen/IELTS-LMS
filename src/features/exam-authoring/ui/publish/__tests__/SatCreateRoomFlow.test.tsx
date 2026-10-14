import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../../shared/api-client/errors";
import type { SatRoomReceipt } from "../../../contracts/satCreateRoom";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  operation: vi.fn(),
  refreshShell: vi.fn(),
  refetchExam: vi.fn(),
  classroomIsFetching: false,
  classroomIsSuccess: true,
  classroomCreationEnabled: true,
}));

vi.mock("../../../api/satCreateRoomApi", () => ({
  satCreateRoomApi: { create: mocks.create, operation: mocks.operation },
}));
vi.mock("../../../api/examQueries", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useExamQuery: () => ({ data: { id: "exam-1", canEdit: true, revision: 18 }, refetch: mocks.refetchExam }),
  };
});
vi.mock("../../../api/satExamConfigApi", () => ({
  useSatExamConfigDefaults: () => ({
    isFetching: mocks.classroomIsFetching,
    isSuccess: mocks.classroomIsSuccess,
    data: { classroomCreationEnabled: mocks.classroomCreationEnabled },
  }),
}));
vi.mock("../../../application/authoringShellLifecycle", () => ({
  useAuthoringShellLifecycle: () => ({ refresh: mocks.refreshShell }),
}));
vi.mock("../../../realtime/coedit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useSatAuthoringCollaboration: () => null };
});

import { clearSatRoomDraft, stashSatRoomDraft } from "../../../application/satRoomDraftStore";
import { SatCreateRoomFlow } from "../SatCreateRoomFlow";

const receipt = {
  room: { id: "link-new", scheduleId: "sched-new" },
  version: { id: "v3", number: 3, scope: "full", createdNow: true },
  exam: { revision: 19 },
} as unknown as SatRoomReceipt;

function renderFlow() {
  const props = {
    examId: "exam-1",
    examTitle: "SAT Mock Test — October",
    onClose: vi.fn(),
    onFixIssue: vi.fn(),
    onRoomCreated: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SatCreateRoomFlow {...props} />
    </QueryClientProvider>,
  );
  return { props, ...view };
}

function fillName(name: string) {
  fireEvent.change(screen.getByLabelText("Room name"), { target: { value: name } });
}

beforeEach(() => {
  clearSatRoomDraft("exam-1");
  mocks.create.mockReset();
  mocks.operation.mockReset();
  mocks.refreshShell.mockReset();
  mocks.refetchExam.mockReset();
  mocks.classroomIsFetching = false;
  mocks.classroomIsSuccess = true;
  mocks.classroomCreationEnabled = true;
  mocks.refreshShell.mockResolvedValue({ kind: "ready", shell: { versionId: "draft-3", versionRevision: 4 } });
  mocks.refetchExam.mockResolvedValue({ data: { id: "exam-1", canEdit: true, revision: 18 } });
});

describe("SatCreateRoomFlow", () => {
  it("creates a room in one request pinned to the committed revisions, with no publish or version choice", async () => {
    mocks.create.mockResolvedValue(receipt);
    const { props } = renderFlow();
    expect(screen.queryByRole("radio", { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();

    fillName("Saturday Morning SAT");
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    await waitFor(() => expect(props.onRoomCreated).toHaveBeenCalledWith(receipt.room, receipt));
    expect(mocks.create).toHaveBeenCalledOnce();
    const [examId, request] = mocks.create.mock.calls[0]!;
    expect(examId).toBe("exam-1");
    expect(request).toMatchObject({
      expectedExamRevision: 18,
      expectedDraftVersionId: "draft-3",
      expectedDraftRevision: 4,
      room: { name: "Saturday Morning SAT" },
    });
    expect(request.room).not.toHaveProperty("publishedVersionId");
    expect(typeof request.operationKey).toBe("string");
  });

  it("asserts there is no working draft when the exam is only saved", async () => {
    mocks.refreshShell.mockResolvedValue({ kind: "no-draft" });
    mocks.create.mockResolvedValue(receipt);
    renderFlow();
    fillName("Room");
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    const request = mocks.create.mock.calls[0]![1];
    expect(request.expectedDraftVersionId).toBe("");
    expect(request).not.toHaveProperty("expectedDraftRevision");
  });

  it("keeps Practice usable and disables Classroom when the server gate is off", async () => {
    mocks.classroomCreationEnabled = false;
    mocks.create.mockResolvedValue(receipt);
    const { props } = renderFlow();
    const classroom = screen.getByRole("button", { name: /Classroom/ });
    expect(classroom).toBeDisabled();
    expect(screen.getByText(/Practice remains available/)).toBeInTheDocument();

    fillName("Practice while Classroom is disabled");
    expect(screen.getByRole("button", { name: /Practice/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(props.onRoomCreated).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]![1].room).not.toHaveProperty("satSessionMode");
  });

  it("preserves a restored Classroom selection but blocks creation until Practice is selected", async () => {
    mocks.classroomCreationEnabled = false;
    stashSatRoomDraft("exam-1", {
      name: "Restored Classroom room",
      audienceType: "anyone",
      accessMode: "student_code",
      availabilityType: "anytime",
      selectedStudents: [],
      satSessionMode: "classroom",
      satRoutePolicy: "staff_selects",
    });
    renderFlow();

    expect(await screen.findByLabelText("Room name")).toHaveValue("Restored Classroom room");
    const classroom = screen.getByRole("button", { name: /Classroom/ });
    expect(classroom).toBeDisabled();
    expect(classroom).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Create room" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Practice/ }));
    expect(screen.getByRole("button", { name: "Create room" })).toBeEnabled();
  });

  it("fails closed when the Classroom capability cannot be checked", () => {
    mocks.classroomIsSuccess = false;
    renderFlow();
    expect(screen.getByRole("button", { name: /Classroom/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/availability could not be checked/i);
    expect(screen.getByRole("button", { name: /Practice/ })).toBeEnabled();
  });

  it("locks Classroom after a definitive POST refusal while preserving the selected form for Practice", async () => {
    mocks.create
      .mockRejectedValueOnce(new ApiError({ code: "SAT_CLASSROOM_DISABLED", message: "disabled", status: 503 }))
      .mockResolvedValueOnce(receipt);
    const { props } = renderFlow();
    fillName("Keep my room details");
    fireEvent.click(screen.getByRole("button", { name: /Classroom/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findAllByText(/No room was created; choose Practice or try again later/)).not.toHaveLength(0);
    const classroom = screen.getByRole("button", { name: /Classroom/ });
    expect(classroom).toBeDisabled();
    expect(classroom).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Room name")).toHaveValue("Keep my room details");
    expect(screen.getByRole("button", { name: "Create room" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Practice/ })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /Practice/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(props.onRoomCreated).toHaveBeenCalled());
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1]![1].operationKey).not.toBe(mocks.create.mock.calls[0]![1].operationKey);
    expect(mocks.create.mock.calls[1]![1].room).not.toHaveProperty("satSessionMode");
  });

  it("keeps the form open on EXAM_NOT_READY, lists every issue with a Fix link, and restores the form afterwards", async () => {
    mocks.create.mockRejectedValue(new ApiError({
      code: "EXAM_NOT_READY",
      message: "Fix the exam issues before creating a room.",
      status: 422,
      details: {
        currentExamRevision: 18,
        issues: [
          { code: "question.prompt.required", path: "examQuestion:q1:prompt", message: "Question text is required." },
          { code: "module.count", path: "math.m1", message: "Math Module 1 needs 22 questions." },
        ],
      },
    }));
    const { props, unmount } = renderFlow();
    fillName("Needs work");
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    const list = await screen.findByRole("list", { name: "Exam issues to fix" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText(/Room not created — fix 2 exam issues/).length).toBeGreaterThan(0);
    expect(props.onRoomCreated).not.toHaveBeenCalled();

    fireEvent.click(within(list).getAllByRole("button", { name: /^Fix:/ })[0]!);
    expect(props.onFixIssue).toHaveBeenCalledWith(expect.objectContaining({ path: "examQuestion:q1:prompt" }));

    // Coming back from the fix restores what was typed.
    unmount();
    renderFlow();
    expect(screen.getByLabelText("Room name")).toHaveValue("Needs work");
  });

  it("resends the SAME operation key after an unconfirmed outcome instead of minting a second room", async () => {
    mocks.create
      .mockRejectedValueOnce(new ApiError({ code: "SERVICE_UNAVAILABLE", message: "down", status: 503 }))
      .mockResolvedValueOnce(receipt);
    const { props } = renderFlow();
    fillName("Flaky network");
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    const retry = await screen.findByRole("button", { name: "Try again" });
    // No second submission can be started while the first is unresolved.
    expect(screen.getByRole("button", { name: "Create room" })).toBeDisabled();
    fireEvent.click(retry);

    await waitFor(() => expect(props.onRoomCreated).toHaveBeenCalledWith(receipt.room, receipt));
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1]![1]).toBe(mocks.create.mock.calls[0]![1]);
    expect(mocks.create.mock.calls[1]![1].operationKey).toBe(mocks.create.mock.calls[0]![1].operationKey);
  });

  it("recovers a lost response by reading the operation receipt", async () => {
    mocks.create.mockRejectedValue(new ApiError({ code: "UNKNOWN", message: "gateway timeout", status: 504 }));
    mocks.operation.mockResolvedValue(receipt);
    const { props } = renderFlow();
    fillName("Lost response");
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    fireEvent.click(await screen.findByRole("button", { name: "Check status" }));
    await waitFor(() => expect(mocks.operation).toHaveBeenCalledWith(mocks.create.mock.calls[0]![1].operationKey));
    await waitFor(() => expect(props.onRoomCreated).toHaveBeenCalledWith(receipt.room, receipt));
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("mints a new key only after the server definitively refused the exam revision", async () => {
    mocks.create
      .mockRejectedValueOnce(new ApiError({ code: "EXAM_REVISION_CHANGED", message: "changed", status: 409, details: { currentExamRevision: 19 } }))
      .mockResolvedValueOnce(receipt);
    renderFlow();
    fillName("Raced");
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review latest exam" }));
    mocks.refetchExam.mockResolvedValue({ data: { id: "exam-1", canEdit: true, revision: 19 } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![1].operationKey).not.toBe(mocks.create.mock.calls[0]![1].operationKey);
    expect(mocks.create.mock.calls[1]![1].expectedExamRevision).toBe(19);
  });
});
