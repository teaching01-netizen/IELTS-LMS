import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatReportDownload } from "../SatReportActions";

describe("native PDF download", () => {
  it("offers a real same-origin download link after preparation, without opening a preview", () => {
    const ready = {
      downloadUrl: "/api/v1/sat-answered-pdf/downloads/0123456789abcdef0123456789abcdef",
      filename: "Answered exam.pdf",
      sizeBytes: 100,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    render(<SatReportDownload canPrint download="ready" ready={ready} onPrint={vi.fn()} />);
    const link = screen.getByRole("link", { name: "Download PDF again" });
    expect(link).toHaveAttribute("href", ready.downloadUrl);
    expect(link).toHaveAttribute("download", ready.filename);
    expect(link).not.toHaveAttribute("target");
  });

  it("prevents using an expired link and offers preparation again", () => {
    const prepare = vi.fn();
    const ready = {
      downloadUrl: "/api/v1/sat-answered-pdf/downloads/0123456789abcdef0123456789abcdef",
      filename: "Answered exam.pdf",
      sizeBytes: 100,
      expiresAt: new Date(Date.now() - 1).toISOString(),
    };
    render(<SatReportDownload canPrint download="ready" ready={ready} onPrint={prepare} />);
    fireEvent.click(screen.getByRole("link", { name: "Download PDF again" }));
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
