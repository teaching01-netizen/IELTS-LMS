import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentAccessLink } from "../../../contracts/accessLinks";
import type { SatAuthoringCollaborationValue } from "../../../realtime/coedit";
import { AccessLinkEditorSheet } from "../AccessLinkEditorSheet";

/**
 * The coedit room is replaced by a held value so the two room-dependent paths
 * (dirty tracking through the shared value, and the 700ms silent autosave that
 * only the room's writer tab may materialize) can be driven without a socket.
 * `null` is the no-room posture every other case in this file runs in.
 */
const room = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../../realtime/coedit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useSatAuthoringCollaboration: () => room.value };
});

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

function satLink(overrides: Partial<AssessmentAccessLink> = {}): AssessmentAccessLink {
  return {
    id: "link-1",
    examId: "exam-1",
    examTitle: "Digital SAT",
    providerKey: "sat",
    publishedVersionId: "version-5",
    versionNumber: 5,
    publishScope: "full",
    scheduleId: "schedule-1",
    name: "Saturday Class",
    enabledSections: null,
    audienceType: "anyone",
    audienceLabel: null,
    accessMode: "student_code",
    availabilityType: "anytime",
    opensAt: null,
    closesAt: null,
    lifecycleState: "active",
    status: "live",
    selectedStudentCount: 0,
    metrics: { registered: 0, started: 0, submitted: 0 },
    isCurrentRelease: true,
    hasParticipation: false,
    revision: 3,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
    ...overrides,
  };
}

