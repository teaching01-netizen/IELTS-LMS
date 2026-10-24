import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SatFormResponsesRoute } from "../SatFormResponsesRoute";

const responsesMock = vi.hoisted(() => vi.fn());
const detailMock = vi.hoisted(() => vi.fn());
const roomsMock = vi.hoisted(() => [
  { schedule: { id: "sched-1", examId: "exam-1", examTitle: "SAT Practice", cohortName: "Room A" } },
  { schedule: { id: "sched-2", examId: "exam-2", examTitle: "SAT Mock 2", cohortName: "Room B" } },
]);
vi.mock("@/src/features/proctor/api/proctorQueries", () => ({
  useProctorSessionSummaries: () => ({ data: roomsMock }),
}));
vi.mock("@/src/features/assessment-forms/infrastructure/assessmentFormsGateway", () => ({
  assessmentFormsApi: { responses: responsesMock, responseDetail: detailMock },
}));

const row = {
  attemptId: "att-1",
  studentName: "Student One",
  studentEmail: "one@example.com",
  studentCode: "W1",
  examId: "exam-1",
  examTitle: "SAT Practice",
  scheduleId: "sched-1",
  scheduleName: "Room A",
  versionId: "ver-1",
  versionNumber: 2,
  formKey: "eva_sim",
  mode: "embed",
  status: "not_tracked",
  collection: "open",
  closedAt: null,
  revision: 0,
  updatedAt: null,
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/sat/forms" element={<SatFormResponsesRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  responsesMock.mockReset();
  detailMock.mockReset();
});

describe("SatFormResponsesRoute", () => {
  it("distinguishes an empty scope from no matches", async () => {
    responsesMock.mockResolvedValue({ items: [], nextCursor: null });
    renderAt("/sat/forms");
    expect(await screen.findByText("No form responses in this scope")).toBeInTheDocument();
  });

  it("offers Clear filters when filters match nothing", async () => {
    responsesMock.mockResolvedValue({ items: [], nextCursor: null });
    renderAt("/sat/forms?form=eva_sim&mode=native&status=submitted");
    expect(await screen.findByText("No matches for these filters")).toBeInTheDocument();
    expect(responsesMock).toHaveBeenCalledWith({ formKey: "eva_sim", mode: "native", status: "submitted" }, null);
  });

  it("shows external Eva as not tracked, with no answers or submitted time", async () => {
    responsesMock.mockResolvedValue({ items: [row], nextCursor: null });
    detailMock.mockResolvedValue({ ...row, fields: [], answers: null, embedHost: "forms.example.org", firstSubmittedAt: null });
    renderAt("/sat/forms?form=eva_sim&attempt=att-1");
    expect(await screen.findByText("SAT Practice · Room A · v2 · External")).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/does not track whether the student submitted it/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/First submitted/)).not.toBeInTheDocument();
  });

  it("filters by exam, then by that exam's rooms", async () => {
    responsesMock.mockResolvedValue({ items: [], nextCursor: null });
    renderAt("/sat/forms");
    await screen.findByText("No form responses in this scope");
    fireEvent.change(screen.getByLabelText("Exam"), { target: { value: "exam-2" } });
    const room = screen.getByLabelText("Room") as HTMLSelectElement;
    expect([...room.options].map((option) => option.textContent)).toEqual(["All", "Room B"]);
    fireEvent.change(room, { target: { value: "sched-2" } });
    await waitFor(() => expect(responsesMock).toHaveBeenLastCalledWith({ formKey: "registration", examId: "exam-2", scheduleId: "sched-2" }, null));
    expect(screen.getByText("Exam: SAT Mock 2 · Room: Room B")).toBeInTheDocument();
  });
});
