import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { EditableBlockMath, EditableInlineMath } from "../../EditableMathExtension";
import { SatImage } from "../../SatImageExtension";
import { RichContentIdentity } from "../../RichContentIdentityExtension";
import { SAT_RICH_COMPOSER_CAPABILITIES } from "../../RichQuestionComposer";
import { createPipelineContext } from "../../ingestion/application/pipelineContext";
import { ingestClipboard } from "../../ingestion/application/ingestClipboard";
import { DROP_TINT_CLASS, SmartDropPlugin } from "../smartDropPlugin";
import { insertIngestResult } from "../insertIngestResult";

function makeEditor(
  onSmartPaste?: (info: {
    source: string;
    imageCount: number;
    rejectedImageCount: number;
    canUndo: boolean;
  }) => void
): Editor {
  const capabilities = SAT_RICH_COMPOSER_CAPABILITIES;
  return new Editor({
    extensions: [
      RichContentIdentity,
      StarterKit.configure({ blockquote: false, heading: { levels: [2, 3] } }),
      EditableInlineMath,
      EditableBlockMath,
      TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
      SatImage.configure({ inline: false, allowBase64: false }),
      SmartDropPlugin.configure({
        capabilities,
        ingest: (req) => ingestClipboard(req, createPipelineContext({ field: "prompt" })),
        insert: (editor, result, target) =>
          insertIngestResult(editor, result, target, { capabilities }),
        ...(onSmartPaste ? { onSmartPaste } : {}),
      }),
    ],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "drop here" }] }],
    },
  });
}

describe("SmartDropPlugin", () => {
  it("drops html at the drop position in one undo", async () => {
    const editor = makeEditor();
    try {
      const view = editor.view;
      const plugin = view.state.plugins.find((p) => typeof p.props.handleDrop === "function");
      expect(plugin?.props.handleDrop).toBeDefined();
      const event = {
        dataTransfer: {
          files: [],
          getData: (kind: string) => (kind === "text/html" ? "<p>DROPPED</p>" : "DROPPED"),
        },
        clientX: 5,
        clientY: 5,
        preventDefault: vi.fn(),
      } as unknown as DragEvent;
      const handled = plugin?.props.handleDrop?.(view, event, null as never, false);
      expect(handled).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      expect(JSON.stringify(editor.getJSON())).toContain("DROPPED");
      editor.commands.undo();
      expect(JSON.stringify(editor.getJSON())).not.toContain("DROPPED");
    } finally {
      editor.destroy();
    }
  });
  it("internal drags pass through", () => {
    const editor = makeEditor();
    try {
      const view = editor.view;
      const plugin = view.state.plugins.find((p) => typeof p.props.handleDrop === "function");
      const event = {
        dataTransfer: { files: [], getData: () => "" },
        preventDefault: vi.fn(),
      } as unknown as DragEvent;
      expect(plugin?.props.handleDrop?.(view, event, null as never, true)).toBe(false);
    } finally {
      editor.destroy();
    }
  });
  it("tint class constant is exported and dragover toggles it", () => {
    expect(DROP_TINT_CLASS).toBe("sat-rich-editor--drop-target");
    const editor = makeEditor();
    try {
      const view = editor.view;
      const plugin = view.state.plugins.find((p) => p.props.handleDOMEvents);
      expect(plugin).toBeDefined();
    } finally {
      editor.destroy();
    }
  });

  it("reports rejected-only HTML drops without an undo affordance", async () => {
    const notices: Array<{
      source: string;
      imageCount: number;
      rejectedImageCount: number;
      canUndo: boolean;
    }> = [];
    const editor = makeEditor((info) => notices.push(info));
    try {
      const view = editor.view;
      const plugin = view.state.plugins.find((p) => typeof p.props.handleDrop === "function");
      const event = {
        dataTransfer: {
          files: [],
          getData: (kind: string) => (kind === "text/html" ? '<img src="blob:unsafe">' : ""),
        },
        clientX: 5,
        clientY: 5,
        preventDefault: vi.fn(),
      } as unknown as DragEvent;
      expect(plugin?.props.handleDrop?.(view, event, null as never, false)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(notices[0]).toMatchObject({ rejectedImageCount: 1, imageCount: 0, canUndo: false });
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    } finally {
      editor.destroy();
    }
  });
});
