import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import type { ScoreConversionContent, ScoreConversionRevision, ScoreConversionSettings } from "../../contracts/scoreConversion";
import { ScoreConversionPage } from "../ScoreConversionPage";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  listRevisions: vi.fn(),
  getRevision: vi.fn(),
  createDraft: vi.fn(),
  saveDraft: vi.fn(),
  validate: vi.fn(),
  lookup: vi.fn(),
  impact: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("../../api/scoreConversionApi", () => ({ scoreConversionApi: api }));

const matrixCells = (n: number, base: number) => Array.from({ length: n + 1 }, (_, r) => Array.from({ length: n + 1 }, (_, c) => Math.min(base + 10 * (r + c), 800)));

const content = (): ScoreConversionContent => ({
  schemaVersion: 1,
  sections: {
    "reading-writing": { tables: { rw: { kind: "matrix", m1Operational: 2, m2Operational: 2, cells: matrixCells(2, 200) } }, assign: { full_lower: ["rw"], full_higher: ["rw"] } },
    math: { tables: {}, assign: {} },
  },
});

const revision = (over: Partial<ScoreConversionRevision>): ScoreConversionRevision => ({
  id: "v1",
  revisionNumber: 1,
  status: "published",
  baseRevisionId: null,
  content: content(),
  contentSha256: "abc",
  calibrationSource: "College Board practice test 4",
  note: "",
  restoredFromId: null,
  version: 2,
  createdBy: "admin-1",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  publishedAt: "2026-10-01T00:00:00Z",
  publishedBy: "admin-1",
  active: true,
  ...over,
});

const draftRevision = (over: Partial<ScoreConversionRevision> = {}) =>
  revision({ id: "d1", revisionNumber: null, status: "draft", baseRevisionId: "v1", contentSha256: null, version: 1, publishedAt: null, publishedBy: null, active: false, calibrationSource: "", ...over });

const settings = (over: Partial<ScoreConversionSettings> = {}): ScoreConversionSettings => ({
  active: revision({}),
  drafts: [],
  blueprint: { "reading-writing": { m1Operational: 25, m2Operational: 25 }, math: { m1Operational: 20, m2Operational: 20 } },
  ...over,
});

