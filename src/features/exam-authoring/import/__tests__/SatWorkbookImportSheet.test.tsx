import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentAuthoringApi } from "../../api/assessmentAuthoringApi";
import { uploadAssessmentImportAsset } from "../../api/assessmentMediaApi";
import type {
  AssessmentAuthoringShell,
  BatchQuestionDraft,
  SatWorkbookPreview,
} from "../../contracts/assessment";
import { plainContentFromText } from "../../editor/richContent";
import { SatWorkbookImportSheet } from "../SatWorkbookImportSheet";

const draft: BatchQuestionDraft = {
  questionType: "single_choice",
  stimulus: plainContentFromText(""),
  prompt: plainContentFromText("Which value is correct?"),
  answer: {
    kind: "single_choice",
    options: ["A", "B", "C", "D"].map((id) => ({
      id,
      content: plainContentFromText(`Choice ${id}`),
    })),
    correctOptionId: "A",
  },
  rationale: plainContentFromText(""),
  metadata: {
    sectionKey: "reading-writing",
    domain: "information-and-ideas",
    skill: "Central Ideas and Details",
    difficulty: "medium",
    tags: [],
  },
  accessibility: { longDescription: null },
};

const shell: AssessmentAuthoringShell = {
  examId: "exam-1",
  providerKey: "sat",
  versionId: "draft-v1",
  versionRevision: 7,
  sections: [],
};

const MODULES = [
  { moduleKey: "rw-m1", sectionKey: "reading-writing", label: "Reading & Writing · Module 1", expectedCount: 27 },
  { moduleKey: "rw-m2-lower", sectionKey: "reading-writing", label: "Reading & Writing · Module 2 — Lower", expectedCount: 27 },
  { moduleKey: "rw-m2-higher", sectionKey: "reading-writing", label: "Reading & Writing · Module 2 — Higher", expectedCount: 27 },
  { moduleKey: "math-m1", sectionKey: "math", label: "Math · Module 1", expectedCount: 22 },
  { moduleKey: "math-m2-lower", sectionKey: "math", label: "Math · Module 2 — Lower", expectedCount: 22 },
  { moduleKey: "math-m2-higher", sectionKey: "math", label: "Math · Module 2 — Higher", expectedCount: 22 },
];

function detectedModules(keys: string[], overrides: Record<string, { questionCount?: number; ready?: boolean }> = {}) {
  return MODULES.filter((module) => keys.includes(module.moduleKey)).map((module) => ({
    ...module,
    questionCount: overrides[module.moduleKey]?.questionCount ?? module.expectedCount,
    ready: overrides[module.moduleKey]?.ready ?? true,
  }));
}

const ALL_KEYS = MODULES.map((module) => module.moduleKey);

const validPreview: SatWorkbookPreview = {
  importId: "import-1",
  templateVersion: "1",
  rowCount: 147,
  questionCount: 147,
  valid: true,
  assets: [],
  modules: [
    {
      moduleKey: "rw-m1",
      sectionKey: "reading-writing",
      questions: [draft],
    },
  ],
  issues: [],
  targetModuleKeys: ALL_KEYS,
  detected: detectedModules(ALL_KEYS),
};

