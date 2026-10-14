import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import { ScoreReportSettingPanel } from "../ScoreReportSettingPanel";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock("../../../api/examQueries", () => ({
  useSaveExamMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: mocks.isPending }),
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

  it("saves the changed setting before refreshing the exam", async () => {
    mocks.mutateAsync.mockResolvedValue(undefined);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<ScoreReportSettingPanel exam={exam} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({
      ...exam,
      satScoreReportEnabled: true,
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("shows save errors and keeps the exam refresh from running", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("Save failed"));
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<ScoreReportSettingPanel exam={exam} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("switch"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("disables edits while the save is pending or the staff member cannot edit", () => {
    mocks.isPending = true;
    const { rerender } = render(<ScoreReportSettingPanel exam={exam} onSaved={vi.fn()} />);
    expect(screen.getByRole("switch")).toBeDisabled();

    mocks.isPending = false;
    rerender(<ScoreReportSettingPanel exam={{ ...exam, canEdit: false }} onSaved={vi.fn()} />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
