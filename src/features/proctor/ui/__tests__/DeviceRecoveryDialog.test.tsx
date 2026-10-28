import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceRecoveryDialog } from "../DeviceRecoveryDialog";

const mocks = vi.hoisted(() => ({ options: vi.fn(), issue: vi.fn() }));
vi.mock("../../../student/infrastructure/deviceRecoveryGateway", () => ({
  recoveryGateway: mocks,
}));
vi.mock("../../../../shared/hooks/useQrCodeDataUrl", () => ({
  useQrCodeDataUrl: () => ({ dataUrl: null, error: null }),
}));
const options = {
  issuanceEnabled: true,
  attemptId: "a",
  scheduleId: "s",
  candidateName: "Ada",
  examTitle: "SAT",
  providerKey: "sat",
  leaseEpoch: 3,
  controlEpoch: 4,
  serverNow: new Date().toISOString(),
  eligibility: { eligible: true },
  targets: [
    {
      sectionKey: "math",
      moduleId: "m",
      moduleAttemptId: "ma",
      label: "Math Module 1",
      current: true,
      eligibility: { eligible: true },
    },
  ],
};

describe("DeviceRecoveryDialog authority boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.options.mockResolvedValue(options);
  });
  it("opening and dismissing preview never changes authority", async () => {
    const close = vi.fn();
    render(<DeviceRecoveryDialog isOpen scheduleId="s" attemptId="a" onClose={close} />);
    await screen.findByText("Ada");
    expect(mocks.issue).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("retries an ambiguous issuance with the identical operation and award", async () => {
    mocks.issue
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce({
        grant: { grantId: "g", state: "issued", expiresAt: new Date().toISOString() },
        recoveryPath: "/student/recover/g#secret",
        code: "123456",
      });
    render(<DeviceRecoveryDialog isOpen scheduleId="s" attemptId="a" onClose={() => {}} />);
    await screen.findByText("Ada");
    fireEvent.click(screen.getByLabelText("ปรับส่วนหรือเวลาเอง"));
    fireEvent.change(screen.getByLabelText("กำหนดเวลาเหลือใหม่ (นาที:วินาที)"), {
      target: { value: "08:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "สร้าง QR และรหัส" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "สร้าง QR และรหัส" }));
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledTimes(2));
    expect(mocks.issue.mock.calls[0]?.[2]).toEqual(mocks.issue.mock.calls[1]?.[2]);
    expect(mocks.issue.mock.calls[0]?.[2].remainingSeconds).toBe(480);
  });
  it("keeps the countdown silent and gives the QR a labelled text-link equivalent", async () => {
    mocks.issue.mockResolvedValueOnce({
      grant: { grantId: "g", state: "issued", expiresAt: new Date().toISOString() },
      recoveryPath: "/student/recover/g#key=secret",
      code: "123456",
    });
    render(<DeviceRecoveryDialog isOpen scheduleId="s" attemptId="a" onClose={() => {}} />);
    await screen.findByText("Ada");
    const countdown = screen.getByText(/^เวลาคงเหลือ/);
    // A per-second clock inside a live region would announce every tick.
    expect(countdown.closest('[role="status"],[role="alert"],[aria-live]')).toBeNull();
    fireEvent.click(screen.getByLabelText("ปรับส่วนหรือเวลาเอง"));
    expect(screen.getByLabelText("กำหนดเวลาเหลือใหม่ (นาที:วินาที)")).toHaveAttribute(
      "aria-describedby"
    );
    fireEvent.click(screen.getByRole("button", { name: "สร้าง QR และรหัส" }));
    const link = await screen.findByRole("link", { name: /\/student\/recover\/g/ });
    expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByText("123456")).toBeInTheDocument();
  });
  it("drops a stale operation and reloads instead of retrying it forever", async () => {
    mocks.issue.mockRejectedValueOnce(
      Object.assign(new Error("The attempt changed"), { details: { reason: "RECOVERY_STALE" } })
    );
    render(<DeviceRecoveryDialog isOpen scheduleId="s" attemptId="a" onClose={() => {}} />);
    await screen.findByText("Ada");
    fireEvent.click(screen.getByRole("button", { name: "สร้าง QR และรหัส" }));
    await screen.findByText(/ข้อมูลเปลี่ยนไปแล้ว/);
    mocks.options.mockResolvedValue({ ...options, leaseEpoch: 9, controlEpoch: 10 });
    await waitFor(() => expect(mocks.options.mock.calls.length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByRole("button", { name: "สร้าง QR และรหัส" }));
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.issue.mock.calls.map((call) => call[2]);
    expect(second.operationId).not.toBe(first.operationId);
  });
  it("validates the award inline and blocks issuance while invalid", async () => {
    render(<DeviceRecoveryDialog isOpen scheduleId="s" attemptId="a" onClose={() => {}} />);
    await screen.findByText("Ada");
    fireEvent.click(screen.getByLabelText("ปรับส่วนหรือเวลาเอง"));
    const input = screen.getByLabelText("กำหนดเวลาเหลือใหม่ (นาที:วินาที)");
    fireEvent.change(input, { target: { value: "8" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("กรอกเวลาเป็น นาที:วินาที เช่น 08:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "สร้าง QR และรหัส" })).toBeDisabled();
  });
  it("defaults to resuming as-is: no time or section controls, no award sent", async () => {
    mocks.issue.mockResolvedValueOnce({
      grant: { grantId: "g", state: "issued", expiresAt: new Date().toISOString() },
      recoveryPath: "/student/recover/g#key=s",
      code: "123456",
    });
    render(<DeviceRecoveryDialog isOpen scheduleId="s" attemptId="a" onClose={() => {}} />);
    await screen.findByText("Ada");
    expect(screen.getByLabelText("ทำต่อจากจุดเดิม")).toBeChecked();
    expect(screen.queryByLabelText("กำหนดเวลาเหลือใหม่ (นาที:วินาที)")).toBeNull();
    expect(screen.queryByLabelText("ส่วนที่จะให้ทำต่อ")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "สร้าง QR และรหัส" }));
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledOnce());
    expect(mocks.issue.mock.calls[0]?.[2]).not.toHaveProperty("remainingSeconds");
  });
  it("switching back to resume discards a typed award", async () => {
    render(<DeviceRecoveryDialog isOpen scheduleId="s" attemptId="a" onClose={() => {}} />);
    await screen.findByText("Ada");
    fireEvent.click(screen.getByLabelText("ปรับส่วนหรือเวลาเอง"));
    fireEvent.change(screen.getByLabelText("กำหนดเวลาเหลือใหม่ (นาที:วินาที)"), {
      target: { value: "08:00" },
    });
    fireEvent.click(screen.getByLabelText("ทำต่อจากจุดเดิม"));
    fireEvent.click(screen.getByLabelText("ปรับส่วนหรือเวลาเอง"));
    expect(screen.getByLabelText("กำหนดเวลาเหลือใหม่ (นาที:วินาที)")).toHaveValue("");
  });
});
