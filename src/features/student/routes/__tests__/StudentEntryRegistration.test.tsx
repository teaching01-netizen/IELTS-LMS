import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/src/shared/api-client/errors";
import type { PublicRegistrationForm } from "@/src/features/assessment-forms/api/assessmentForms";
import { StudentEntryRoute } from "../StudentEntryRoute";

const navigateMock = vi.fn();
const studentEntryMock = vi.fn();
const getStudentEntryScheduleMock = vi.hoisted(() => vi.fn());

vi.mock("../../infrastructure/studentEntryGateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infrastructure/studentEntryGateway")>()),
  getStudentEntrySchedule: getStudentEntryScheduleMock,
  isStudentEntryScheduleBlockedError: () => false,
}));
vi.mock("../../../auth/authSession", () => ({
  useAuthSession: () => ({ status: "unauthenticated", session: null, refresh: vi.fn(), studentEntry: studentEntryMock }),
}));
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigateMock,
}));

const SCHEDULE = "550e8400-e29b-41d4-a716-446655449001";

const standardForm: PublicRegistrationForm = {
  versionId: "ver-1",
  schemaVersion: 1,
  fields: [
    { id: "sat_admission_year", type: "number", label: "Admission year (ค.ศ.)", help: "Expected university admission year, e.g. 2027.", required: true, scope: "all", integer: true, min: 1000, max: 9999 },
    { id: "sat_seat_number", type: "text", label: "Seat number", required: true, scope: "all", maxLength: 255 },
    {
      id: "sat_expected_class",
      type: "single_choice",
      label: "Expected Class",
      required: true,
      scope: "math",
      options: [
        { id: "unenroll", label: "Unenroll" },
        { id: "rank_1", label: "Rank 1" },
      ],
    },
  ],
};

function renderRoute() {
  render(
    <MemoryRouter initialEntries={[`/student/${SCHEDULE}`]}>
      <Routes>
        <Route path="/student/:scheduleId" element={<StudentEntryRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText("Student ID/WCODE"), { target: { value: "W250334" } });
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Student One" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "student@example.com" } });
}

const admitted = {
  user: { id: "s1", email: "student@example.com", displayName: "Student One", role: "student", state: "active" },
  csrfToken: "csrf",
  expiresAt: "2026-01-01T12:00:00.000Z",
};

describe("SAT check-in registration form", () => {
  beforeEach(() => {
    getStudentEntryScheduleMock.mockResolvedValue({ status: "live", providerKey: "sat", registrationForm: standardForm });
  });
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    navigateMock.mockReset();
    studentEntryMock.mockReset();
    getStudentEntryScheduleMock.mockReset();
  });

  it("renders Exam details after identity, with an empty expected-class choice and mode-aware next steps", async () => {
    renderRoute();
    expect(await screen.findByRole("group", { name: "Exam details" })).toBeInTheDocument();
    const select = screen.getByLabelText(/Expected Class/) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "Select expected class" })).toBeInTheDocument();
    expect(screen.getByText("Expected university admission year, e.g. 2027.")).toBeInTheDocument();
    expect(screen.getByText("Enter your Student ID/WCODE, name, email, and exam details.")).toBeInTheDocument();
  });

  it("blocks Continue on invalid details, focuses the first invalid one, and sends typed answers when valid", async () => {
    renderRoute();
    await screen.findByRole("group", { name: "Exam details" });
    fillIdentity();
    fireEvent.change(screen.getByLabelText(/Admission year/), { target: { value: "27" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("Enter 1000 or more.")).toBeInTheDocument();
    expect(screen.getAllByText("This question is required.")).toHaveLength(2);
    expect(studentEntryMock).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Admission year/)));

    studentEntryMock.mockResolvedValue(admitted);
    fireEvent.change(screen.getByLabelText(/Admission year/), { target: { value: "2027" } });
    fireEvent.change(screen.getByLabelText(/Seat number/), { target: { value: " A-007 " } });
    fireEvent.change(screen.getByLabelText(/Expected Class/), { target: { value: "rank_1" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(studentEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: SCHEDULE,
          registrationForm: {
            versionId: "ver-1",
            answers: { sat_admission_year: 2027, sat_seat_number: "A-007", sat_expected_class: "rank_1" },
          },
        })
      )
    );
  });

  it("explains a changed form, keeps compatible answers and requires review before resubmitting", async () => {
    renderRoute();
    await screen.findByRole("group", { name: "Exam details" });
    fillIdentity();
    fireEvent.change(screen.getByLabelText(/Admission year/), { target: { value: "2027" } });
    fireEvent.change(screen.getByLabelText(/Seat number/), { target: { value: "A-007" } });
    fireEvent.change(screen.getByLabelText(/Expected Class/), { target: { value: "rank_1" } });

    const changed: PublicRegistrationForm = {
      versionId: "ver-2",
      schemaVersion: 1,
      fields: [
        standardForm.fields[1]!,
        { id: "sat_admission_year", type: "text", label: "Admission year", required: true, scope: "all", maxLength: 10 },
      ],
    };
    getStudentEntryScheduleMock.mockResolvedValue({ status: "live", providerKey: "sat", registrationForm: changed });
    studentEntryMock.mockRejectedValueOnce(
      new ApiError({ code: "CONFLICT", message: "The registration form changed.", status: 409, details: { reason: "FORM_VERSION_CHANGED" } })
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("The registration form changed. Review your details and continue.")).toBeInTheDocument();
    expect((screen.getByLabelText(/Seat number/) as HTMLInputElement).value).toBe("A-007");
    // Same id, different type: not carried over.
    expect((screen.getByLabelText(/Admission year/) as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText(/Expected Class/)).not.toBeInTheDocument();
    expect(studentEntryMock).toHaveBeenCalledTimes(1);
  });

  it("maps server field errors onto the affected question", async () => {
    renderRoute();
    await screen.findByRole("group", { name: "Exam details" });
    fillIdentity();
    fireEvent.change(screen.getByLabelText(/Admission year/), { target: { value: "2027" } });
    fireEvent.change(screen.getByLabelText(/Seat number/), { target: { value: "A-007" } });
    fireEvent.change(screen.getByLabelText(/Expected Class/), { target: { value: "rank_1" } });
    studentEntryMock.mockRejectedValueOnce(
      new ApiError({ code: "VALIDATION_FAILED", message: "Check your details.", status: 422, details: { fields: { sat_seat_number: "Seat is not valid." } } })
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText("Seat is not valid.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Seat number/)).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the legacy card unchanged when no registration form applies", async () => {
    getStudentEntryScheduleMock.mockResolvedValue({ status: "live", providerKey: "sat", registrationForm: null });
    studentEntryMock.mockResolvedValue(admitted);
    renderRoute();
    await screen.findByRole("heading", { name: "Exam Check-in" });
    expect(screen.queryByRole("group", { name: "Exam details" })).not.toBeInTheDocument();
    fillIdentity();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(studentEntryMock).toHaveBeenCalled());
    expect(studentEntryMock.mock.calls[0]![0]).not.toHaveProperty("registrationForm");
  });
});