function renderPage(node: ReactNode = <ScoreConversionPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const cell = (row: number, col: number) => document.querySelector<HTMLElement>(`[data-cell="${row},${col}"]`)!;

function typeInto(row: number, col: number, text: string) {
  fireEvent.doubleClick(cell(row, col));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

async function openDraft() {
  fireEvent.click(await screen.findByRole("button", { name: "New draft from active version" }));
  await screen.findByRole("button", { name: "Save draft" });
}

describe("ScoreConversionPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.getSettings.mockResolvedValue(settings());
    api.createDraft.mockResolvedValue(draftRevision());
    api.getRevision.mockImplementation(async (id: string) => (id === "d1" ? draftRevision() : revision({ id })));
    api.listRevisions.mockResolvedValue([revision({ content: undefined })]);
  });

  it("shows the active version read-only and offers a draft instead of in-place edits", async () => {
    renderPage();
    expect(await screen.findByText("Active · Version 1")).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Reading & Writing, Module 1 + lower Module 2" })).toHaveAttribute("aria-readonly", "true");
    expect(cell(1, 2)).toHaveAccessibleName("Module 1 correct 1, Module 2 correct 2, score 230");
    fireEvent.doubleClick(cell(1, 2));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  it("edits a draft, highlights what changed, and saves with the version it started from", async () => {
    api.saveDraft.mockImplementation(async (_id: string, _version: number, body: { content: ScoreConversionContent }) => draftRevision({ version: 2, content: body.content }));
    renderPage();
    await openDraft();
    expect(api.createDraft).toHaveBeenCalledWith(undefined);
    typeInto(1, 2, "790");
    expect(cell(1, 2)).toHaveTextContent("790");
    expect(cell(1, 2)).toHaveAttribute("data-state", "changed");
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    const [id, version, body] = api.saveDraft.mock.calls[0]!;
    expect([id, version]).toEqual(["d1", 1]);
    expect(body.content.sections["reading-writing"].tables.rw.cells[1][2]).toBe(790);
    expect(await screen.findByText("Draft saved. Released scores are unchanged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("will not save text that is not a whole number, and says where it is", async () => {
    renderPage();
    await openDraft();
    typeInto(0, 1, "abc");
    expect(cell(0, 1)).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/1 cell contain text that is not a whole number \(first: "abc"/)).toBeInTheDocument();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("explains a stale save (412) and reloads the latest draft on request", async () => {
    api.saveDraft.mockRejectedValue(new ApiError({ code: "PRECONDITION_FAILED", message: "stale", status: 412 }));
    renderPage();
    await openDraft();
    typeInto(0, 0, "300");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/changed in another tab or by another administrator/)).toBeInTheDocument();
    api.getRevision.mockResolvedValue(draftRevision({ version: 5 }));
    fireEvent.click(screen.getByRole("button", { name: "Reload latest draft" }));
    await waitFor(() => expect(cell(0, 0)).toHaveTextContent("200"));
  });

  it("imports a pasted sheet with headers into the table", async () => {
    renderPage();
    await openDraft();
    fireEvent.click(screen.getByRole("radio", { name: "Paste import" }));
    const rows = ["\t0\t1\t2", "0\t400\t410\t420", "1\t410\t420\t430", "2\t420\t430\t440"].join("\r\n");
    fireEvent.change(screen.getByLabelText("Table to import"), { target: { value: rows } });
    fireEvent.click(screen.getByRole("button", { name: "Import into this table" }));
    expect(await screen.findByText(/Imported 9 cells/)).toBeInTheDocument();
    expect(cell(2, 2)).toHaveTextContent("440");
    // A bad header is refused and leaves the table alone.
    fireEvent.click(screen.getByRole("radio", { name: "Paste import" }));
    fireEvent.change(screen.getByLabelText("Table to import"), { target: { value: rows.replace("\t1\t2", "\t1\t1") } });
    fireEvent.click(screen.getByRole("button", { name: "Import into this table" }));
    expect(await screen.findByText(/Duplicate Column header "1"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Edit table" }));
    expect(cell(2, 2)).toHaveTextContent("440");
  });

  it("undo and redo work from the toolbar", async () => {
    renderPage();
    await openDraft();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    typeInto(0, 0, "800");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell(0, 0)).toHaveTextContent("200");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(cell(0, 0)).toHaveTextContent("800");
  });

  describe("publishing", () => {
    const validOk = { valid: true, errors: [], warnings: [{ code: "non_monotonic", path: "p", message: "A score is lower than its neighbour." }] };
    const impact = {
      draftId: "d1",
      activeRevisionId: "v1",
      generatedAt: "2026-10-02T00:00:00Z",
      resultsConsidered: 12,
      sections: { "reading-writing": { considered: 12, changed: 10, unchanged: 1, becomesUnavailable: 1, becomesAvailable: 0, minDelta: -30, maxDelta: 120 } },
      topChanges: [{ section: "reading-writing", topology: "full_higher", m1: 2, m2: 2, count: 10, oldScore: { low: 240, high: 240 }, newScore: { low: 300, high: 300 } }],
    };

    it("is blocked while the server reports errors", async () => {
      api.validate.mockResolvedValue({ valid: false, errors: [{ code: "incomplete", path: "x", message: "Module 1 correct 1, Module 2 correct 1 has no score." }], warnings: [] });
      api.impact.mockResolvedValue(impact);
      renderPage();
      await openDraft();
      fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
      const dialog = await screen.findByRole("dialog");
      expect(await within(dialog).findByText(/Errors that block publishing/)).toBeInTheDocument();
      fireEvent.change(within(dialog).getByLabelText("Calibration source"), { target: { value: "source" } });
      expect(within(dialog).getByRole("button", { name: "Publish" })).toBeDisabled();
      expect(api.publish).not.toHaveBeenCalled();
    });

    it("shows the impact, requires a calibration source, publishes, and confirms the new active version", async () => {
      api.validate.mockResolvedValue(validOk);
      api.impact.mockResolvedValue(impact);
      api.saveDraft.mockImplementation(async (_id: string, _v: number, body: { calibrationSource: string; content: ScoreConversionContent }) => draftRevision({ version: 2, calibrationSource: body.calibrationSource }));
      api.publish.mockResolvedValue({ revision: revision({ id: "d1", revisionNumber: 2 }), alreadyActive: false });
      renderPage();
      await openDraft();
      fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
      const dialog = await screen.findByRole("dialog");
      expect(await within(dialog).findByText(/12 released results compared with the active version/)).toBeInTheDocument();
      expect(within(dialog).getByText(/No errors\. 1 warning to review\./)).toBeInTheDocument();
      expect(within(dialog).getByText(/10 \(-30 to \+120\)/)).toBeInTheDocument();
      const publish = within(dialog).getByRole("button", { name: "Publish" });
      expect(publish).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText("Calibration source"), { target: { value: "College Board test 5" } });
      await waitFor(() => expect(publish).toBeEnabled());
      fireEvent.click(publish);
      await waitFor(() => expect(api.publish).toHaveBeenCalledWith("d1"));
      expect(api.saveDraft).toHaveBeenCalledWith("d1", 1, expect.objectContaining({ calibrationSource: "College Board test 5" }));
      expect(await screen.findByText(/Version 2 is now active\. Every SAT result, past and future, uses it\./)).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("explains a stale base and offers a fresh draft from the active version", async () => {
      api.validate.mockResolvedValue({ valid: true, errors: [], warnings: [] });
      api.impact.mockResolvedValue(impact);
      api.saveDraft.mockResolvedValue(draftRevision({ version: 2, calibrationSource: "src" }));
      api.publish.mockRejectedValue(new ApiError({ code: "STALE_BASE", message: "x", status: 409 }));
      renderPage();
      await openDraft();
      fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Publish" })).toBeDisabled());
      fireEvent.change(within(dialog).getByLabelText("Calibration source"), { target: { value: "src" } });
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Publish" })).toBeEnabled());
      fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
      expect(await within(dialog).findByText(/Another administrator published a newer version/)).toBeInTheDocument();
    });
  });

  it("restores an old version as a new draft from the history", async () => {
    api.listRevisions.mockResolvedValue([revision({ id: "v2", revisionNumber: 2, content: undefined }), revision({ id: "v1", revisionNumber: 1, active: false, content: undefined })]);
    api.getSettings.mockResolvedValue(settings({ active: revision({ id: "v2", revisionNumber: 2 }) }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Version history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore version 1 as new draft" }));
    await waitFor(() => expect(api.createDraft).toHaveBeenCalledWith("v1"));
    expect(await screen.findByText(/Restored as a new draft/)).toBeInTheDocument();
    // The active version offers no restore.
    expect(screen.queryByRole("button", { name: "Restore version 2 as new draft" })).toBeNull();
  });

  it("starts from nothing: no active version, empty subject, blueprint-sized new table", async () => {
    api.getSettings.mockResolvedValue(settings({ active: null }));
    api.createDraft.mockResolvedValue(draftRevision({ baseRevisionId: null, content: { schemaVersion: 1, sections: { "reading-writing": { tables: {}, assign: {} }, math: { tables: {}, assign: {} } } } }));
    api.getRevision.mockResolvedValue(draftRevision({ baseRevisionId: null, content: { schemaVersion: 1, sections: { "reading-writing": { tables: {}, assign: {} }, math: { tables: {}, assign: {} } } } }));
    renderPage();
    expect(await screen.findByText("No active version")).toBeInTheDocument();
    expect(screen.getByText("Nothing published yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New draft" }));
    await screen.findByRole("button", { name: "Save draft" });
    expect(screen.getByLabelText("Module 1 scored questions")).toHaveValue("25");
    fireEvent.click(screen.getByRole("radio", { name: "Math" }));
    expect(screen.getByLabelText("Module 1 scored questions")).toHaveValue("20");
    fireEvent.click(screen.getByRole("button", { name: "Create empty table" }));
    const grid = await screen.findByRole("grid", { name: "Math, Module 1 + lower Module 2" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(21 * 21);
    expect(cell(0, 0)).toHaveAccessibleName(expect.stringContaining("score empty"));
  });

  it("reports a failed load with a retry", async () => {
    // 403 is a definitive answer, so the query does not retry it before reporting.
    api.getSettings.mockRejectedValue(new ApiError({ code: "FORBIDDEN", message: "no", status: 403 }));
    renderPage();
    expect(await screen.findByText("Score conversion could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Only administrators can change the score conversion.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
