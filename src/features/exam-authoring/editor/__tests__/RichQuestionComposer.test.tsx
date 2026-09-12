import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { plainContentFromText } from "../richContent";
import { FastQuestionComposer } from "../FastQuestionComposer";
import { RichQuestionComposer, SAT_CHOICE_COMPOSER_CAPABILITIES } from "../RichQuestionComposer";

describe("SAT rich question composer capabilities", () => {
  it("shows only five default controls plus overflow", async () => {
    render(<RichQuestionComposer value={plainContentFromText("Hello")} onChange={vi.fn()} label="Question" />);
    const toolbar=await screen.findByRole("toolbar", {name:"Formatting tools"});
    expect(within(toolbar).getAllByRole("button")).toHaveLength(5);
    expect(within(toolbar).getByRole("combobox", {name:"Text style"})).toBeInTheDocument();
  });
  it("retains a persisted text-block identity when the editor loads", async () => {
    render(<RichQuestionComposer value={{ version: 2, nodes: [], document: {
      type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'passage-evidence' }, content: [{ type: 'text', text: 'Evidence' }] }],
    } }} onChange={vi.fn()} label="Passage" />);
    const editor = await screen.findByRole('textbox', { name: 'Passage' });
    expect(editor.querySelector('p')).toHaveAttribute('data-content-id', 'passage-evidence');
  });
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
    expect(screen.getByRole("toolbar", { name: "Formatting tools" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Insert equation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"More formatting"}));
    expect(screen.getByRole("menuitem", {name:"Underline (⌘U)"})).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", {name:"Bulleted list"})).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), {key:"Escape"});
    fireEvent.click(screen.getByRole("button", {name:"Insert content"}));
    for(const name of ["Insert image or graph", "Code block", "Insert table"]) expect(screen.getByRole("menuitem",{name})).toBeInTheDocument();
  });

  it("applies the inline placement layout to the equation preview", async () => {
    render(
      <RichQuestionComposer
        value={plainContentFromText("Question prompt")}
        onChange={vi.fn()}
        label="Question prompt"
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Insert equation" })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "Insert equation" }));

    const previewLabel = screen.getByText("Preview");
    const preview = previewLabel.parentElement?.children[1];
    expect(preview).toHaveClass("items-center", "justify-start");
  });

  it("starts plain SAT content in the rich editor without a reveal action", async () => {
    render(
      <FastQuestionComposer
        value={plainContentFromText("Question prompt")}
        onChange={vi.fn()}
        label="Question prompt"
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Question prompt" })).toBeInTheDocument()
    );
    expect(screen.getByRole("toolbar", { name: "Formatting tools" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Insert equation" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /show rich formatting/i })).not.toBeInTheDocument();
  });
});
