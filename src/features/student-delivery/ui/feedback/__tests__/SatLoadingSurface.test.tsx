import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SAT_LOADING_LABELS,
  SatLoadingSurface,
  type SatLoadingKind,
} from "../SatStateSurfaces";

const KINDS: readonly SatLoadingKind[] = ["initial", "module-refresh", "finalizing"];

describe("SatLoadingSurface", () => {
  it("defaults to kind initial with the cold-open label and probe attr", () => {
    render(<SatLoadingSurface />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading Digital SAT…");
    expect(status).toHaveAttribute("data-sat-loading-kind", "initial");
  });

  it.each(KINDS)("kind %s renders its canonical label", (kind) => {
    render(<SatLoadingSurface kind={kind} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(SAT_LOADING_LABELS[kind]);
    expect(status).toHaveAttribute("data-sat-loading-kind", kind);
  });

  it("label overrides the canonical string but keeps the kind probe", () => {
    render(
      <SatLoadingSurface
        kind="finalizing"
        label="Time expired — submitting your saved answers."
      />
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Time expired — submitting your saved answers.");
    expect(status).toHaveAttribute("data-sat-loading-kind", "finalizing");
  });

  it("legacy label-only call still renders (route plus preview call sites)", () => {
    render(<SatLoadingSurface label="Loading SAT draft preview…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading SAT draft preview…");
    expect(status).toHaveAttribute("data-sat-loading-kind", "initial");
  });

  it("exposes exactly one live region", () => {
    const { container } = render(<SatLoadingSurface kind="module-refresh" />);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
});
