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

  it("creates a SAT room from one form: essentials visible, the rest summarized under More options", () => {
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
    expect(screen.getByText("Digital SAT · Version 5")).toBeInTheDocument();
    for (const heading of ["Room name", "Session type", "Who can join?", "Check-in"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    // No wizard: no progress, no Continue, no separate review step.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Room details" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create room" })).toBeInTheDocument();
    const moreOptions = screen.getByText("More options").closest("details");
    expect(moreOptions).not.toHaveAttribute("open");
    expect(within(moreOptions!).getByText("Both sections, with a total score · Student code · No class label")).toBeInTheDocument();
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
    expect(screen.queryByText("More options")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Session type" })).not.toBeInTheDocument();
  });

  it("validates the whole form on Create, focuses the first problem, then submits once fixed", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        examTitle="Digital SAT"
        targetVersionNumber={5}
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    expect(await screen.findByText("Give this room a name people will recognize.")).toBeInTheDocument();
    expect(screen.getByLabelText("Room name")).toHaveFocus();
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Saturday mock" } });
    fireEvent.click(screen.getByRole("button", { name: /Scheduled/ }));
    fireEvent.change(screen.getByLabelText("Opens"), { target: { value: "2099-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "2099-09-01T13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ name: "Saturday mock", availabilityType: "scheduled", audienceType: "anyone", accessMode: "student_code" });
    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty("satSessionMode");
  });

  it("treats a session-type-only change as unsaved work and resets the mode on reopen", async () => {
    const onClose = vi.fn();
    const props = {
      link: null,
      providerKey: "sat",
      members: [],
      isSaving: false,
      onClose,
      onCreate: vi.fn().mockResolvedValue(undefined),
      onUpdate: vi.fn().mockResolvedValue(undefined),
    } as const;
    const { rerender } = render(<AccessLinkEditorSheet open {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /^Classroom/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // A mode-only edit is real work: it must not be discarded silently.
    expect(screen.getByRole("alertdialog", { name: "Discard room settings changes?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<AccessLinkEditorSheet open={false} {...props} />);
    rerender(<AccessLinkEditorSheet open {...props} />);
    expect(screen.getByRole("button", { name: /^Practice/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("reveals Module 2 routing only for Classroom and sends the chosen route", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        examTitle="Digital SAT"
        targetVersionNumber={5}
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    // Standard practice has no routing choice at all.
    expect(screen.queryByLabelText("Module 2 routing")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Classroom/ }));
    // Revealed in place, not behind a disclosure, and adaptive by default.
    expect(screen.getByText("More options").closest("details")).not.toContainElement(screen.getByLabelText("Module 2 routing"));
    expect(screen.getByLabelText("Module 2 routing")).toHaveValue("classroom");
    fireEvent.change(screen.getByLabelText("Module 2 routing"), { target: { value: "classroom_higher" } });
    // Pressing Classroom again keeps the chosen route.
    fireEvent.click(screen.getByRole("button", { name: /^Classroom/ }));
    expect(screen.getByLabelText("Module 2 routing")).toHaveValue("classroom_higher");
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Harder Saturday" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ satSessionMode: "classroom", satRoutePolicy: "force_higher" });
  });

  it("restricts room choices to the in-scope custom module plan", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        classroomPlan={{ "reading-writing": "m1_easy", math: "m2_hard" }}
        classroomPlanStatus="ready"
        members={[]}
        isSaving={false}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const practice = screen.getByRole("button", { name: /^Practice/ });
    expect(practice).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Classroom/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Reading & Writing · Module 2 is set by the exam: Easy Module 2.")).toBeInTheDocument();
    expect(screen.getByText("Math · Module 2 is set by the exam: Hard Module 2.")).toBeInTheDocument();

    const routing = screen.getByLabelText("Module 2 routing");
    expect(within(routing).getByRole("option", { name: "Classroom (adaptive Module 2)" })).toBeInTheDocument();
    expect(within(routing).queryByRole("option", { name: "Classroom (everyone gets easier Module 2)" })).not.toBeInTheDocument();
    expect(within(routing).queryByRole("option", { name: "Classroom (everyone gets harder Module 2)" })).not.toBeInTheDocument();
    expect(within(routing).queryByRole("option", { name: "Classroom (teacher picks Module 2 per student)" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Custom module room" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ satSessionMode: "classroom" });
    expect(onCreate.mock.calls[0]![0].satRoutePolicy).toBeUndefined();
  });

  it("keeps the module-plan retry available while the room form is disabled", () => {
    const onRetryClassroomPlan = vi.fn();
    render(
      <AccessLinkEditorSheet
        open
        link={null}
        providerKey="sat"
        classroomPlanStatus="error"
        onRetryClassroomPlan={onRetryClassroomPlan}
        members={[]}
        isSaving={false}
        inputsDisabled
        submitDisabled
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry module plan" }));
    expect(onRetryClassroomPlan).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Room name")).toBeDisabled();
  });

  it("offers no section choice for a one-section release and pins the room to it", async () => {
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
    fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), {
      target: { value: "Reading & Writing Link" },
    });
    expect(screen.queryByRole("heading", { name: "Sections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Math/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
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

    fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), {
      target: { value: "Verbal only" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Reading & Writing/ }));
    fireEvent.click(screen.getByRole("button", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    expect(screen.getByText("A room needs at least one section.")).toBeInTheDocument();
    // The problem lives under More options, so it is opened rather than left hidden.
    expect(screen.getByText("More options").closest("details")).toHaveAttribute("open");
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
    fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), {
      target: { value: "Verbal only" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
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
    fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), {
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
    fireEvent.click(screen.getByRole("button", { name: "Close room settings" }));
    expect(
      screen.getByRole("alertdialog", { name: "Discard room settings changes?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(onUpdate.mock.calls[0]![1]).toMatchObject({ enabledSections: ["reading-writing"] });
    expect(onUpdate.mock.calls[0]![2]).toEqual({ silent: true });
  });

  it("confirms before discarding dirty room settings", () => {
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

    fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), {
      target: { value: "Saturday class" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close room settings" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Discard room settings changes?" }),
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
    expect(screen.getByRole("button", { name: "Create room" })).toBeDisabled();
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
  fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), { target: { value: "Morning class" } });
  const confirm = screen.getByRole("button", { name: "Create room" });
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

    fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), { target: { value: "Saturday mock" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Class or group label" }), { target: { value: "SAT September" } });
    expect(screen.getByRole("button", { name: /Anyone with the link/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    // The label rides along, but nothing in the request restricts admission.
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ audienceLabel: "SAT September", selectedStudents: [] });
    expect(onCreate.mock.calls[0]![0].audienceType).not.toBe("selected_students");
  });

  it("creates an unlabeled anyone room without requiring a group name", async () => {
    room.value = null;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<AccessLinkEditorSheet {...base} link={null} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), { target: { value: "Open mock" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ audienceType: "anyone", audienceLabel: null });
  });

  it("restricts admission only for listed students, and then needs a roster but no group name", async () => {
    room.value = null;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<AccessLinkEditorSheet {...base} link={null} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), { target: { value: "Scholarship mock" } });
    fireEvent.click(screen.getByRole("button", { name: /Listed students only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    expect(screen.getByText("Add at least one selected student.")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Student code, row 1" }), { target: { value: "W123456" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Name, row 1" }), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Email, row 1" }), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
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

  it("lets a new room start from an earlier one and then pre-fills its setup", () => {
    room.value = null;
    const earlier = satLink({ id: "link-earlier", name: "Morning class", audienceType: "cohort", audienceLabel: "Morning" });
    const onReuseSetup = vi.fn();
    const { rerender } = render(<AccessLinkEditorSheet {...base} link={null} reuseOptions={[earlier]} onReuseSetup={onReuseSetup} onCreate={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Start from an earlier room" }), { target: { value: "link-earlier" } });
    expect(onReuseSetup).toHaveBeenCalledWith(earlier);

    rerender(<AccessLinkEditorSheet {...base} link={null} prefill={earlier} reuseOptions={[earlier]} onReuseSetup={onReuseSetup} onCreate={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Room name" })).toHaveValue("Morning class (copy)");
    expect(screen.getByRole("textbox", { name: "Class or group label" })).toHaveValue("Morning");
    // Once a setup is chosen the picker is gone: it cannot silently replace typed work.
    expect(screen.queryByRole("combobox", { name: "Start from an earlier room" })).not.toBeInTheDocument();
  });
});
