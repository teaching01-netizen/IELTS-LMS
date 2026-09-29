/**
 * Phase 04 ACT reconciliation — provider-aware post-exam copy.
 *
 * IELTS copy is byte-identical to the pre-Phase-04 strings (default provider).
 * ACT renders provider-aware copy; the phase renderer maps examState.type
 * "ACT" to provider "act". Zero SAT/IELTS regression: defaults unchanged.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudentPostExamView } from "../StudentPostExamView";

const baseProps = {
  isProctorTerminated: false,
  proctorNote: null,
  studentInfo: [],
  onExit: vi.fn(),
  finalSubmitOverlay: null,
} as const;

describe("Phase 04 post-exam provider copy", () => {
  it("keeps IELTS copy by default (no provider prop)", () => {
    render(<StudentPostExamView {...baseProps} />);
    expect(screen.getByRole("heading", { name: /ielts examination complete/i })).toBeInTheDocument();
    expect(screen.getByText(/all modules of the ielts examination/i)).toBeInTheDocument();
  });

  it("renders ACT Science copy for provider act", () => {
    const { container } = render(<StudentPostExamView {...baseProps} provider="act" />);
    expect(screen.getByRole("heading", { name: /act science complete/i })).toBeInTheDocument();
    expect(screen.getByText(/act science section/i)).toBeInTheDocument();
    expect(screen.queryByText(/ielts examination/i)).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("min-h-screen", "min-h-[100dvh]");
    expect(screen.getByRole("main")).toHaveClass("w-full", "max-w-5xl");
  });

  it("tells ACT users they can close the tab without navigating or showing a browser-close button", () => {
    const onExit = vi.fn();
    render(<StudentPostExamView {...baseProps} onExit={onExit} provider="act" />);

    expect(screen.getByText(/you may now close this tab/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close this tab/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /exit exam platform/i })).not.toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("renders SAT copy for provider sat without touching IELTS defaults", () => {
    render(<StudentPostExamView {...baseProps} provider="sat" />);
    expect(screen.getByRole("heading", { name: /sat complete/i })).toBeInTheDocument();
    expect(screen.queryByText(/ielts examination/i)).not.toBeInTheDocument();
  });
});
