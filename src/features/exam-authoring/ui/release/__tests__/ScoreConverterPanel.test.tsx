import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../../shared/api-client/errors";
import { ScoreConverterPanel } from "../ScoreConverterPanel";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  converter: null as Record<string, unknown> | null,
  error: null as Error | null,
}));
vi.mock("../../../api/assessmentQueries", () => ({
  useScoreConverter: () => ({ data: { converter: mocks.converter }, isSuccess: true }),
  useSetScoreConverter: () => ({ mutate: mocks.mutate, isPending: false, error: mocks.error }),
}));

// jsdom's File lacks text(); browsers have it.
const file = (text: string) => Object.assign(new File([text], "converter.json", { type: "application/json" }), { text: async () => text });

describe("ScoreConverterPanel", () => {
  it("uploads the parsed file and rejects non-JSON locally", async () => {
    mocks.converter = null;
    mocks.error = null;
    render(<ScoreConverterPanel examId="e1" canEdit />);
    expect(screen.getByText("No converter: raw scores only.")).toBeInTheDocument();
    const input = screen.getByLabelText("Upload converter (JSON)");
    fireEvent.change(input, { target: { files: [file('{"converterVersion":"v1"}')] } });
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith({ converterVersion: "v1" }));
    mocks.mutate.mockClear();
    fireEvent.change(input, { target: { files: [file("{oops")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("The file is not valid JSON.");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("shows the stored version and routes, removes it, and surfaces the server's validation sentence", () => {
    mocks.converter = {
      converterVersion: "classroom-v1",
      calibrationSource: "staff_approved",
      sections: { math: { full_lower: "a", full_higher: "b" } },
      tables: {},
    };
    mocks.error = new ApiError({ code: "VALIDATION", message: 'Table "a" is missing raw score 3.', status: 422 });
    render(<ScoreConverterPanel examId="e1" canEdit />);
    expect(screen.getByText("classroom-v1")).toBeInTheDocument();
    expect(screen.getByText("full_higher, full_lower")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent('Table "a" is missing raw score 3.');
    fireEvent.click(screen.getByRole("button", { name: "Remove converter" }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(null);
  });

  it("is read-only without edit rights", () => {
    mocks.converter = null;
    mocks.error = null;
    render(<ScoreConverterPanel examId="e1" canEdit={false} />);
    expect(screen.getByLabelText("Upload converter (JSON)")).toBeDisabled();
  });
});
