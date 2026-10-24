import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/src/shared/api-client/errors";
import type { EvaState } from "@/src/features/assessment-forms/api/assessmentForms";
import { SatEvaCompletionGate } from "../SatEvaCompletion";

const evaSimMock = vi.hoisted(() => vi.fn());
const submitEvaSimMock = vi.hoisted(() => vi.fn());
vi.mock("../../../api/assessmentDeliveryApi", () => ({
  assessmentDeliveryApi: { evaSim: evaSimMock, submitEvaSim: submitEvaSimMock },
}));

const fields = [
  { id: "q_mood", type: "single_choice" as const, label: "How did it go?", required: true, scope: "math" as const, options: [{ id: "good", label: "Good" }, { id: "bad", label: "Bad" }] },
];

function nativeState(overrides: Partial<Extract<EvaState, { mode: "native" }>> = {}): EvaState {
  return {
    eligibility: "eligible",
    mode: "native",
    collection: "open",
    versionId: "ver-1",
    closedAt: null,
    canReturnToComplete: false,
    response: "not_submitted",
    canSubmit: true,
    fields,
    revision: 0,
    ...overrides,
  } as EvaState;
}

function embedState(overrides: Record<string, unknown> = {}): EvaState {
  return {
    eligibility: "eligible",
    mode: "embed",
    collection: "open",
    versionId: "ver-1",
    closedAt: null,
    canReturnToComplete: true,
    response: "not_tracked",
    canSubmit: false,
    canOpen: true,
    embedUrl: "https://forms.example.org/f/1",
    externalOpenUrl: "https://forms.example.org/f/1",
    embedHost: "forms.example.org",
    ...overrides,
  } as EvaState;
}

function renderGate(recoveryException = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SatEvaCompletionGate
        scheduleId="sched-1"
        attemptId="attempt-1"
        recoveryException={recoveryException}
        renderComplete={(eva) => (
          <div>
            <h1 data-sat-stage-heading="true" tabIndex={-1}>
              SAT Complete
            </h1>
            {eva}
          </div>
        )}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  evaSimMock.mockReset();
  submitEvaSimMock.mockReset();
  window.sessionStorage.clear();
});

describe("SatEvaCompletionGate", () => {
  it("shows SAT Complete without an Eva card when Eva is not applicable", async () => {
    evaSimMock.mockResolvedValue({ eligibility: "not_applicable", reason: "disabled", mode: null, canReturnToComplete: true });
    renderGate();
    expect(await screen.findByRole("heading", { name: "SAT Complete" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Eva SIM" })).not.toBeInTheDocument();
  });

  it("checks Eva first and never skips an unknown mandatory form", async () => {
    evaSimMock.mockRejectedValue(new Error("offline"));
    renderGate();
    expect(screen.getByText("Checking Eva SIM…")).toBeInTheDocument();
    expect(screen.getByText("SAT submission confirmed")).toBeInTheDocument();
    // The hook retries once before surfacing the failure.
    expect(await screen.findByText("Unable to load Eva SIM. Your SAT submission is recorded.", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "SAT Complete" })).not.toBeInTheDocument();
  });

  it("keeps recovery-exception wording above Eva", async () => {
    evaSimMock.mockResolvedValue(nativeState());
    renderGate(true);
    expect(await screen.findByText("SAT submission confirmed with a recovery exception")).toBeInTheDocument();
  });

  it("requires the first native submission, then shows the accepted status with Edit", async () => {
    evaSimMock.mockResolvedValue(nativeState());
    submitEvaSimMock.mockResolvedValue({ revision: 1, firstSubmittedAt: "2026-10-22T10:00:00Z", updatedAt: "2026-10-22T10:00:00Z", answers: { q_mood: "good" } });
    renderGate();
    expect(await screen.findByText("Submit Eva SIM to continue. You can edit your response until your proctor ends the exam.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to SAT Complete/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit Eva SIM" }));
    expect(await screen.findByText("This question is required.")).toBeInTheDocument();
    expect(submitEvaSimMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/How did it go/), { target: { value: "good" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Eva SIM" }));
    await waitFor(() => expect(screen.getByText("Eva SIM submitted")).toBeInTheDocument());
    expect(submitEvaSimMock).toHaveBeenCalledWith("sched-1", "attempt-1", expect.objectContaining({ expectedRevision: 0, versionId: "ver-1", answers: { q_mood: "good" } }));
    expect(screen.getByRole("button", { name: "Edit Eva SIM" })).toBeInTheDocument();
  });

  it("replays the same operation after an unconfirmed submission", async () => {
    evaSimMock.mockResolvedValue(nativeState());
    submitEvaSimMock.mockRejectedValueOnce(new ApiError({ code: "INTERNAL", message: "boom", status: 503 }));
    submitEvaSimMock.mockResolvedValueOnce({ revision: 1, firstSubmittedAt: "2026-10-22T10:00:00Z", updatedAt: "2026-10-22T10:00:00Z", answers: { q_mood: "bad" } });
    renderGate();
    fireEvent.change(await screen.findByLabelText(/How did it go/), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Eva SIM" }));
    expect(await screen.findByText("Unable to confirm your submission. Check status or retry.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(submitEvaSimMock).toHaveBeenCalledTimes(2));
    const [first, second] = submitEvaSimMock.mock.calls.map((call) => call[2]);
    expect(second.operationId).toBe(first.operationId);
    expect(await screen.findByText("Eva SIM submitted")).toBeInTheDocument();
  });

  it("reports a closed native form with no response truthfully and offers no submit", async () => {
    evaSimMock.mockResolvedValue(nativeState({ collection: "closed", canSubmit: false, canReturnToComplete: true, closedAt: "2026-10-22T11:00:00Z" }));
    renderGate();
    expect(await screen.findByText("Eva SIM closed · not submitted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eva SIM/ })).not.toBeInTheDocument();
  });

  it("opens an embedded form in an isolated frame with Back and a new-tab fallback, and Back sticks", async () => {
    evaSimMock.mockResolvedValue(embedState());
    renderGate();
    const frame = await screen.findByTitle("Eva SIM form from forms.example.org");
    expect(frame).toHaveAttribute("sandbox", "allow-forms allow-scripts allow-same-origin");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByText(/does not track submission of this external form/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open form in new tab/ });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");

    fireEvent.click(screen.getByRole("button", { name: /Back to SAT Complete/ }));
    expect(await screen.findByText("External Eva SIM · submission not tracked")).toBeInTheDocument();
    expect(screen.queryByTitle(/Eva SIM form/)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("sat-eva-view:attempt-1")).toBe("complete");
  });

  it("removes embed access once closed and never reopens it", async () => {
    evaSimMock.mockResolvedValueOnce(embedState({ collection: "closed", canOpen: false, embedUrl: null, externalOpenUrl: null }));
    renderGate();
    expect(await screen.findByText("Eva SIM access closed · submission not tracked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Eva SIM" })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Eva SIM form/)).not.toBeInTheDocument();
  });
});
