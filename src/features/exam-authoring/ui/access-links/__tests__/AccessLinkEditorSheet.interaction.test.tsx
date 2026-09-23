import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessLinkEditorSheet } from "../AccessLinkEditorSheet";

/** The read-only posture is room-owned, so the room is a held value here. */
const room = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../../realtime/coedit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useSatAuthoringCollaboration: () => room.value };
});

beforeEach(() => {
  room.value = null;
});

/**
 * AT-21/01 — pressing Save is the highest-stakes press on this page (it writes
 * a student-facing link), so the pressed control must survive its own work:
 * focus stays on it, its box does not change size, the double fire is refused,
 * and the pending state is announced through aria-busy rather than by yanking
 * the button out from under the pointer.
 */
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

function renderSheet(overrides: Partial<React.ComponentProps<typeof AccessLinkEditorSheet>> = {}) {
  const props = {
    open: true,
    link: null,
    providerKey: "sat",
    members: [],
    isSaving: false,
    onClose: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<AccessLinkEditorSheet {...props} />), props };
}

describe("AccessLinkEditorSheet interaction contract", () => {
  it("AT-21: an in-flight save is announced, keeps focus, and refuses a second fire", async () => {
    let resolveSave: (() => void) | undefined;
    const onCreate = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const { rerender, props } = renderSheet({ onCreate });

    fireEvent.change(screen.getByLabelText("Student Link name"), { target: { value: "Saturday Class — September" } });
    const save = screen.getByRole("button", { name: "Create Link" });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    // The parent flips isSaving while the request is in flight.
    rerender(<AccessLinkEditorSheet {...props} isSaving />);
    const pendingSave = screen.getByRole("button", { name: /Saving/ });
    expect(pendingSave).toHaveAttribute("aria-busy", "true");
    // Pressed through the pending window: the control stays present, focused,
    // and the same size (min-w covers the longest label plus the spinner).
    expect(pendingSave).not.toBeDisabled();
    expect(document.activeElement).toBe(pendingSave);
    expect(pendingSave.className).toContain("min-w-[8.5rem]");
    expect(pendingSave.className).toContain("sat-press");

    fireEvent.click(pendingSave);
    fireEvent.click(pendingSave);
    expect(onCreate).toHaveBeenCalledTimes(1);

    resolveSave?.();
  });

  it("AT-21: a read-only link disables the save rather than faking a press", () => {
    room.value = {
      status: "ready",
      participants: [],
      workspaceSnapshot: { values: {}, readOnly: true, lifecyclePhase: "active" },
      setValue: vi.fn(),
    };
    renderSheet({
      link: {
        id: "link-1",
        examId: "exam-1",
        examTitle: "Digital SAT",
        providerKey: "sat",
        publishedVersionId: "version-5",
        versionNumber: 5,
        publishScope: "full",
        scheduleId: "schedule-1",
        name: "Revoked Link",
        enabledSections: null,
        audienceType: "cohort",
        audienceLabel: "Saturday",
        accessMode: "student_code",
        availabilityType: "anytime",
        opensAt: null,
        closesAt: null,
        lifecycleState: "revoked",
        status: "revoked",
        selectedStudentCount: 0,
        metrics: { registered: 0, started: 0, submitted: 0 },
        isCurrentRelease: true,
        hasParticipation: false,
        revision: 3,
        createdAt: "2026-08-28T00:00:00Z",
        updatedAt: "2026-08-28T00:00:00Z",
      },
    });
    const save = screen.getByRole("button", { name: "View only" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-disabled", "true");
  });

  it("AT-01: the sheet's choices, toggles, and helper actions all press", () => {
    renderSheet();
    const selectable = [
      screen.getByRole("button", { name: /Anyone/ }),
      screen.getByRole("button", { name: /Cohort/ }),
      screen.getByRole("button", { name: /Reading & Writing/ }),
      screen.getByRole("button", { name: /Require student code/ }),
      screen.getByRole("button", { name: "Cancel" }),
    ];
    for (const control of selectable) {
      expect(control.className).toContain("sat-press");
    }
  });
});
