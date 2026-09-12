import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  isPretest: false,
};

const shell: AssessmentAuthoringShell = {
  examId: "exam-1",
  providerKey: "sat",
  versionId: "draft-v1",
  versionRevision: 7,
  sections: [],
};

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
};

describe("SAT workbook import sheet", () => {
  beforeEach(() => vi.restoreAllMocks());

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
    await waitFor(() => expect(screen.getByText("Complete SAT ready to import")).toBeInTheDocument());

    const importButton = screen.getByRole("button", { name: "Import 147 Questions" });
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
      expect(screen.getByText("Complete SAT ready to import")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "Import 147 Questions" }));

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
    const importButton = screen.getByRole("button", { name: "Import 147 Questions" });
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
    expect(screen.getByRole("button", { name: "Import 147 Questions" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Import 146 Questions" })).toBeDisabled();
  });
});
