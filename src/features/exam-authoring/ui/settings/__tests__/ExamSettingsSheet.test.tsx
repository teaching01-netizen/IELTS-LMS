import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";

const state = vi.hoisted(() => ({
  exam: null as unknown,
  armDraft: vi.fn(),
  reportDirty: (_count: number) => undefined as void,
  editExam: (() => undefined) as () => void,
}));

vi.mock("../../../api/examQueries", () => ({
  useExamQuery: () => ({ data: state.exam, error: null, refetch: vi.fn() }),
}));
vi.mock("../../../application/authoringEntryIntent", () => ({
  requestAuthoringDraftOnEntry: (examId: string) => state.armDraft(examId),
}));
vi.mock("../DeliverySettingsPanel", () => ({
  DeliverySettingsPanel: ({ onDirtyCountChange, onEditExam }: { onDirtyCountChange?: (count: number) => void; onEditExam?: () => void }) => {
    state.reportDirty = (count) => onDirtyCountChange?.(count);
    state.editExam = () => onEditExam?.();
    return <div data-testid="panel">editors</div>;
  },
}));

import { ExamSettingsSheet } from "../ExamSettingsSheet";

const exam = { id: "exam-1", title: "Practice Test 06", canEdit: true, canPublish: true } as unknown as ExamEntity;

function renderSheet(onClose = vi.fn(), onEditExam?: () => void) {
  render(<ExamSettingsSheet examId="exam-1" open onClose={onClose} {...(onEditExam ? { onEditExam } : {})} />);
  return onClose;
}

beforeEach(() => {
  state.exam = exam;
  state.armDraft.mockReset();
});

describe("ExamSettingsSheet", () => {
  it("edits settings in place and closes straight away when nothing is unsaved", () => {
    const onClose = renderSheet();
    expect(screen.getByRole("dialog", { name: "Exam settings" })).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports how many sections hold unsaved edits and asks before discarding them", () => {
    const onClose = renderSheet();
    act(() => state.reportDirty(2));
    expect(screen.getByText("2 sections have unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Close with unsaved changes?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps editing when the author backs out of the discard prompt", () => {
    const onClose = renderSheet();
    act(() => state.reportDirty(1));
    expect(screen.getByText("1 section has unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
  });

  it("arms the explicit edit gesture only when the author asks to edit a published exam", () => {
    const onEditExam = vi.fn();
    renderSheet(vi.fn(), onEditExam);
    expect(state.armDraft).not.toHaveBeenCalled();
    act(() => state.editExam());
    expect(state.armDraft).toHaveBeenCalledWith("exam-1");
    expect(onEditExam).toHaveBeenCalledOnce();
  });
});
