import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpineHeader } from "../SpineHeader";

describe("SpineHeader", () => {
  it("announces numeric module progress as L1 hierarchy", () => {
    render(
      <SpineHeader
        examTitle="SAT Practice 1"
        sectionTitle="Reading & Writing"
        moduleTitle="Module 1"
        authored={18}
        target={27}
        progressPct={67}
        onBack={vi.fn()}
        onOpenQueue={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "SAT Practice 1" })).toBeInTheDocument();
    expect(screen.getByText(/18 of 27 questions authored/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /18 of 27 questions authored/ })).toBeInTheDocument();
  });
});
