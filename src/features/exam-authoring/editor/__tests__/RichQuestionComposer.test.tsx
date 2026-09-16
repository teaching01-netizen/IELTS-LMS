import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Extensions } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { plainContentFromText } from "../richContent";
import { FastQuestionComposer } from "../FastQuestionComposer";

const uploadAssessmentAsset = vi.hoisted(() => vi.fn());
const importAssessmentImageUrl = vi.hoisted(() => vi.fn());
const getAssessmentMediaAsset = vi.hoisted(() => vi.fn());

vi.mock("../../api/assessmentMediaApi", () => ({
  uploadAssessmentAsset,
  importAssessmentImageUrl,
  getAssessmentMediaAsset,
}));

import {
  composerBaseExtensions,
  RichQuestionComposer,
  SAT_CHOICE_COMPOSER_CAPABILITIES,
} from "../RichQuestionComposer";
import type { RichComposerCollaboration } from "../RichQuestionComposer";

/** Extension names registered by an extension list, in order. */
function registeredExtensionNames(extensions: Extensions): string[] {
  const editor = new Editor({ extensions, element: document.createElement("div") });
  const names = editor.extensionManager.extensions.map((extension) => extension.name);
  editor.destroy();
  return names;
}

describe("collaborative composer history", () => {
  it("registers no independent undo/redo history in collaborative mode", () => {
    // Yjs owns history once Collaboration is bound: a second history stack
    // corrupts undo, so StarterKit's must not be registered at all.
    expect(registeredExtensionNames(composerBaseExtensions(true))).not.toContain("undoRedo");
  });

  it("keeps the legacy undo/redo history when collaboration is absent", () => {
    expect(registeredExtensionNames(composerBaseExtensions(false))).toContain("undoRedo");
  });
});

