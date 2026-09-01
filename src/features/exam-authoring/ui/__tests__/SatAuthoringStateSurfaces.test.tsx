import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SatAuthoringErrorSurface,
  SatAuthoringLoadingSurface,
} from "../SatAuthoringStateSurfaces";

describe("SAT authoring state surfaces", () => {
  it("renders a SAT-specific loading landmark", () => {
    render(<SatAuthoringLoadingSurface label="Opening SAT workspace…" />);

    const loading = screen.getByRole("status");
    expect(loading).toHaveAttribute("data-sat-authoring-state", "loading");
    expect(loading).toHaveTextContent("Opening SAT workspace…");
    expect(loading).toHaveClass("sat-product", "sat-authoring");
  });

  it("renders a recoverable SAT-specific error landmark", () => {
    const onRetry = vi.fn();
    render(
      <SatAuthoringErrorSurface
        title="Unable to load the SAT authoring workspace"
        description="The draft is temporarily unavailable."
        actionLabel="Retry"
        onAction={onRetry}
      />
    );

    expect(screen.getByRole("alert")).toHaveAttribute("data-sat-authoring-state", "error");
    expect(screen.getByRole("heading", { name: "Unable to load the SAT authoring workspace" })).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
