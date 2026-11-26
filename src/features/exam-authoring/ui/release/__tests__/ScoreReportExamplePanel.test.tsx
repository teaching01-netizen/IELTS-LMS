import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();

vi.mock("../../../api/scoreReportExampleApi", () => ({
  saveScoreReportExample: (...args: unknown[]) => save(...args),
}));

import { ScoreReportExamplePanel } from "../ScoreReportExamplePanel";

afterEach(() => {
  save.mockReset();
  vi.restoreAllMocks();
});

describe("ScoreReportExamplePanel", () => {
  it("downloads the example and returns to an idle button", async () => {
    save.mockResolvedValue(undefined);
    render(<ScoreReportExamplePanel examId="exam-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Download example PDF/ }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("exam-1"));
    expect(screen.getByRole("button", { name: /Download example PDF/ })).toBeEnabled();
  });

  it("keeps the button disabled while the PDF is being prepared", async () => {
    let finish!: () => void;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<ScoreReportExamplePanel examId="exam-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Download example PDF/ }));
    expect(screen.getByRole("button", { name: /Preparing example…/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the score report example…");

    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: /Download example PDF/ })).toBeEnabled());
  });

  it("surfaces a render failure and leaves the download retryable", async () => {
    save.mockRejectedValue(new Error("The PDF renderer is busy. Try again."));
    render(<ScoreReportExamplePanel examId="exam-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Download example PDF/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The PDF renderer is busy. Try again.");
    expect(screen.getByRole("button", { name: /Download example PDF/ })).toBeEnabled();
  });
});
