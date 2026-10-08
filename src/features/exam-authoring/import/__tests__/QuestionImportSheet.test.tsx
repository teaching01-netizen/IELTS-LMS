import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionImportSheet } from "../QuestionImportSheet";

const HEADER = "Prompt\tA\tB\tC\tD\tCorrect\tDomain\tSkill\tDifficulty\n";
const validRow = (n: number) =>
  `Question ${n}\tA1\tB1\tC1\tD1\tA\tinformation-and-ideas\tCentral Ideas and Details\tmedium\n`;

function renderSheet(
  overrides: Partial<React.ComponentProps<typeof QuestionImportSheet>> = {}
) {
  const onImport = vi.fn().mockResolvedValue(undefined);
  render(
    <QuestionImportSheet
      open
      sectionKey="reading-writing"
      remainingCapacity={5}
      destinationLabel="Reading & Writing · Module 1"
      isImporting={false}
      onClose={vi.fn()}
      onImport={onImport}
      {...overrides}
    />
  );
  return { onImport };
}

const setSource = (value: string) =>
  fireEvent.change(screen.getByLabelText("Question import data"), { target: { value } });

describe("QuestionImportSheet", () => {
  it("shows destination and capacity, and disables import with a reason when nothing is valid", () => {
    renderSheet();
    expect(screen.getAllByText("Reading & Writing · Module 1").length).toBeGreaterThan(0);
    expect(screen.getByText("5 questions")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Import 0 valid questions" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Add at least one valid row to import.")).toBeInTheDocument();
  });

  it("labels the action with the exact valid count and imports once", async () => {
    let resolve: () => void = () => undefined;
    const onImport = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    renderSheet({ onImport });
    setSource(HEADER + validRow(1));
    const button = await screen.findByRole("button", { name: "Import 1 valid question" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
    resolve();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import 1 valid question" })).toBeEnabled()
    );
  });

  it("blocks over-capacity imports and explains how many rows to remove", async () => {
    renderSheet({ remainingCapacity: 1 });
    setSource(HEADER + validRow(1) + validRow(2) + validRow(3));
    const button = await screen.findByRole("button", { name: "Import 3 valid questions" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Remove 2 rows/)).toBeInTheDocument();
  });

  it("lists excluded rows with reasons", async () => {
    renderSheet();
    setSource(HEADER + validRow(1) + "Broken\tA1\tB1\tC1\tD1\tZ\tx\ty\tmedium\n");
    const list = await screen.findByRole("list", { name: "Excluded rows" });
    expect(list.textContent).toMatch(/Row 3 excluded/);
    expect(screen.getByRole("button", { name: "Import 1 valid question" })).toBeEnabled();
  });

  it("keeps the input and focuses the error when import fails", async () => {
    const onImport = vi.fn().mockRejectedValue(new Error("Server said no."));
    renderSheet({ onImport });
    setSource(HEADER + validRow(1));
    fireEvent.click(await screen.findByRole("button", { name: "Import 1 valid question" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Server said no.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText("Question import data")).toHaveValue(HEADER + validRow(1));
  });
});
