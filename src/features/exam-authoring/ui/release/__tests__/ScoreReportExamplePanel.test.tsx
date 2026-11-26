import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.fn();

vi.mock("../../../api/scoreReportExampleApi", () => ({
  scoreReportExampleApi: { download: (...args: unknown[]) => download(...args) },
}));

import { ScoreReportExamplePanel } from "../ScoreReportExamplePanel";

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:score-report-example"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  download.mockReset();
  vi.restoreAllMocks();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: originalCreate });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: originalRevoke });
});

describe("ScoreReportExamplePanel", () => {
  it("downloads the example under the server filename", async () => {
    download.mockResolvedValue({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      filename: "SAT Practice 04 - Score report example.pdf",
    });
    const anchors: HTMLAnchorElement[] = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === "a") anchors.push(element as HTMLAnchorElement);
      return element;
    }) as typeof document.createElement);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");

    render(<ScoreReportExamplePanel examId="exam-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Download example PDF/ }));

    await waitFor(() => expect(download).toHaveBeenCalledWith("exam-1"));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchors[0]).toHaveAttribute("download", "SAT Practice 04 - Score report example.pdf");
    expect(screen.getByRole("button", { name: /Download example PDF/ })).toBeEnabled();
  });

  it("keeps the button disabled while the PDF is being prepared", async () => {
    let finish!: (value: unknown) => void;
    download.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<ScoreReportExamplePanel examId="exam-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Download example PDF/ }));
    const busy = screen.getByRole("button", { name: /Preparing example…/ });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the score report example…");

    finish({ blob: new Blob(["%PDF"]), filename: "example.pdf" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Download example PDF/ })).toBeEnabled());
  });

  it("surfaces a render failure and leaves the download retryable", async () => {
    download.mockRejectedValue(new Error("The PDF renderer is busy. Try again."));
    render(<ScoreReportExamplePanel examId="exam-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Download example PDF/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The PDF renderer is busy. Try again.");
    expect(screen.getByRole("button", { name: /Download example PDF/ })).toBeEnabled();
  });
});
