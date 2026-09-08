import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpineHeader, type SpineHeaderProps } from "../SpineHeader";

function props(overrides: Partial<SpineHeaderProps> = {}): SpineHeaderProps {
  return {
    examTitle: "SAT Practice 1",
    sectionTitle: "Reading & Writing",
    moduleTitle: "Module 1",
    authored: 18,
    target: 27,
    progressPct: 67,
    errorCount: 2,
    workspaceMode: "build",
    onModeChange: vi.fn(),
    workbookImportDisabled: false,
    onOpenWorkbookImport: vi.fn(),
    previewDisabled: false,
    onOpenFullPreview: vi.fn(),
    releaseHref: "/sat/exams/exam-1/release",
    onOpenRelease: vi.fn(),
    onBack: vi.fn(),
    onOpenQueue: vi.fn(),
    ...overrides,
  };
}

describe("SpineHeader", () => {
  it("announces numeric module progress as L1 hierarchy", () => {
    render(<SpineHeader {...props()} />);
    expect(screen.getByRole("heading", { name: "SAT Practice 1" })).toBeInTheDocument();
    expect(screen.getByText(/18 of 27 questions authored/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /18 of 27 questions authored/ })).toBeInTheDocument();
  });

  it("switches between build and issues modes with the error badge", () => {
    const onModeChange = vi.fn();
    render(<SpineHeader {...props({ onModeChange })} />);
    const group = screen.getByRole("group", { name: "Authoring view" });
    expect(group).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: /issues 2/i }));
    expect(onModeChange).toHaveBeenCalledWith("issues");
  });

  it("keeps import, preview, and release reachable with flush-guarded callbacks", () => {
    const onOpenWorkbookImport = vi.fn();
    const onOpenFullPreview = vi.fn();
    const onOpenRelease = vi.fn();
    render(<SpineHeader {...props({ onOpenWorkbookImport, onOpenFullPreview, onOpenRelease })} />);
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    fireEvent.click(screen.getByRole("button", { name: /open the full sat preview/i }));
    fireEvent.click(screen.getByRole("link", { name: /^release$/i }));
    expect(onOpenWorkbookImport).toHaveBeenCalledTimes(1);
    expect(onOpenFullPreview).toHaveBeenCalledTimes(1);
    expect(onOpenRelease).toHaveBeenCalledTimes(1);
  });
});
