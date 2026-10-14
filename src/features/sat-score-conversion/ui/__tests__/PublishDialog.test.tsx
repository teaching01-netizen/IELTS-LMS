import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScoreConversionImpact, ScoreConversionValidation } from "../../contracts/scoreConversion";
import { PublishDialog } from "../PublishDialog";

const impact: ScoreConversionImpact = { draftId: "d1", activeRevisionId: null, generatedAt: "2026-10-02T00:00:00Z", resultsConsidered: 0, sections: {}, topChanges: [] };

function renderDialog(validation: ScoreConversionValidation, onPublish = vi.fn().mockResolvedValue(undefined)) {
  render(
    <PublishDialog
      open
      validate={() => Promise.resolve(validation)}
      impact={() => Promise.resolve(impact)}
      initialCalibrationSource=""
      hasActive={false}
      onClose={vi.fn()}
      onPublish={onPublish}
    />,
  );
  return { onPublish, dialog: () => screen.getByRole("dialog") };
}

describe("PublishDialog", () => {
  it("does not keep blocking on the calibration source once the field is filled in", async () => {
    // The server validated the SAVED draft, whose calibration source was still empty.
    const { onPublish, dialog } = renderDialog({
      valid: false,
      errors: [{ code: "calibration_source_required", path: "calibrationSource", message: "calibrationSource is required to publish." }],
      warnings: [],
    });
    const publish = await within(dialog()).findByRole("button", { name: "Publish" });
    expect(within(dialog()).queryByText(/Errors that block publishing/)).toBeNull();
    expect(publish).toBeDisabled(); // still needs the source
    fireEvent.change(within(dialog()).getByLabelText("Calibration source"), { target: { value: "College Board test 4" } });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith("College Board test 4"));
  });

  it("says plainly when there are no released results to compare", async () => {
    renderDialog({ valid: true, errors: [], warnings: [] });
    expect(await screen.findByText(/No released SAT results exist yet/)).toBeInTheDocument();
  });

  it("keeps real errors blocking and lists them", async () => {
    renderDialog({ valid: false, errors: [{ code: "incomplete", path: "x", message: "Module 1 correct 3, Module 2 correct 4 has no score." }], warnings: [] });
    expect(await screen.findByText(/Errors that block publishing \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Module 1 correct 3, Module 2 correct 4 has no score.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Calibration source"), { target: { value: "src" } });
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });
});
