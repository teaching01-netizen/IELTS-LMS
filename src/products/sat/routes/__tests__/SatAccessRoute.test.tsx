import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../features/exam-authoring/api/examQueries", () => ({
  useExamQuery: () => ({ data: { id: "exam-1", title: "Practice SAT", providerKey: "sat", canPublish: true }, isLoading: false }),
}));
vi.mock("../../../../features/exam-authoring/api/assessmentAccessLinkQueries", () => ({
  useAccessDistributionOverview: () => ({ data: { links: [{ id: "b", scheduleId: "schedule-b" }] }, isLoading: false }),
}));
vi.mock("../../../../features/exam-authoring/ui/shell/useExamWorkspaceChrome", () => ({
  useExamWorkspaceChrome: () => ({ lifecycle: { label: "Published" }, showResponses: true }),
}));
vi.mock("../../../../features/auth/api/authSession", () => ({
  useOptionalAuthSession: () => ({ session: { user: { role: "admin" } } }),
}));
vi.mock("../../../../features/exam-authoring/realtime/coedit", () => ({
  useSatAuthoringCollaboration: () => ({}),
  SatAuthoringCollaborationBoundary: () => null,
}));
vi.mock("../../../../features/exam-authoring/ui/delivery/useAccessSessionBindings", () => ({
  useAccessSessionBindings: (options: object) => options,
}));
vi.mock("../../../../features/exam-authoring/ui/access-links/StudentLinksDashboard", () => ({
  StudentLinksDashboard: (props: {
    selectedLinkId: string | null;
    createRequest: { versionId?: string } | null;
    session: { onOpenRoom: (id: string) => void; onOpenResponses: (id: string) => void };
  }) => <>
    <p>Selected group: {props.selectedLinkId}</p>
    {props.createRequest ? <p>Setup: {props.createRequest.versionId ?? "current"}</p> : null}
    <button onClick={() => props.session.onOpenRoom("schedule-b")}>Open room</button>
    <button onClick={() => props.session.onOpenResponses("schedule-b")}>View responses</button>
  </>,
}));

import { SatAccessRoute } from "../SatAccessRoute";

function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}{location.search} · Return: {location.state?.from ?? ""}</p>;
}

function open(path = "/sat/exams/exam-1/access?link=b") {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/sat/exams/:examId/access" element={<><SatAccessRoute /><Location /></>} />
    <Route path="/sat/sessions/:scheduleId" element={<Location />} />
    <Route path="/sat/exams/:examId/responses" element={<Location />} />
  </Routes></MemoryRouter>);
}

describe("Sessions navigation", () => {
  it("returns from the session room to the same session", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Open room" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/sat/sessions/schedule-b · Return: /sat/exams/exam-1/access?link=b");
  });

  it("opens results scoped to that session's backing schedule", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "View responses" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/sat/exams/exam-1/responses?access=schedule-b");
  });

  it("consumes a pinned create-session request while preserving session selection in the URL", async () => {
    open("/sat/exams/exam-1/access?link=b&new=1&version=v-4&versionNumber=4&scope=math");
    expect(screen.getByText("Setup: v-4")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/sat/exams/exam-1/access?link=b · Return:"));
    expect(screen.getByTestId("location")).not.toHaveTextContent("new=1");
  });

  it("ignores the retired reuse handoff instead of opening a form", () => {
    open("/sat/exams/exam-1/access?link=b&reuse=1&version=v-4&versionNumber=4&scope=math");
    expect(screen.queryByText(/Setup:/)).not.toBeInTheDocument();
  });
});
