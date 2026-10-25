import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/src/shared/api-client/errors";
import type { ExamForms, ExamFormsDocument } from "@/src/features/assessment-forms/api/assessmentForms";
import { upgradeToSectionForms } from "@/src/features/assessment-forms/api/assessmentForms";
import { FormsSettingsPanel } from "../FormsSettingsPanel";

const examFormsMock = vi.hoisted(() => vi.fn());
const saveExamFormsMock = vi.hoisted(() => vi.fn());
vi.mock("@/src/features/assessment-forms/infrastructure/assessmentFormsGateway", () => ({
  assessmentFormsApi: { examForms: examFormsMock, saveExamForms: saveExamFormsMock },
}));

const standard: ExamForms = {
  schemaVersion: 1,
  registration: {
    fields: [
      { id: "sat_seat_number", type: "text", label: "Seat number", required: true, scope: "all", maxLength: 255 },
      { id: "sat_expected_class", type: "single_choice", label: "Expected Class", required: true, scope: "math", options: [{ id: "rank_1", label: "Rank 1" }] },
    ],
  },
  evaSim: { enabled: false, mode: "native" },
};

function doc(forms: ExamForms | null, revision = 3): ExamFormsDocument {
  return {
    versionId: "ver-draft",
    versionRevision: revision,
    editable: true,
    forms,
    standard,
    issues: [],
    limits: { maxFields: 50, maxOptions: 50, maxLabelChars: 200, maxHelpChars: 300, maxTextAnswerChars: 4000, maxUrlChars: 2048 },
  };
}

function renderPanel(onDirty = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FormsSettingsPanel examId="exam-1" canEdit onDirtyCountChange={onDirty} />
    </QueryClientProvider>
  );
  return onDirty;
}

afterEach(() => {
  examFormsMock.mockReset();
  saveExamFormsMock.mockReset();
});