describe("SAT workbook import sheet", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("describes the authoring guidance included in the template", () => {
    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={0}
        onClose={vi.fn()}
        onCommitted={vi.fn()}
      />
    );

    const download = screen.getByRole("button", { name: "Download SAT Excel template" });
    expect(download).toHaveAttribute("aria-describedby", "sat-workbook-template-hint");
    expect(
      screen.getByText(/Includes a copyable AI prompt, authoring guide, and import checklist\./)
    ).toBeInTheDocument();
  });

  it("rejects a non-xlsx file before previewing it", async () => {
    const preview = vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook");
    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={0}
        onClose={vi.fn()}
        onCommitted={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), {
      target: { files: [new File(["not xlsx"], "SAT.csv", { type: "text/csv" })] },
    });

    expect(await screen.findByText("Choose an .xlsx SAT workbook.")).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });

  it("rejects a workbook over 12 MB before previewing it", async () => {
    const preview = vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook");
    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={0}
        onClose={vi.fn()}
        onCommitted={vi.fn()}
      />
    );

    const oversized = new File([new Uint8Array(12 * 1024 * 1024 + 1)], "SAT.xlsx");
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), {
      target: { files: [oversized] },
    });

    expect(await screen.findByText("SAT workbooks must be 12 MB or smaller.")).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });

  it("keeps the sheet retryable when commit fails", async () => {
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue(validPreview);
    const result = { shell, undo: { importId: "import-1", available: true } };
    const commit = vi
      .spyOn(assessmentAuthoringApi, "commitSatWorkbook")
      .mockRejectedValueOnce(new Error("Version changed; reload and try again."))
      .mockResolvedValueOnce(result);
    const onCommitted = vi.fn();

    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={0}
        onClose={vi.fn()}
        onCommitted={onCommitted}
      />
    );

    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), {
      target: { files: [new File(["xlsx"], "SAT.xlsx")] },
    });
    await waitFor(() => expect(screen.getByText("All 6 modules checked and ready to import")).toBeInTheDocument());

    const importButton = screen.getByRole("button", { name: "Import 147 questions" });
    fireEvent.click(importButton);
    expect(await screen.findByText("Version changed; reload and try again.")).toBeInTheDocument();
    expect(importButton).toBeEnabled();

    fireEvent.click(importButton);
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(result));
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("checks an xlsx before enabling the atomic import", async () => {
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue(validPreview);
    const result = { shell, undo: { importId: "import-1", available: true } };
    const commit = vi.spyOn(assessmentAuthoringApi, "commitSatWorkbook").mockResolvedValue(result);
    const onCommitted = vi.fn();

    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={12}
        onClose={vi.fn()}
        onCommitted={onCommitted}
      />
    );

    const file = new File(["xlsx"], "SAT.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(screen.getByText("All 6 modules checked and ready to import")).toBeInTheDocument()
    );
    const replace = screen.getByRole("button", { name: "Replace draft with 147 questions" });
    expect(replace).toBeDisabled();
    expect(screen.getByText("Confirm the replacement to continue.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /replaces all 12 questions/ }));
    fireEvent.click(replace);

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith("exam-1", expect.objectContaining({
      importId: "import-1",
      expectedVersionId: "draft-v1",
      expectedVersionRevision: 7,
      modules: validPreview.modules,
      assets: [],
    }));
    expect(onCommitted).toHaveBeenCalledWith(result);
  });

  it("stages embedded workbook visuals before enabling import", async () => {
    const assetPreview: SatWorkbookPreview = {
      ...validPreview,
      assets: [
        {
          key: "graph_01",
          fileName: "graph_01.png",
          contentType: "image/png",
          sizeBytes: 1,
          checksumSha256: "checksum",
          altText: "A graph",
          caption: "Workbook graph",
          dataBase64: "AA==",
        },
      ],
    };
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue(assetPreview);
    const media = await import("../../api/assessmentMediaApi");
    vi.spyOn(media, "uploadAssessmentImportAsset").mockResolvedValue({
      id: "asset-1",
      contentType: "image/png",
      fileName: "graph_01.png",
      uploadStatus: "finalized",
      downloadUrl: "https://media.example/asset-1",
    });
    const result = { shell, undo: { importId: "import-1", available: true } };
    const commit = vi.spyOn(assessmentAuthoringApi, "commitSatWorkbook").mockResolvedValue(result);

    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={0}
        onClose={vi.fn()}
        onCommitted={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), {
      target: { files: [new File(["xlsx"], "SAT.xlsx")] },
    });

    await waitFor(() =>
      expect(media.uploadAssessmentImportAsset).toHaveBeenCalledWith(expect.any(File), "import-1")
    );
    const importButton = screen.getByRole("button", { name: "Import 147 questions" });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith(
        "exam-1",
        expect.objectContaining({ assets: [{ key: "graph_01", assetId: "asset-1" }] })
      )
    );
  });

  it("does not commit when an embedded visual cannot be staged", async () => {
    const assetPreview: SatWorkbookPreview = {
      ...validPreview,
      assets: [
        {
          key: "graph_01",
          fileName: "graph_01.png",
          contentType: "image/png",
          sizeBytes: 1,
          checksumSha256: "checksum",
          altText: "A graph",
          caption: null,
          dataBase64: "AA==",
        },
      ],
    };
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue(assetPreview);
    vi.spyOn(
      await import("../../api/assessmentMediaApi"),
      "uploadAssessmentImportAsset"
    ).mockRejectedValue(new Error("Asset storage unavailable."));
    const commit = vi.spyOn(assessmentAuthoringApi, "commitSatWorkbook");

    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={0}
        onClose={vi.fn()}
        onCommitted={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), {
      target: { files: [new File(["xlsx"], "SAT.xlsx")] },
    });

    expect(await screen.findByText("Asset storage unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 147 questions" })).toBeDisabled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps import disabled and shows workbook row diagnostics when validation fails", async () => {
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue({
      ...validPreview,
      valid: false,
      questionCount: 146,
      issues: [
        {
          row: 42,
          field: "Correct",
          message: "Correct answer must be A, B, C, or D.",
          blocking: true,
        },
      ],
    });

    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={0}
        onClose={vi.fn()}
        onCommitted={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), {
      target: { files: [new File(["xlsx"], "SAT.xlsx")] },
    });

    await waitFor(() => expect(screen.getByText(/Questions · Row 42 ·/)).toBeInTheDocument());
    // Nothing is importable yet, so the action stays generic and disabled.
    expect(screen.getByRole("button", { name: "Import workbook" })).toBeDisabled();
  });

  it("retries only the failed visual-staging step without re-checking the workbook", async () => {
    const assetPreview: SatWorkbookPreview = {
      ...validPreview,
      assets: [
        {
          key: "graph_01",
          fileName: "graph_01.png",
          contentType: "image/png",
          sizeBytes: 1,
          checksumSha256: "checksum",
          altText: "A graph",
          caption: null,
          dataBase64: "AA==",
        },
      ],
    };
    const previewSpy = vi
      .spyOn(assessmentAuthoringApi, "previewSatWorkbook")
      .mockResolvedValue(assetPreview);
    const media = await import("../../api/assessmentMediaApi");
    vi.spyOn(media, "uploadAssessmentImportAsset")
      .mockRejectedValueOnce(new Error("Asset storage unavailable."))
      .mockResolvedValueOnce({
        id: "asset-1",
        contentType: "image/png",
        fileName: "graph_01.png",
        uploadStatus: "finalized",
        downloadUrl: "https://media.example/asset-1",
      });

    render(
      <SatWorkbookImportSheet
        open
        examId="exam-1"
        shell={shell}
        existingQuestionCount={0}
        onClose={vi.fn()}
        onCommitted={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), {
      target: { files: [new File(["xlsx"], "SAT.xlsx")] },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Retry securing visuals" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import 147 questions" })).toBeEnabled()
    );
    expect(previewSpy).toHaveBeenCalledTimes(1);
  });

  it("detects the module in the sheet with no scope or module choice, and imports only it", async () => {
    const singlePreview: SatWorkbookPreview = {
      ...validPreview,
      questionCount: 27,
      rowCount: 27,
      targetModuleKeys: ["rw-m1"],
      detected: detectedModules(["rw-m1"]),
      modules: [{ moduleKey: "rw-m1", sectionKey: "reading-writing", questions: Array.from({ length: 27 }, () => draft) }],
    };
    const preview = vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue(singlePreview);
    const commit = vi.spyOn(assessmentAuthoringApi, "commitSatWorkbook").mockResolvedValue({ shell, undo: { importId: "import-1", available: true } });
    const draftShell = {
      ...shell,
      sections: [{ moduleKeys: ["rw-m1"], modules: [{ moduleKey: "rw-m1", questions: Array.from({ length: 20 }) }] }],
    } as unknown as AssessmentAuthoringShell;
    render(<SatWorkbookImportSheet open examId="exam-1" shell={draftShell} existingQuestionCount={20} onClose={vi.fn()} onCommitted={vi.fn()} />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Target module")).not.toBeInTheDocument();

    const file = new File(["xlsx"], "Verbal.xlsx");
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), { target: { files: [file] } });
    const action = await screen.findByRole("button", { name: "Replace module with 27 questions" });
    expect(preview).toHaveBeenCalledWith("exam-1", file);
    expect(screen.getByText("Found in your workbook · 1 of 1 ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Reading & Writing · Module 1" })).toHaveTextContent("Ready to import");
    expect(screen.getByText("27/27")).toBeInTheDocument();
    expect(screen.getByText(/left unchanged: .*Math · Module 2 — Higher/)).toBeInTheDocument();
    expect(screen.queryByText(/this replaces all 20/)).not.toBeInTheDocument();
    expect(action).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /replaces the 20 questions currently in Reading & Writing · Module 1 with 27 questions\. Other modules stay unchanged/ }));
    expect(action).toBeEnabled();
    fireEvent.click(action);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const request = commit.mock.calls[0][1];
    expect(request.targetModuleKeys).toEqual(["rw-m1"]);
    expect(request.modules).toHaveLength(1);
    expect(request).not.toHaveProperty("pretestResolution");
    // The commit carries no pretest field.
    expect(request.modules[0].questions.every((question) => !("isPretest" in question))).toBe(true);
  });

  it("imports several detected modules together", async () => {
    const keys = ["rw-m1", "math-m1"];
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue({
      ...validPreview,
      questionCount: 49,
      targetModuleKeys: keys,
      detected: detectedModules(keys),
      modules: keys.map((moduleKey) => ({ moduleKey, sectionKey: "x", questions: [draft] })),
    });
    const commit = vi.spyOn(assessmentAuthoringApi, "commitSatWorkbook").mockResolvedValue({ shell, undo: { importId: "import-1", available: true } });
    render(<SatWorkbookImportSheet open examId="exam-1" shell={shell} existingQuestionCount={0} onClose={vi.fn()} onCommitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), { target: { files: [new File(["xlsx"], "Two.xlsx")] } });
    const action = await screen.findByRole("button", { name: "Import 49 questions" });
    expect(screen.getByText("Found in your workbook · 2 of 2 ready")).toBeInTheDocument();
    expect(screen.getByText("All 2 modules checked and ready to import")).toBeInTheDocument();
    expect(screen.getByText(/will be imported into Reading & Writing · Module 1, Math · Module 1\. Other modules stay unchanged\./)).toBeInTheDocument();
    fireEvent.click(action);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit.mock.calls[0][1]).toMatchObject({ targetModuleKeys: keys });
  });

  it("names the detected module that needs attention and blocks the whole import", async () => {
    const keys = ["rw-m1", "math-m1"];
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue({
      ...validPreview,
      valid: false,
      questionCount: 47,
      targetModuleKeys: keys,
      detected: detectedModules(keys, { "math-m1": { questionCount: 20, ready: false } }),
      issues: [{ row: 0, field: "Module", message: "Math · Module 1 requires exactly 22 questions; found 20.", blocking: true, moduleKey: "math-m1" }],
    });
    render(<SatWorkbookImportSheet open examId="exam-1" shell={shell} existingQuestionCount={0} onClose={vi.fn()} onCommitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), { target: { files: [new File(["xlsx"], "Partial.xlsx")] } });
    await screen.findByText("Found in your workbook · 1 of 2 ready");
    expect(screen.getByRole("button", { name: "Preview Math · Module 1" })).toHaveTextContent("Needs attention · 1 issue");
    expect(screen.getByRole("button", { name: "Preview Reading & Writing · Module 1" })).toHaveTextContent("Ready to import");
    expect(screen.getByText("20/22")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import workbook" })).toBeDisabled();
    expect(screen.getByText("Fix the module marked Needs attention, then choose the file again.")).toBeInTheDocument();
  });

  it("explains when the workbook has no module content", async () => {
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue({
      ...validPreview,
      valid: false,
      questionCount: 0,
      targetModuleKeys: [],
      detected: [],
      modules: [],
      issues: [{ row: 0, field: "file", message: "No SAT questions were found. Fill in the rows of at least one module in the template.", blocking: true }],
    });
    render(<SatWorkbookImportSheet open examId="exam-1" shell={shell} existingQuestionCount={0} onClose={vi.fn()} onCommitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), { target: { files: [new File(["xlsx"], "Blank.xlsx")] } });
    expect(await screen.findByText(/No module with questions was found\. Fill in the rows/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import workbook" })).toBeDisabled();
    expect(screen.getByText("No module with questions was found in this workbook.")).toBeInTheDocument();
  });

  it("points at the workbook-wide issues when every detected module is ready but the file is blocked", async () => {
    const keys = ["rw-m1"];
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue({
      ...validPreview,
      valid: false,
      questionCount: 27,
      targetModuleKeys: keys,
      detected: detectedModules(keys),
      issues: [{ row: 0, field: "file", message: "Formulas are not allowed in SAT imports. Replace formulas with their displayed values.", blocking: true }],
    });
    render(<SatWorkbookImportSheet open examId="exam-1" shell={shell} existingQuestionCount={0} onClose={vi.fn()} onCommitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), { target: { files: [new File(["xlsx"], "Formula.xlsx")] } });
    await screen.findByText(/Formulas are not allowed/);
    expect(screen.getByRole("button", { name: "Preview Reading & Writing · Module 1" })).toHaveTextContent("Ready to import");
    expect(screen.getByText("Fix the workbook issues listed under Needs attention, then choose the file again.")).toBeInTheDocument();
    expect(screen.queryByText(/marked Needs attention/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import workbook" })).toBeDisabled();
  });

  it("freezes the complete request for a lost-response retry across a shell revision change", async () => {
    const singlePreview: SatWorkbookPreview = {
      ...validPreview,
      questionCount: 27,
      targetModuleKeys: ["rw-m1"],
      detected: detectedModules(["rw-m1"]),
      modules: [{ moduleKey: "rw-m1", sectionKey: "reading-writing", questions: Array.from({ length: 27 }, (_, i) => ({ ...draft })) }],
    };
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockResolvedValue(singlePreview);
    const commit = vi.spyOn(assessmentAuthoringApi, "commitSatWorkbook").mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce({ shell, undo: { importId: "import-1", available: true } });
    const props = { open: true, examId: "exam-1", shell, existingQuestionCount: 0, onClose: vi.fn(), onCommitted: vi.fn() };
    const view = render(<SatWorkbookImportSheet {...props} />);
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), { target: { files: [new File(["xlsx"], "Verbal.xlsx")] } });
    const action = await screen.findByRole("button", { name: "Import 27 questions" });
    fireEvent.click(action);
    await screen.findByText("Response lost");
    view.rerender(<SatWorkbookImportSheet {...props} shell={{ ...props.shell, versionRevision: 8 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry import" }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(commit.mock.calls[1][1]).toEqual(commit.mock.calls[0][1]);
    expect(commit.mock.calls[1][1].expectedVersionRevision).toBe(7);
  });

  it("discards an old workbook check response after a new file finishes checking", async () => {
    let resolveOld!: (preview: SatWorkbookPreview) => void;
    const old = new Promise<SatWorkbookPreview>((resolve) => { resolveOld = resolve; });
    vi.spyOn(assessmentAuthoringApi, "previewSatWorkbook").mockReturnValueOnce(old).mockResolvedValueOnce({ ...validPreview, importId: "new", questionCount: 148 });
    const commit = vi.spyOn(assessmentAuthoringApi, "commitSatWorkbook").mockResolvedValue({ shell, undo: { importId: "new", available: true } });
    render(<SatWorkbookImportSheet open examId="exam-1" shell={shell} existingQuestionCount={0} onClose={vi.fn()} onCommitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), { target: { files: [new File(["xlsx"], "Old.xlsx")] } });
    fireEvent.change(screen.getByLabelText("Choose SAT Excel workbook"), { target: { files: [new File(["xlsx"], "New.xlsx")] } });
    await screen.findByRole("button", { name: "Import 148 questions" });
    await act(async () => { resolveOld(validPreview); await old; });
    expect(screen.getByRole("button", { name: "Import 148 questions" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Import 148 questions" }));
    await waitFor(() => expect(commit.mock.calls[0][1].importId).toBe("new"));
  });
});
