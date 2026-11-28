import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wordVaultApi, type WordVaultPreview } from "../../api/wordVaultApi";
import { WordVaultImportSheet } from "../WordVaultImportSheet";

const preview: WordVaultPreview = {
  draftId: "draft-1",
  revision: 3,
  digest: "digest-1",
  before: 2,
  entries: [
    {
      moduleKey: "rw-m1",
      module: "Reading & Writing · Module 1",
      question: 1,
      word: "adapt",
      thai: "ปรับตัว",
      definition: "To adjust to a new situation.",
      example: "The team adapted to the new schedule.",
    },
  ],
  impact: [{ module: "Reading & Writing · Module 1", before: 2, after: 1 }],
  issues: [],
};

function chooseWorkbook(name = "vocabulary.xlsx") {
  fireEvent.change(screen.getByLabelText("Choose vocabulary workbook"), {
    target: { files: [new File(["xlsx"], name)] },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WordVaultImportSheet", () => {
  it("checks and replaces only the selected published version", async () => {
    const version = { id: "version-1", number: 1 };
    const checked = { ...preview, draftId: "", versionId: version.id };
    const inspect = vi.spyOn(wordVaultApi, "preview").mockResolvedValue(checked);
    const commit = vi.spyOn(wordVaultApi, "commit").mockResolvedValue({
      draftId: "", versionId: version.id, revision: 3, count: 1,
    });
    const onSaved = vi.fn();
    render(<WordVaultImportSheet open examId="exam-1" onClose={vi.fn()} onSaved={onSaved}
      publishedVersions={[{ id: "version-2", number: 2 }, version]} />);

    fireEvent.change(screen.getByLabelText("Exam version"), { target: { value: version.id } });
    chooseWorkbook();
    const replace = await screen.findByRole("button", { name: "Replace Word Vault" });
    expect(inspect).toHaveBeenCalledWith("exam-1", expect.any(File), version.id);
    expect(screen.getByText(/Students who took this version/)).toBeInTheDocument();
    fireEvent.click(replace);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1, version));
    expect(commit).toHaveBeenCalledWith("exam-1", expect.any(File), checked, expect.any(String));
  });

  it("replaces the draft vault without an acknowledgement checkbox", async () => {
    vi.spyOn(wordVaultApi, "preview").mockResolvedValue(preview);
    const commit = vi
      .spyOn(wordVaultApi, "commit")
      .mockResolvedValue({ draftId: "draft-1", revision: 4, count: 1 });
    const onSaved = vi.fn();
    render(<WordVaultImportSheet open examId="exam-1" onClose={vi.fn()} onSaved={onSaved} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    chooseWorkbook();

    expect(await screen.findByRole("heading", { name: "Review vocabulary" })).toBeInTheDocument();
    expect(screen.getByText(/Replaces all 2 words in this draft/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    // The explicit replace button IS the confirmation.
    const replace = screen.getByRole("button", { name: "Replace Word Vault" });
    expect(replace).toBeEnabled();
    fireEvent.click(replace);

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith("exam-1", expect.any(File), preview, expect.any(String));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
  });

  it("clears an existing draft vault from a header-only workbook", async () => {
    vi.spyOn(wordVaultApi, "preview").mockResolvedValue({
      ...preview,
      before: 2,
      entries: [],
      impact: [{ module: "Reading & Writing · Module 1", before: 2, after: 0 }],
    });
    const commit = vi
      .spyOn(wordVaultApi, "commit")
      .mockResolvedValue({ draftId: "draft-1", revision: 4, count: 0 });
    const onSaved = vi.fn();
    render(<WordVaultImportSheet open examId="exam-1" onClose={vi.fn()} onSaved={onSaved} />);

    chooseWorkbook();
    const remove = await screen.findByRole("button", { name: "Remove all draft words" });
    expect(screen.getByText(/Removes every word from this draft/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(remove);

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(0));
  });

  it("accepts a first import with no draft vocabulary and no acknowledgement", async () => {
    vi.spyOn(wordVaultApi, "preview").mockResolvedValue({
      ...preview,
      before: 0,
      impact: [{ module: "Reading & Writing · Module 1", before: 0, after: 1 }],
    });
    render(<WordVaultImportSheet open examId="exam-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    chooseWorkbook();
    expect(await screen.findByRole("button", { name: "Import 1 word" })).toBeEnabled();
    expect(screen.getByText("1 word will be added to the draft.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps the commit blocked while Excel cells need attention", async () => {
    vi.spyOn(wordVaultApi, "preview").mockResolvedValue({
      ...preview,
      issues: [{ row: 2, column: "B", message: "Question 99 does not exist in this module." }],
    });
    render(<WordVaultImportSheet open examId="exam-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    chooseWorkbook();
    expect(await screen.findByRole("heading", { name: "Workbook needs attention" })).toBeInTheDocument();
    expect(screen.getByText("Vocabulary · B2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace Word Vault" })).not.toBeInTheDocument();
  });
});
