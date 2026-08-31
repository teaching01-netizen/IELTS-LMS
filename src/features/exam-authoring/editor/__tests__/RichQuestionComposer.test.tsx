import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { plainContentFromText } from "../richContent";
import { RichQuestionComposer, SAT_CHOICE_COMPOSER_CAPABILITIES } from "../RichQuestionComposer";

describe("SAT rich question composer capabilities", () => {
  it("keeps rich SAT choice tools available in compact presentation", async () => {
    render(
      <RichQuestionComposer
        value={plainContentFromText("Choice A")}
        onChange={vi.fn()}
        label="Answer choice A"
        compact
        capabilities={SAT_CHOICE_COMPOSER_CAPABILITIES}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Answer choice A" })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Underline (⌘U)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert equation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert image or graph" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert table" })).toBeInTheDocument();
  });
});
