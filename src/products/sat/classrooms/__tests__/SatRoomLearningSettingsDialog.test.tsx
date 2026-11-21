import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SatActivityPolicy } from "../../../../shared/sat/learningPolicy";
import { SatRoomLearningSettingsDialog } from "../SatRoomLearningSettingsDialog";

const backendGet = vi.hoisted(() => vi.fn());
const backendPut = vi.hoisted(() => vi.fn());
const hasBackendStatusCode = vi.hoisted(() => vi.fn());
vi.mock("../../../../services/backendBridge", () => ({ backendGet, backendPut, hasBackendStatusCode }));

const policy = (revision: number): SatActivityPolicy => ({
  revision,
  reportVisible: true,
  includeAnswerKeyInPdf: false,
  unlimitedRetakes: true,
  pauseOnLeave: true,
  study: { enabled: false, requiredCompletions: 1, revealAnswers: true, untimed: true },
});

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SatRoomLearningSettingsDialog scheduleId="room-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  backendGet.mockReset();
  backendPut.mockReset();
  hasBackendStatusCode.mockReset();
});

describe("SatRoomLearningSettingsDialog", () => {
  it("states the room-only scope and exposes the effective values", async () => {
    backendGet.mockResolvedValue(policy(4));
    renderDialog();
    expect(await screen.findByRole("switch", { name: "Show results" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Allow retakes" })).toBeChecked();
    expect(screen.getByText(/apply to this room only/i)).toBeInTheDocument();
  });

  it("keeps the draft and offers an explicit reapply after a revision conflict", async () => {
    backendGet.mockResolvedValue(policy(4));
    backendPut
      .mockRejectedValueOnce(new Error("These settings were saved by another teacher."))
      .mockResolvedValueOnce(policy(6));
    hasBackendStatusCode.mockImplementation((_error: unknown, status: number) => status === 409);
    const onClose = renderDialog();

    fireEvent.click(await screen.findByRole("switch", { name: "Show results" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/saved by another teacher/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reapply my changes" })).toBeInTheDocument();
    // The dirty choice survives the conflict; the dialog did not close.
    expect(screen.getByRole("switch", { name: "Show results" })).not.toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
    expect(backendPut).toHaveBeenCalledWith("/v1/schedules/room-1/sat-learning-settings", expect.objectContaining({
      expectedRevision: 4,
      reportVisible: false,
    }));

    backendGet.mockResolvedValue(policy(5));
    fireEvent.click(screen.getByRole("button", { name: "Reapply my changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(backendPut).toHaveBeenLastCalledWith("/v1/schedules/room-1/sat-learning-settings", expect.objectContaining({
      expectedRevision: 5,
      reportVisible: false,
    }));
  });
});