describe("FormsSettingsPanel", () => {
  it("lists questions with type, requirement and applicability, and never writes on load", async () => {
    examFormsMock.mockResolvedValue(doc(standard));
    renderPanel();
    expect(await screen.findByRole("button", { name: "Edit Seat number" })).toBeInTheDocument();
    expect(screen.getByText("Single choice · Required · Math")).toBeInTheDocument();
    expect(screen.getByText(/Student ID\/WCODE, full name and email/)).toBeInTheDocument();
    expect(saveExamFormsMock).not.toHaveBeenCalled();
  });

  it("turns custom forms on with the standard SAT fields instead of inserting them on open", async () => {
    examFormsMock.mockResolvedValue(doc(null));
    saveExamFormsMock.mockResolvedValue(doc(standard, 4));
    renderPanel();
    const toggle = await screen.findByRole("switch", { name: "Custom exam forms" });
    expect(toggle).not.toBeChecked();
    expect(saveExamFormsMock).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await waitFor(() => expect(saveExamFormsMock).toHaveBeenCalledWith("exam-1", { expectedVersionId: "ver-draft", expectedRevision: 3, forms: standard }));
    expect(await screen.findByRole("button", { name: "Edit Seat number" })).toBeInTheDocument();
  });

  it("turns custom forms off after confirmation, hiding section forms and Eva SIM", async () => {
    examFormsMock.mockResolvedValue(doc(standard));
    saveExamFormsMock.mockResolvedValue(doc(null, 4));
    renderPanel();
    fireEvent.click(await screen.findByRole("switch", { name: "Custom exam forms" }));
    expect(saveExamFormsMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Turn off forms" }));
    await waitFor(() => expect(saveExamFormsMock).toHaveBeenCalledWith("exam-1", { expectedVersionId: "ver-draft", expectedRevision: 3, forms: null }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Custom exam forms" })).not.toBeChecked());
    expect(screen.queryByRole("heading", { name: "Eva SIM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Seat number" })).not.toBeInTheDocument();
  });

  it("saves one section with the other section's confirmed value, never its unsaved input", async () => {
    examFormsMock.mockResolvedValue(doc(standard));
    const onDirty = renderPanel();
    await screen.findByRole("button", { name: "Edit Seat number" });

    // Unsaved Eva edit.
    fireEvent.click(screen.getByRole("switch", { name: "Enable Eva SIM" }));
    // Registration edit: move Expected Class up.
    fireEvent.click(screen.getByRole("button", { name: "Move Expected Class up" }));
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(2));

    const saved: ExamForms = { ...standard, registration: { fields: [standard.registration.fields[1]!, standard.registration.fields[0]!] } };
    saveExamFormsMock.mockResolvedValue(doc(saved, 4));
    fireEvent.click(screen.getByRole("button", { name: "Save registration form" }));

    await waitFor(() => expect(saveExamFormsMock).toHaveBeenCalledTimes(1));
    const sent = saveExamFormsMock.mock.calls[0]![1];
    expect(sent.forms.registration.fields.map((f: { id: string }) => f.id)).toEqual(["sat_expected_class", "sat_seat_number"]);
    expect(sent.forms.evaSim).toEqual(standard.evaSim);
    // The Eva edit stays dirty and unsaved.
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(1));
    expect(screen.getByRole("switch", { name: "Enable Eva SIM" })).toBeChecked();
  });

  it("retries once with the new revision when only question edits moved the draft", async () => {
    examFormsMock.mockResolvedValueOnce(doc(standard, 3)).mockResolvedValue(doc(standard, 7));
    saveExamFormsMock
      .mockRejectedValueOnce(new ApiError({ code: "CONFLICT", message: "changed", status: 409, details: { reason: "FORM_DRAFT_CHANGED" } }))
      .mockResolvedValueOnce(doc({ ...standard, evaSim: { enabled: true, mode: "native", fields: [] } }, 8));
    renderPanel();
    await screen.findByRole("button", { name: "Edit Seat number" });
    fireEvent.click(screen.getByRole("switch", { name: "Enable Eva SIM" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Eva SIM" }));
    await waitFor(() => expect(saveExamFormsMock).toHaveBeenCalledTimes(2));
    expect(saveExamFormsMock.mock.calls[1]![1].expectedRevision).toBe(7);
    expect(screen.queryByText("These forms changed elsewhere.")).not.toBeInTheDocument();
  });

  it("surfaces a real conflict without replacing local edits", async () => {
    const other: ExamForms = { ...standard, registration: { fields: [standard.registration.fields[0]!] } };
    examFormsMock.mockResolvedValueOnce(doc(standard, 3)).mockResolvedValue(doc(other, 9));
    saveExamFormsMock.mockRejectedValue(new ApiError({ code: "CONFLICT", message: "changed", status: 409, details: { reason: "FORM_DRAFT_CHANGED" } }));
    renderPanel();
    await screen.findByRole("button", { name: "Edit Seat number" });
    fireEvent.click(screen.getByRole("switch", { name: "Enable Eva SIM" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Eva SIM" }));
    expect(await screen.findByText("These forms changed elsewhere.")).toBeInTheDocument();
    expect(saveExamFormsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch", { name: "Enable Eva SIM" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Edit Expected Class" })).toBeInTheDocument();
  });

  it("confirms before discarding Eva content on a mode switch, and checks the URL before saving", async () => {
    examFormsMock.mockResolvedValue(
      doc({ ...standard, evaSim: { enabled: true, mode: "native", fields: [{ id: "q_a", type: "text", label: "Comment", required: false, scope: "math", maxLength: 255 }] } })
    );
    renderPanel();
    await screen.findByRole("button", { name: "Edit Comment" });
    fireEvent.click(screen.getByRole("radio", { name: "Embedded link" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change form type" }));
    const url = await screen.findByLabelText("Form URL");
    fireEvent.change(url, { target: { value: "http://forms.example.org/x" } });
    expect(screen.getByText("The URL must use https://.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Eva SIM" }));
    expect(saveExamFormsMock).not.toHaveBeenCalled();
    fireEvent.change(url, { target: { value: "https://forms.example.org/x" } });
    expect(screen.getByText("Destination: forms.example.org")).toBeInTheDocument();
  });
});

describe("separate section form settings", () => {
  it("upgrades only after a review and preserves question identities", async () => {
    examFormsMock.mockResolvedValue(doc(standard));
    const upgraded = upgradeToSectionForms(standard);
    saveExamFormsMock.mockResolvedValue(doc(upgraded, 4));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Review section form upgrade" }));
    const review = screen.getByRole("dialog", { name: "Review section form upgrade" });
    expect(within(review).getByText("Before Math")).toBeInTheDocument();
    expect(saveExamFormsMock).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole("button", { name: "Enable separate section forms" }));
    await waitFor(() => expect(saveExamFormsMock).toHaveBeenCalledWith("exam-1", { expectedVersionId: "ver-draft", expectedRevision: 3, forms: upgraded }));
    expect(await screen.findByRole("heading", { name: "Verbal entry form" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Math entry form" })).toBeInTheDocument();
  });
  it("saves Math independently of unsaved Verbal and Eva edits", async () => {
    const split = upgradeToSectionForms(standard);
    examFormsMock.mockResolvedValue(doc(split));
    const onDirty = renderPanel();
    const verbalHeading = await screen.findByRole("heading", { name: "Verbal entry form" });
    const verbalSection = verbalHeading.closest("section")!;
    fireEvent.click(within(verbalSection).getByRole("button", { name: "Add question" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable Eva SIM" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Expected Class" }));
    fireEvent.change(screen.getByDisplayValue("Expected Class"), { target: { value: "Math class preference" } });
    saveExamFormsMock.mockImplementation((_exam, request) => Promise.resolve(doc(request.forms, 4)));
    fireEvent.click(screen.getByRole("button", { name: "Save Math entry form" }));
    await waitFor(() => expect(saveExamFormsMock).toHaveBeenCalledTimes(1));
    const sent = saveExamFormsMock.mock.calls[0]![1].forms;
    expect(sent.schemaVersion).toBe(2);
    expect(sent.sectionEntry.math.fields[0].label).toBe("Math class preference");
    expect(sent.sectionEntry["reading-writing"].fields).toEqual([]);
    expect(sent.evaSim).toEqual(split.evaSim);
    expect(sent.sectionEntry.math.fields[0]).not.toHaveProperty("scope");
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(2));
  });
});

it("disables and re-enables Math without deleting its questions", async () => {
  const split = upgradeToSectionForms(standard);
  examFormsMock.mockResolvedValue(doc(split));
  saveExamFormsMock.mockImplementation((_exam, request) => Promise.resolve(doc(request.forms, 4 + saveExamFormsMock.mock.calls.length)));
  renderPanel();
  const toggle = await screen.findByRole("switch", { name: "Enable Math entry form" });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(screen.getByText(/Disabled — students skip this form/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save Math entry form" }));
  await waitFor(() => expect(saveExamFormsMock).toHaveBeenCalledTimes(1));
  const off = saveExamFormsMock.mock.calls[0]![1].forms;
  expect(off.sectionEntry.math.enabled).toBe(false);
  expect(off.sectionEntry.math.fields).toEqual(split.sectionEntry.math.fields);
  expect(off.sectionEntry["reading-writing"]).toEqual(split.sectionEntry["reading-writing"]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save Math entry form" })).toBeDisabled());
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Save Math entry form" }));
  await waitFor(() => expect(saveExamFormsMock).toHaveBeenCalledTimes(2));
  expect(saveExamFormsMock.mock.calls[1]![1].forms.sectionEntry.math).toEqual({ ...split.sectionEntry.math, enabled: true });
});