describe("AccessLinkEditorSheet", () => {
  beforeEach(() => {
    room.value = null;
  });

  it("offers section toggles for a SAT link only", () => {
    const { unmount } = render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByRole("button", { name: /Reading & Writing/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Math/ })).toHaveAttribute("aria-pressed", "true");
    unmount();

    render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="ielts"
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByRole("button", { name: /Reading & Writing/ })).not.toBeInTheDocument();
  });

  it("summarizes a SAT session before submit and shows no summary for IELTS", () => {
    const { unmount } = render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        examTitle="Digital SAT"
        targetVersionNumber={5}
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    for (const heading of ["Session details", "Students", "Check-in window"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByText("Digital SAT · Version 5")).toBeInTheDocument();
    expect(within(summary).getByText("Anyone with the link")).toBeInTheDocument();
    expect(within(summary).getByText("Both sections, with a total score")).toBeInTheDocument();
    expect(within(summary).getByText("Open now, until paused or revoked")).toBeInTheDocument();
    unmount();

    render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="ielts"
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByRole("heading", { name: "Session details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Summary" })).not.toBeInTheDocument();
  });

  it("limits a new link to the sections in its pinned release", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        publishScope="reading-writing"
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), {
      target: { value: "Reading & Writing Link" },
    });
    expect(screen.getByRole("button", { name: /Reading & Writing/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Math/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ enabledSections: ["reading-writing"] });
  });

  it("preselects the available section when repairing an older empty link", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <AccessLinkEditorSheet
        open
        link={satLink({ publishScope: "reading-writing", enabledSections: ["math"] })}
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/not available in its published version/);
    expect(screen.getByRole("button", { name: /Reading & Writing/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Math/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(onUpdate.mock.calls[0]![1]).toMatchObject({ enabledSections: ["reading-writing"] });
  });

  it("refuses to save a link with no section selected", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), {
      target: { value: "Verbal only" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Reading & Writing/ }));
    fireEvent.click(screen.getByRole("button", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));

    expect(screen.getByText("A session needs at least one section.")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("sends the narrowed scope on create and leaves it out of an unchanged update", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), {
      target: { value: "Verbal only" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ enabledSections: ["reading-writing"] });
    unmount();

    // An untouched scope is omitted so an edit of a link with participation
    // stays legal (an omitted field keeps the stored scope).
    render(
      <AccessLinkEditorSheet
        open
        link={satLink({ enabledSections: ["reading-writing"] })}
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), {
      target: { value: "Verbal only (renamed)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(onUpdate.mock.calls[0]![1]).not.toHaveProperty("enabledSections");
  });

  it("locks the section toggles once a student has joined", () => {
    render(
      <AccessLinkEditorSheet
        open
        link={satLink({ hasParticipation: true, enabledSections: ["math"] })}
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByRole("button", { name: /Math/ })).toBeDisabled();
    expect(screen.getByText(/Sections are fixed once a student has joined/)).toBeInTheDocument();
  });

  // A section toggle is a content edit like any other: it must mark the sheet
  // dirty (so closing cannot silently drop it) and it must ride the room's
  // debounced autosave, not only the explicit Save button.
  it("marks the sheet dirty and silently autosaves a section change", async () => {
    room.value = {
      examId: "exam-1",
      enabled: true,
      status: "connected",
      error: null,
      connectionPhase: "connected",
      lifecyclePhase: "active",
      participants: [{ id: "self-1", isSelf: true }],
      workspaceSnapshot: {
        readOnly: false,
        values: { "access/link-1": { writerId: "self-1" } },
        commands: {},
        participants: [{ id: "self-1", isSelf: true }],
      },
      setValue: vi.fn(),
    } as unknown as SatAuthoringCollaborationValue;
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <AccessLinkEditorSheet
        open
        link={satLink()}
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close session setup" }));
    expect(
      screen.getByRole("alertdialog", { name: "Discard session setup changes?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(onUpdate.mock.calls[0]![1]).toMatchObject({ enabledSections: ["reading-writing"] });
    expect(onUpdate.mock.calls[0]![2]).toEqual({ silent: true });
  });

  it("confirms before discarding dirty session settings", () => {
    const onClose = vi.fn();
    render(
      <AccessLinkEditorSheet
        open
        link={null}
        members={[]}
        isSaving={false}
        onClose={onClose}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), {
      target: { value: "Saturday class" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close session setup" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Discard session setup changes?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});


describe("reusing an allowlisted setup", () => {
  it("waits for its roster and exposes recovery when loading fails", () => {
    room.value = null;
    const onCreate = vi.fn();
    const onRetryMembers = vi.fn();
    const props = { open: true, link: null, prefill: satLink({ audienceType: "selected_students" }), providerKey: "sat", members: [], isSaving: false, onClose: vi.fn(), onCreate, onUpdate: vi.fn(), onRetryMembers };
    const view = render(<AccessLinkEditorSheet {...props} membersLoading />);
    expect(screen.getByText("Loading student roster…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create session" })).toBeDisabled();
    view.rerender(<AccessLinkEditorSheet {...props} membersError="The student roster could not load." />);
    expect(screen.getByRole("alert")).toHaveTextContent("roster could not load");
    fireEvent.click(screen.getByRole("button", { name: "Retry roster" }));
    expect(onRetryMembers).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
  });
});


it("creates only one group when confirmation is pressed twice before pending props update", async () => {
  room.value = null;
  let complete: (() => void) | undefined;
  const onCreate = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
  render(<AccessLinkEditorSheet open link={null} providerKey="sat" members={[]} isSaving={false} onClose={vi.fn()} onCreate={onCreate} onUpdate={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), { target: { value: "Morning class" } });
  const confirm = screen.getByRole("button", { name: "Create session" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(onCreate).toHaveBeenCalledTimes(1);
  await act(async () => { complete?.(); });
});

describe("who can join vs. a group label", () => {
  const base = { open: true, providerKey: "sat", members: [], isSaving: false, onClose: vi.fn(), onUpdate: vi.fn().mockResolvedValue(undefined) };

  it("treats a class label as a name only: the session stays open to anyone with the link", async () => {
    room.value = null;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<AccessLinkEditorSheet {...base} link={null} onCreate={onCreate} />);
    expect(screen.getByRole("button", { name: /Anyone with the link/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("textbox", { name: "Selected students" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), { target: { value: "Saturday mock" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Class or group label" }), { target: { value: "SAT September" } });
    expect(screen.getByRole("button", { name: /Anyone with the link/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    // The label rides along, but nothing in the request restricts admission.
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ audienceLabel: "SAT September", selectedStudents: [] });
    expect(onCreate.mock.calls[0]![0].audienceType).not.toBe("selected_students");
  });

  it("creates an unlabeled anyone session without requiring a group name", async () => {
    room.value = null;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<AccessLinkEditorSheet {...base} link={null} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), { target: { value: "Open mock" } });
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ audienceType: "anyone", audienceLabel: null });
  });

  it("restricts admission only for listed students, and then needs a roster but no group name", async () => {
    room.value = null;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<AccessLinkEditorSheet {...base} link={null} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), { target: { value: "Scholarship mock" } });
    fireEvent.click(screen.getByRole("button", { name: /Listed students only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    expect(screen.getByText("Add at least one selected student.")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Selected students" }), { target: { value: "W123456, Jane Doe, jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({
      audienceType: "selected_students",
      accessMode: "student_code",
      selectedStudents: [{ studentCode: "W123456", studentName: "Jane Doe", studentEmail: "jane@example.com" }],
    });
  });

  it("shows a stored cohort audience as anyone with its label, never as a restriction", () => {
    room.value = null;
    render(<AccessLinkEditorSheet {...base} link={satLink({ audienceType: "cohort", audienceLabel: "SAT September" })} onCreate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Anyone with the link/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Listed students only/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("textbox", { name: "Class or group label" })).toHaveValue("SAT September");
  });

  it("lets a new session start from an earlier one and then pre-fills its setup", () => {
    room.value = null;
    const earlier = satLink({ id: "link-earlier", name: "Morning class", audienceType: "cohort", audienceLabel: "Morning" });
    const onReuseSetup = vi.fn();
    const { rerender } = render(<AccessLinkEditorSheet {...base} link={null} reuseOptions={[earlier]} onReuseSetup={onReuseSetup} onCreate={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Start from an earlier session" }), { target: { value: "link-earlier" } });
    expect(onReuseSetup).toHaveBeenCalledWith(earlier);

    rerender(<AccessLinkEditorSheet {...base} link={null} prefill={earlier} reuseOptions={[earlier]} onReuseSetup={onReuseSetup} onCreate={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Session name" })).toHaveValue("Morning class (copy)");
    expect(screen.getByRole("textbox", { name: "Class or group label" })).toHaveValue("Morning");
    // Once a setup is chosen the picker is gone: it cannot silently replace typed work.
    expect(screen.queryByRole("combobox", { name: "Start from an earlier session" })).not.toBeInTheDocument();
  });
});