describe("SAT rich question composer capabilities", () => {
  it("shows the standard control set with visible undo and redo", async () => {
    render(<RichQuestionComposer value={plainContentFromText("Hello")} onChange={vi.fn()} label="Question" />);
    const toolbar=await screen.findByRole("toolbar", {name:"Formatting tools"});
    expect(within(toolbar).getAllByRole("button")).toHaveLength(7);
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

  it("rejects unsupported dialog files before calling the upload API", async () => {
    uploadAssessmentAsset.mockReset();
    const createObjectURL = vi.fn(() => "blob:dialog-preview");
    const revokeObjectURL = vi.fn();
    const previousCreateObjectURL = (URL as typeof URL & {
      createObjectURL?: typeof createObjectURL;
    }).createObjectURL;
    const previousRevokeObjectURL = (URL as typeof URL & {
      revokeObjectURL?: typeof revokeObjectURL;
    }).revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    try {
      render(
        <RichQuestionComposer
          value={plainContentFromText("Question prompt")}
          onChange={vi.fn()}
          label="Question prompt"
          assetOwnerId="question-1"
        />
      );

      await screen.findByRole("button", { name: "Insert content" });
      fireEvent.click(screen.getByRole("button", { name: "Insert content" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Insert image or graph" }));

      const file = new File(["not an image"], "diagram.avif", { type: "image/avif" });
      fireEvent.change(await screen.findByLabelText("Upload image or graph"), {
        target: { files: [file] },
      });

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("That file is not a supported image");
      expect(alert.querySelector("[data-image-error-code='type']")).not.toBeNull();
      expect(uploadAssessmentAsset).not.toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:dialog-preview");
    } finally {
      if (previousCreateObjectURL) {
        Object.defineProperty(URL, "createObjectURL", {
          configurable: true,
          value: previousCreateObjectURL,
        });
      } else {
        delete (URL as typeof URL & { createObjectURL?: typeof createObjectURL }).createObjectURL;
      }
      if (previousRevokeObjectURL) {
        Object.defineProperty(URL, "revokeObjectURL", {
          configurable: true,
          value: previousRevokeObjectURL,
        });
      } else {
        delete (URL as typeof URL & { revokeObjectURL?: typeof revokeObjectURL }).revokeObjectURL;
      }
    }
  });

  it("uploads a valid dialog file and never persists its preview URL", async () => {
    const asset = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      contentType: "image/png",
      fileName: "diagram.png",
      uploadStatus: "finalized",
      downloadUrl: "/api/v1/media/550e8400-e29b-41d4-a716-446655440001/content",
    };
    uploadAssessmentAsset.mockReset().mockResolvedValue(asset);
    getAssessmentMediaAsset.mockReset().mockResolvedValue(asset);
    const createObjectURL = vi.fn(() => "blob:dialog-preview");
    const revokeObjectURL = vi.fn();
    const previousCreateObjectURL = (URL as typeof URL & {
      createObjectURL?: typeof createObjectURL;
    }).createObjectURL;
    const previousRevokeObjectURL = (URL as typeof URL & {
      revokeObjectURL?: typeof revokeObjectURL;
    }).revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 120, height: 80, close: vi.fn() }))
    );

    try {
      const onChange = vi.fn();
      render(
        <RichQuestionComposer
          value={plainContentFromText("Question prompt")}
          onChange={onChange}
          label="Question prompt"
          assetOwnerId="question-1"
        />
      );

      await screen.findByRole("button", { name: "Insert content" });
      fireEvent.click(screen.getByRole("button", { name: "Insert content" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Insert image or graph" }));

      const file = new File(
        [
          Uint8Array.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          ]),
        ],
        "diagram.png",
        { type: "image/png" }
      );
      fireEvent.change(await screen.findByLabelText("Upload image or graph"), {
        target: { files: [file] },
      });

      await waitFor(() => expect(uploadAssessmentAsset).toHaveBeenCalledWith(file, "question-1"));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:dialog-preview");
      fireEvent.change(screen.getByRole("textbox", { name: /Alternative text/ }), {
        target: { value: "A coordinate graph" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Insert visual" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(JSON.stringify(onChange.mock.calls)).toContain(asset.id);
      expect(JSON.stringify(onChange.mock.calls)).not.toContain("blob:dialog-preview");
    } finally {
      if (previousCreateObjectURL) {
        Object.defineProperty(URL, "createObjectURL", {
          configurable: true,
          value: previousCreateObjectURL,
        });
      } else {
        delete (URL as typeof URL & { createObjectURL?: typeof createObjectURL }).createObjectURL;
      }
      if (previousRevokeObjectURL) {
        Object.defineProperty(URL, "revokeObjectURL", {
          configurable: true,
          value: previousRevokeObjectURL,
        });
      } else {
        delete (URL as typeof URL & { revokeObjectURL?: typeof revokeObjectURL }).revokeObjectURL;
      }
      vi.unstubAllGlobals();
    }
  });

  it("imports an HTTPS dialog source before inserting a managed asset", async () => {
    importAssessmentImageUrl.mockReset().mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      contentType: "image/png",
      fileName: "diagram.png",
      uploadStatus: "finalized",
      downloadUrl: "/api/v1/media/550e8400-e29b-41d4-a716-446655440000/content",
    });
    getAssessmentMediaAsset.mockReset().mockResolvedValue({
      downloadUrl: "/api/v1/media/550e8400-e29b-41d4-a716-446655440000/content",
    });
    const onChange = vi.fn();
    render(
      <RichQuestionComposer
        value={plainContentFromText("Question prompt")}
        onChange={onChange}
        label="Question prompt"
        assetOwnerId="question-1"
      />
    );

    await screen.findByRole("button", { name: "Insert content" });
    fireEvent.click(screen.getByRole("button", { name: "Insert content" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Insert image or graph" }));
    fireEvent.click(screen.getByText("Use existing asset…"));
    fireEvent.change(await screen.findByLabelText("Asset ID or image URL"), {
      target: { value: "https://cdn.example.test/diagram.png" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Alternative text/ }), {
      target: { value: "A coordinate graph" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert visual" }));

    await waitFor(() => expect(importAssessmentImageUrl).toHaveBeenCalledWith(
      "https://cdn.example.test/diagram.png",
      "question-1"
    ));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).toContain(
      "550e8400-e29b-41d4-a716-446655440000"
    );
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

  it("waits for initial collaboration sync before mounting an editable prompt", async () => {
    const collaboration: RichComposerCollaboration = { extensions: [], ready: false };
    const { container } = render(
      <RichQuestionComposer
        value={plainContentFromText("Question prompt")}
        onChange={vi.fn()}
        label="Question prompt"
        collaboration={collaboration}
      />
    );

    // An empty Yjs document must never be rendered as an editable prompt while
    // seed status is unresolved.
    expect(container.querySelector('[data-coedit-pending="true"]')).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Question prompt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Formatting tools" })).not.toBeInTheDocument();
  });

  it("never seeds collaborative content from props, even after a value change", async () => {
    const collaboration: RichComposerCollaboration = { extensions: [], ready: true };
    const { rerender } = render(
      <RichQuestionComposer
        value={plainContentFromText("Alpha")}
        onChange={vi.fn()}
        label="Question prompt"
        collaboration={collaboration}
      />
    );
    const editor = await screen.findByRole("textbox", { name: "Question prompt" });

    // The Y.Doc (already seeded by the service) is the source of truth: the
    // HTTP projection is not written back into the editor.
    expect(editor.textContent).not.toContain("Alpha");

    rerender(
      <RichQuestionComposer
        value={plainContentFromText("Beta")}
        onChange={vi.fn()}
        label="Question prompt"
        collaboration={collaboration}
      />
    );
    await waitFor(() => expect(editor.textContent).not.toContain("Beta"));
  });

  it("makes a collaborative editor read-only for observers and frozen rooms", async () => {
    render(
      <RichQuestionComposer
        value={plainContentFromText("Question prompt")}
        onChange={vi.fn()}
        label="Question prompt"
        collaboration={{ extensions: [], ready: true, readOnly: true }}
      />
    );

    const editor = await screen.findByRole("textbox", { name: "Question prompt" });
    expect(editor).toHaveAttribute("contenteditable", "false");
  });

  it("does not emit a change when the live binding object is refreshed", async () => {
    const extensions: Extensions = [];
    const onChange = vi.fn();
    const { rerender } = render(
      <RichQuestionComposer
        value={plainContentFromText("Question prompt")}
        onChange={onChange}
        label="Question prompt"
        collaboration={{ extensions, ready: true }}
      />
    );
    await screen.findByRole("textbox", { name: "Question prompt" });
    onChange.mockClear();

    // Presence and save snapshots recreate the binding wrapper, but they must
    // not look like an editor edit or feed a state update back into the
    // authoring workspace.
    rerender(
      <RichQuestionComposer
        value={plainContentFromText("Question prompt")}
        onChange={onChange}
        label="Question prompt"
        collaboration={{ extensions, ready: true }}
      />
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the legacy prop-driven content sync when collaboration is absent", async () => {
    const { rerender } = render(
      <RichQuestionComposer value={plainContentFromText("Alpha")} onChange={vi.fn()} label="Question" />
    );
    const editor = await screen.findByRole("textbox", { name: "Question" });
    await waitFor(() => expect(editor.textContent).toContain("Alpha"));

    rerender(
      <RichQuestionComposer value={plainContentFromText("Beta")} onChange={vi.fn()} label="Question" />
    );
    await waitFor(() => expect(editor.textContent).toContain("Beta"));
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
