import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../../domain/satCopy";
import type { SatDeviceTransfer } from "../../../api/satDeviceTransferApi";

const api = vi.hoisted(() => ({
  checkSatAdmission: vi.fn(),
  requestSatDeviceTransfer: vi.fn(),
  getSatDeviceTransfer: vi.fn(),
  cancelSatDeviceTransfer: vi.fn(),
  commitSatDeviceTransfer: vi.fn(),
  recallSatTransferRequest: vi.fn(() => null),
  rememberSatTransferRequest: vi.fn(),
  forgetSatTransferOperation: vi.fn(),
  satBrowserWriterSession: vi.fn(() => "browser-b"),
}));
vi.mock("../../../api/satDeviceTransferApi", () => api);

import { SatDeviceTransferPanel } from "../SatDeviceTransferPanel";

const copy = SAT_COPY.deviceTransfer;

function transfer(state: SatDeviceTransfer["state"], stage: SatDeviceTransfer["policyStage"] = "post_start"): SatDeviceTransfer {
  return {
    requestId: "req-1", operationId: "op-1", attemptId: "att-1", scheduleId: "sched-1", state,
    policyStage: stage, reasonCode: "device_change", expectedLeaseEpoch: 1,
    requestedAt: "2026-10-06T00:00:00Z", expiresAt: "2026-10-06T00:10:00Z", approvalKind: null,
    approvedAt: null, approvalExpiresAt: null, unconfirmedRiskAcknowledged: false, decisionReason: null,
    decidedAt: null, resultingLeaseEpoch: null, committedAt: null,
  };
}

function blocked(stage: "pre_start" | "post_start") {
  api.checkSatAdmission.mockResolvedValue({
    admission: { outcome: "blocked", attemptId: "att-1", leaseEpoch: 3, singleWriter: true, policyStage: stage },
    attemptId: "att-1",
  });
}

describe("SatDeviceTransferPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.recallSatTransferRequest.mockReturnValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands an authorized browser straight back to the exam route", async () => {
    api.checkSatAdmission.mockResolvedValue({
      admission: { outcome: "authorized", attemptId: "att-1", leaseEpoch: 1, singleWriter: true },
      attemptId: "att-1",
    });
    const onAuthorized = vi.fn();
    render(<SatDeviceTransferPanel scheduleId="sched-1" candidateId="W1" onAuthorized={onAuthorized} onExit={vi.fn()} />);
    await waitFor(() => expect(onAuthorized).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: copy.request })).not.toBeInTheDocument();
  });

  it("requests with the server lease, waits, and redeems the approval exactly once", async () => {
    blocked("post_start");
    api.requestSatDeviceTransfer.mockResolvedValue(transfer("pending"));
    api.getSatDeviceTransfer.mockResolvedValue(transfer("approved"));
    api.commitSatDeviceTransfer.mockResolvedValue(transfer("committed"));
    const onAuthorized = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SatDeviceTransferPanel scheduleId="sched-1" candidateId="W1" onAuthorized={onAuthorized} onExit={vi.fn()} />);

    const heading = await screen.findByRole("heading", { name: copy.blockedTitle });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(copy.blockedBodyPostStart)).toBeInTheDocument();
    // After the exam starts, the student is told unsaved old-device answers stay behind.
    expect(screen.getByRole("status")).toHaveTextContent(copy.unconfirmedWarning);

    fireEvent.click(screen.getByRole("button", { name: copy.request }));
    expect(await screen.findByRole("heading", { name: copy.pendingTitle })).toBeInTheDocument();
    expect(api.requestSatDeviceTransfer).toHaveBeenCalledWith({
      scheduleId: "sched-1", candidateId: "W1", attemptId: "att-1", expectedLeaseEpoch: 3,
    });
    expect(api.rememberSatTransferRequest).toHaveBeenCalledWith("sched-1", "W1", "req-1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    await waitFor(() => expect(onAuthorized).toHaveBeenCalledOnce());
    expect(api.commitSatDeviceTransfer).toHaveBeenCalledTimes(1);
    expect(api.commitSatDeviceTransfer).toHaveBeenCalledWith("sched-1", "W1", "req-1");
  });

  it("ends an expired approval without moving ownership and lets the student ask again", async () => {
    blocked("pre_start");
    api.recallSatTransferRequest.mockReturnValue("req-1");
    api.getSatDeviceTransfer.mockResolvedValue(transfer("approved", "pre_start"));
    api.commitSatDeviceTransfer.mockRejectedValue(Object.assign(new Error("expired"), { code: "TRANSFER_EXPIRED" }));
    const onAuthorized = vi.fn();
    render(<SatDeviceTransferPanel scheduleId="sched-1" candidateId="W1" onAuthorized={onAuthorized} onExit={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: copy.expiredTitle })).toBeInTheDocument();
    expect(onAuthorized).not.toHaveBeenCalled();
    expect(api.rememberSatTransferRequest).toHaveBeenCalledWith("sched-1", "W1", null);
    expect(screen.getByRole("button", { name: copy.requestAgain })).toBeInTheDocument();
  });

  it("cancels an open request and returns to the blocked state", async () => {
    blocked("pre_start");
    api.requestSatDeviceTransfer.mockResolvedValue(transfer("pending", "pre_start"));
    api.cancelSatDeviceTransfer.mockResolvedValue(transfer("cancelled", "pre_start"));
    render(<SatDeviceTransferPanel scheduleId="sched-1" candidateId="W1" onAuthorized={vi.fn()} onExit={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: copy.request }));
    expect(await screen.findByText(copy.pendingBodyPreStart)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.cancel }));
    await waitFor(() => expect(api.cancelSatDeviceTransfer).toHaveBeenCalledWith("sched-1", "W1", "req-1"));
    expect(await screen.findByRole("button", { name: copy.request })).toBeInTheDocument();
    expect(api.forgetSatTransferOperation).toHaveBeenCalledWith("sched-1", "att-1", "browser-b");
  });
});
