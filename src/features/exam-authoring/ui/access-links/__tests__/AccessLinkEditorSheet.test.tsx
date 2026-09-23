import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    fireEvent.change(screen.getByRole("textbox", { name: "Student Link name" }), {
      target: { value: "Reading & Writing Link" },
    });
    expect(screen.getByRole("button", { name: /Reading & Writing/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Math/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Link" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
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

    fireEvent.change(screen.getByRole("textbox", { name: "Student Link name" }), {
      target: { value: "Verbal only" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Reading & Writing/ }));
    fireEvent.click(screen.getByRole("button", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create Link" }));

    expect(screen.getByText("A Student Link needs at least one section.")).toBeInTheDocument();
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
    fireEvent.change(screen.getByRole("textbox", { name: "Student Link name" }), {
      target: { value: "Verbal only" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create Link" }));
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
    fireEvent.change(screen.getByRole("textbox", { name: "Student Link name" }), {
      target: { value: "Verbal only (renamed)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Close Student Link editor" }));
    expect(
      screen.getByRole("alertdialog", { name: "Discard Student Link changes?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(onUpdate.mock.calls[0]![1]).toMatchObject({ enabledSections: ["reading-writing"] });
    expect(onUpdate.mock.calls[0]![2]).toEqual({ silent: true });
  });

  it("confirms before discarding dirty Student Link settings", () => {
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

    fireEvent.change(screen.getByRole("textbox", { name: "Student Link name" }), {
      target: { value: "Saturday class" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close Student Link editor" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Discard Student Link changes?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
