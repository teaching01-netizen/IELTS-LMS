import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudentDeviceRecoveryRoute } from "../StudentDeviceRecoveryRoute";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  ready: vi.fn(),
  begin: vi.fn(),
  refresh: vi.fn(),
  installIdentity: vi.fn(),
  store: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("../../infrastructure/deviceRecoveryGateway", () => ({ recoveryGateway: mocks }));
vi.mock("../../../auth/api/authSession", () => ({
  useAuthSession: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@services/attemptCredentialAdapter", () => ({ storeAttemptCredential: mocks.store }));
vi.mock("@services/studentAttemptRepository", () => ({
  restoreClientSessionIdForStudentKey: mocks.restore,
  satWriterStudentKey: (schedule: string, candidate: string) => `student-${schedule}-${candidate}`,
}));
const ready = {
  grantId: "g",
  state: "claimed",
  grantRevision: 2,
  candidateName: "Ada",
  examTitle: "IELTS",
  providerKey: "ielts",
  serverNow: new Date().toISOString(),
  target: { sectionKey: "reading", label: "Reading" },
  timePolicy: { mode: "awarded", awardedSeconds: 480 },
  checkpoint: { responsesSaved: 3 },
};
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/student/recover/g"]}>
      <Routes>
        <Route path="/student/recover/:grantId" element={<StudentDeviceRecoveryRoute />} />
      </Routes>
    </MemoryRouter>
  );
describe("StudentDeviceRecoveryRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    history.replaceState({}, "", "/student/recover/g#key=private-link");
    mocks.claim.mockResolvedValue(ready);
    mocks.ready.mockResolvedValue(ready);
    mocks.begin.mockRejectedValue(new Error("Response lost"));
    mocks.refresh.mockResolvedValue({ user: { id: "u" } });
  });
  it("installs the fresh writer identity before navigation and removes consumed browser secrets", async () => {
    const result = {
      recovery: {
        grantId: "g",
        routePath: "/student/s/c",
        attemptId: "a",
        scheduleId: "s",
        candidateId: "c",
      },
      clientSessionId: "fresh-session",
      attemptCredential: {
        attemptToken: "fresh-token",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    };
    mocks.begin.mockResolvedValue(result);
    mount();
    fireEvent.change(screen.getByLabelText("รหัส 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบรหัส" }));
    await screen.findByText("Ada");
    fireEvent.click(screen.getByRole("button", { name: "ทำข้อสอบต่อ" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.installIdentity).toHaveBeenCalledWith(result);
    expect(mocks.installIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0]!
    );
    await waitFor(() => expect(sessionStorage.getItem("staff-device-recovery:g")).toBeNull());
  });
  it("withholds identity until claim and requires explicit Continue after preparation", async () => {
    mount();
    expect(screen.queryByText("Ada")).toBeNull();
    expect(mocks.begin).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("รหัส 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบรหัส" }));
    await screen.findByText("Ada");
    expect(location.hash).toBe("");
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("staff-device-recovery:g")).not.toContain("123456");
    fireEvent.click(screen.getByRole("button", { name: "ทำข้อสอบต่อ" }));
    // Raw transport text is never shown; the retry copy is.
    await screen.findByText("เริ่มทำต่อไม่สำเร็จ กดอีกครั้งเพื่อลองคำขอเดิม");
    expect(screen.queryByText("Response lost")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ทำข้อสอบต่อ" }));
    await waitFor(() => expect(mocks.begin).toHaveBeenCalledTimes(2));
    expect(mocks.begin.mock.calls[0]).toEqual(mocks.begin.mock.calls[1]);
  });
  it("reload after a lost claim response retains proof and operation without persisting code", async () => {
    mocks.claim.mockRejectedValueOnce(new Error("Response lost"));
    const mounted = mount();
    fireEvent.change(screen.getByLabelText("รหัส 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบรหัส" }));
    await screen.findByText("ตรวจสอบรหัสไม่สำเร็จ กดอีกครั้งเพื่อลองใหม่");
    const first = mocks.claim.mock.calls[0]?.[1];
    mounted.unmount();
    mount();
    fireEvent.change(screen.getByLabelText("รหัส 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบรหัส" }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(2));
    expect(mocks.claim.mock.calls[1]?.[1]).toEqual(first);
  });
  it("normalizes a pasted grouped code before claiming", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("รหัส 6 หลัก"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบรหัส" }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledOnce());
    expect(mocks.claim.mock.calls[0]?.[1]).toMatchObject({ code: "123456" });
  });
  it("shows mapped copy for a terminal refusal and locks the form", async () => {
    mocks.claim.mockRejectedValueOnce(
      Object.assign(new Error("This recovery code has expired."), {
        details: { reason: "RECOVERY_EXPIRED" },
      })
    );
    mount();
    fireEvent.change(screen.getByLabelText("รหัส 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบรหัส" }));
    await screen.findByText("รหัสหมดอายุแล้ว ขอรหัสใหม่จากเจ้าหน้าที่");
    expect(screen.queryByText("This recovery code has expired.")).toBeNull();
    expect(screen.getByRole("button", { name: "ตรวจสอบรหัส" })).toBeDisabled();
  });
  it("starts fresh instead of failing when the saved preparation is corrupt", async () => {
    sessionStorage.setItem("staff-device-recovery:g", "{not json");
    mount();
    expect(await screen.findByLabelText("รหัส 6 หลัก")).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
