import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import { ScoreReportSettingPanel } from "../ScoreReportSettingPanel";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  hasBackendStatusCode: vi.fn(),
}));

vi.mock("../../../api/examQueries", () => ({
  useSaveExamMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: mocks.isPending }),
}));

vi.mock("../../../../../services/backendBridge", () => ({
  hasBackendStatusCode: mocks.hasBackendStatusCode,
}));

const exam: ExamEntity = {
  id: "sat-exam-1",
  slug: "sat-exam-1",
  title: "SAT Practice",
  providerKey: "sat",
  type: "Academic",
  status: "published",
  visibility: "private",
  owner: "admin",
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
  currentDraftVersionId: null,
  currentPublishedVersionId: "version-1",
  satScoreReportEnabled: false,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 4,
};

describe("ScoreReportSettingPanel", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.isPending = false;
  });

  it("defaults a previously created exam to retakes and saves an explicit opt-out", async () => {
    mocks.mutateAsync.mockResolvedValue(undefined);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<ScoreReportSettingPanel exam={exam} onSaved={onSaved} />);

    const retakes = screen.getByRole("switch", { name: "Allow retakes" });
    expect(retakes).toBeChecked();
    expect(screen.getByRole("switch", { name: "Show results" })).not.toBeChecked();
    fireEvent.click(retakes);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({
      ...exam,
      satLearningDefaults: expect.objectContaining({ unlimitedRetakes: false, reportVisible: false }),
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("shows save errors and keeps the exam refresh from running", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("Save failed"));
    mocks.hasBackendStatusCode.mockReturnValue(false);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<ScoreReportSettingPanel exam={exam} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("switch", { name: "Allow retakes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the draft and offers a reload after a revision conflict", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("Exam changed while you were editing; refresh before retrying."));
    mocks.hasBackendStatusCode.mockImplementation((_error: unknown, status: number) => status === 409);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<ScoreReportSettingPanel exam={exam} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("switch", { name: "Show results" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Exam changed while you were editing/)).toBeInTheDocument();
    // The dirty choice survives; reloading the base does not discard it.
    expect(screen.getByRole("switch", { name: "Show results" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("switch", { name: "Show results" })).toBeChecked();
  });

  it("describes the exam-wide scope and the saved values", () => {
    render(<ScoreReportSettingPanel exam={exam} onSaved={vi.fn()} />);
    expect(screen.getByText(/scheduled or running room/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Closed rooms keep their own settings/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Currently saved:/i)).toBeInTheDocument();
  });

  it("disables edits while the save is pending or the staff member cannot edit", () => {
    mocks.isPending = true;
    const { rerender } = render(<ScoreReportSettingPanel exam={exam} onSaved={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Allow retakes" })).toBeDisabled();

    mocks.isPending = false;
    rerender(<ScoreReportSettingPanel exam={{ ...exam, canEdit: false }} onSaved={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Allow retakes" })).toBeDisabled();
  });
});
