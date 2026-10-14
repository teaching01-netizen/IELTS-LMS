import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import type { AssessmentAuthoringShell, AssessmentValidationReport } from "../../../contracts/assessment";
import type { AssessmentReleaseState } from "../../../contracts/release";

const state = vi.hoisted(() => ({
  exam: null as unknown,
  publish: vi.fn(),
  create: vi.fn(),
  hook: {} as Record<string, unknown>,
}));

vi.mock("../../../api/examQueries", () => ({
  useExamQuery: () => ({ data: state.exam, error: null, refetch: vi.fn() }),
}));
vi.mock("../useSatPublish", () => ({
  useSatPublish: () => state.hook,
}));
vi.mock("../../../api/assessmentAccessLinkQueries", () => ({
  useCreateAccessLink: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock("../../../realtime/coedit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useSatAuthoringCollaboration: () => null };
});

import { SatCreateRoomFlow } from "../SatCreateRoomFlow";

const exam = {
  id: "exam-1",
  title: "SAT Mock Test — October",
  providerKey: "sat",
  canEdit: true,
  canPublish: true,
} as unknown as ExamEntity;
const shell = { examId: "exam-1", providerKey: "sat", versionId: "draft-3", versionRevision: 4, sections: [] } as unknown as AssessmentAuthoringShell;
const releaseState = {
  examId: "exam-1",
  providerKey: "sat",
  state: "unpublished_changes",
  currentPublishedVersion: { id: "pv-2", versionNumber: 2, revision: 1, publishNotes: null, publishScope: "full", createdAt: "2026-10-01T00:00:00Z" },
  workingDraft: { id: "draft-3", parentVersionId: "pv-2", versionNumber: 3, revision: 4 },
  summary: { candidateDurationSeconds: 0, authoredQuestionCount: 0, deliveredQuestionCount: 0 },
  access: { totalLinks: 1, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 1, liveLinksOnPreviousReleases: 0 },
} as unknown as AssessmentReleaseState;
const report = { examId: "exam-1", versionId: "draft-3", versionRevision: 4, publishScope: "full", valid: true, errors: [], warnings: [] } as AssessmentValidationReport;

function renderFlow() {
  const props = {
    examId: "exam-1",
    examTitle: "SAT Mock Test — October",
    onClose: vi.fn(),
    onFixIssue: vi.fn(),
    onRoomCreated: vi.fn(),
  };
  return { props, ...render(<SatCreateRoomFlow {...props} />) };
}

beforeEach(() => {
  state.exam = exam;
  state.publish.mockReset();
  state.create.mockReset();
  state.create.mockResolvedValue({ id: "link-new", scheduleId: "sched-new" });
  state.hook = {
    shell,
    shellState: { kind: "ready" },
    shellLoadError: null,
    releaseState,
    releaseQuery: { refetch: vi.fn(), error: null },
    shellLifecycle: { refresh: vi.fn() },
    readinessQuery: { data: report, isFetching: false, error: null, refetch: vi.fn() },
    publishScope: "full",
    setPublishScope: vi.fn(),
    isPublishing: false,
    publishError: null,
    draftBusy: false,
    publish: state.publish,
  };
});

describe("SatCreateRoomFlow with unpublished changes", () => {
  it("defaults to the published version and creates the room without publishing the draft", async () => {
    const { props } = renderFlow();
    expect(screen.getByRole("radio", { name: "Use published Version 2" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Publish changes first" })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Saturday Morning SAT" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    expect(state.create.mock.calls[0]![0]).toMatchObject({ name: "Saturday Morning SAT", publishedVersionId: "pv-2" });
    expect(state.publish).not.toHaveBeenCalled();
    expect(props.onRoomCreated).toHaveBeenCalledWith({ id: "link-new", scheduleId: "sched-new" });
  });

  it("publishes the draft first only when staff choose it explicitly", () => {
    renderFlow();
    fireEvent.click(screen.getByRole("radio", { name: "Publish changes first" }));
    // The draft path still requires the content choice before anything is published.
    expect(screen.getByRole("button", { name: "Publish & create room" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "Exam content students will receive" })).toBeInTheDocument();
    expect(state.publish).not.toHaveBeenCalled();
  });
});
