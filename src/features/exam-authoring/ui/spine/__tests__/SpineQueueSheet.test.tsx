import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpineQueueSheet } from "../SpineQueueSheet";

describe("SpineQueueSheet", () => {
  it("labels the sheet for the queue in build mode", () => {
    render(
      <SpineQueueSheet
        open
        issuesMode={false}
        onOpenChange={vi.fn()}
        onCaptureOpener={vi.fn()}
        onRestoreOpener={vi.fn()}
      >
        <div>queue body</div>
      </SpineQueueSheet>,
    );
    expect(screen.getByText("Question navigator")).toBeInTheDocument();
    expect(screen.getByText("queue body")).toBeInTheDocument();
  });

  it("labels the sheet for issues in issues mode", () => {
    render(
      <SpineQueueSheet
        open
        issuesMode
        onOpenChange={vi.fn()}
        onCaptureOpener={vi.fn()}
        onRestoreOpener={vi.fn()}
      >
        <div>issues body</div>
      </SpineQueueSheet>,
    );
    expect(screen.getByText("Authoring issues")).toBeInTheDocument();
  });
});
