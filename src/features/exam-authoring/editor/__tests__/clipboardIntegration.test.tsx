import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import type { StructuredContent } from "../../contracts/assessment";
import {
  uploadAssessmentAsset,
  getAssessmentMediaAsset,
  type AssessmentMediaAsset,
} from "../../api/assessmentMediaApi";
import { FastQuestionComposer } from "../FastQuestionComposer";
import {
  SAT_CHOICE_COMPOSER_CAPABILITIES,
  SAT_RICH_COMPOSER_CAPABILITIES,
  type RichComposerCapabilities,
} from "../RichQuestionComposer";
import { plainContentFromText } from "../richContent";
import { __resetImagePipeForTests, destroyTransientUploads } from "../ingestionImagePipe";

// Only browser decoding and the network boundary are substituted. The actual
// composer, DOM paste/drop handlers, ingestion, staging and upload swaps run.
vi.mock("../../api/assessmentMediaApi", () => ({
  uploadAssessmentAsset: vi.fn(),
  getAssessmentMediaAsset: vi.fn(),
}));

const asset: AssessmentMediaAsset = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  fileName: "clipboard.png",
  contentType: "image/png",
  uploadStatus: "ready",
  downloadUrl: "https://cdn.test/clipboard.png",
};
const createUrl = vi.fn(() => "blob:clipboard-test");
const revokeUrl = vi.fn();
const editors: Editor[] = [];

function imageFile(): File {
  return new File(
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    "clipboard.png",
    { type: "image/png" }
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mountComposer(
  capabilities: Readonly<RichComposerCapabilities> = SAT_RICH_COMPOSER_CAPABILITIES
) {
  const changed = vi.fn<(value: StructuredContent) => void>();
  const notice = vi.fn();
  function ControlledComposer() {
    const [value, setValue] = useState(() => plainContentFromText(""));
    return (
      <FastQuestionComposer
        label="SAT paste regression"
        value={value}
        capabilities={capabilities}
        assetOwnerId="question-17"
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
        onSmartPaste={notice}
      />
    );
  }
  const rendered = render(<ControlledComposer />);
  const textbox = await screen.findByRole("textbox", { name: "SAT paste regression" });
  const editor = (textbox as HTMLElement & { editor: Editor }).editor;
  editors.push(editor);
  act(() => {
    editor.view.focus();
  });
  return { ...rendered, textbox, editor, changed, notice };
}
function paste(
  textbox: HTMLElement,
  { files = [], html = "", text = "" }: { files?: File[]; html?: string; text?: string }
) {
  const getData = vi.fn((format: string) =>
    format === "text/html" ? html : format === "text/plain" ? text : ""
  );
  fireEvent.paste(textbox, { clipboardData: { files, getData } });
  return getData;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4, height: 4, close: vi.fn() }))
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    }
  );
  vi.mocked(uploadAssessmentAsset).mockResolvedValue(asset);
  vi.mocked(getAssessmentMediaAsset).mockResolvedValue(asset);
});
afterEach(() => {
  for (const editor of editors.splice(0)) {
    destroyTransientUploads(editor);
    if (!editor.isDestroyed) act(() => editor.destroy());
  }
  __resetImagePipeForTests();
  vi.unstubAllGlobals();
});

describe("SAT production composer clipboard integration", () => {
  it.each([SAT_RICH_COMPOSER_CAPABILITIES, SAT_CHOICE_COMPOSER_CAPABILITIES])(
    "formats HTML-wrapped Markdown and emits bold marks",
    async (capabilities) => {
      const { textbox, changed } = await mountComposer(capabilities);
      const getData = paste(textbox, {
        html: "<p>**Advanced Real Analysis Problem**</p>",
        text: "**Advanced Real Analysis Problem**",
      });
      await waitFor(() =>
        expect(textbox.querySelector("strong")).toHaveTextContent("Advanced Real Analysis Problem")
      );
      expect(textbox.textContent).not.toContain("**");
      expect(JSON.stringify(changed.mock.lastCall?.[0])).toContain('"type":"bold"');
      // TipTap/ProseMirror also inspect flavors before our handlePaste hook.
      expect(getData).toHaveBeenCalledWith("text/html");
      expect(getData).toHaveBeenCalledWith("text/plain");
    }
  );

  it.each(["paste", "drop"] as const)(
    "stages an image through the real %s path, resolves it, and supports one undo",
    async (kind) => {
      const { textbox, editor, changed, notice } = await mountComposer();
      const file = imageFile();
      const pending = deferred<AssessmentMediaAsset>();
      vi.mocked(uploadAssessmentAsset).mockReturnValueOnce(pending.promise);
      await act(async () => {
        if (kind === "paste") paste(textbox, { files: [file] });
        else {
          // jsdom has no layout hit-testing; the drop handler itself remains real.
          vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 1, inside: -1 });
          fireEvent.drop(textbox, {
            dataTransfer: { files: [file], getData: () => "" },
            clientX: 0,
            clientY: 0,
          });
        }
        await waitFor(() =>
          expect(uploadAssessmentAsset).toHaveBeenCalledWith(file, "question-17")
        );
      });
      expect(editor.getJSON().content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "image",
            attrs: expect.objectContaining({ uploading: true }),
          }),
        ])
      );
      expect(notice).toHaveBeenCalledWith(
        expect.objectContaining({ imageCount: 1, canUndo: true })
      );
      expect(notice.mock.lastCall?.[0].rejectedImageCount ?? 0).toBe(0);
      // Live placeholders must never leak object URLs to the autosave callback.
      expect(JSON.stringify(changed.mock.calls)).not.toContain("blob:");
      act(() => {
        textbox.blur();
      });
      await act(async () => {
        pending.resolve(asset);
        await pending.promise;
      });
      await waitFor(() =>
        expect(textbox.querySelector("img")).toHaveAttribute("src", asset.downloadUrl)
      );
      expect(JSON.stringify(changed.mock.lastCall?.[0])).toContain(`"assetId":"${asset.id}"`);
      expect(JSON.stringify(changed.mock.calls)).not.toMatch(/blob:|data:image/);
      expect(revokeUrl).toHaveBeenCalledTimes(1);
      act(() => {
        editor.commands.undo();
      });
      expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false);
    }
  );

  it("renders retry and remove actions for a failed staged image", async () => {
    const { textbox, editor } = await mountComposer();
    vi.mocked(uploadAssessmentAsset).mockRejectedValueOnce(new Error("network down"));

    paste(textbox, { files: [imageFile()] });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry image upload" })).toBeVisible()
    );
    expect(screen.getByRole("status", { name: "Upload failed", exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove image" })).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    });
    await waitFor(() =>
      expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false)
    );
    expect(revokeUrl).toHaveBeenCalledWith("blob:clipboard-test");
  });

  it("keeps text and images from the same paste and undoes them together", async () => {
    const { textbox, editor } = await mountComposer();
    await act(async () => {
      paste(textbox, {
        files: [imageFile()],
        html: "<p>**Diagram caption**</p>",
        text: "**Diagram caption**",
      });
      await waitFor(() => expect(uploadAssessmentAsset).toHaveBeenCalledTimes(1));
    });
    await waitFor(() =>
      expect(textbox.querySelector("strong")).toHaveTextContent("Diagram caption")
    );
    await waitFor(() =>
      expect(textbox.querySelector("img")).toHaveAttribute("src", asset.downloadUrl)
    );
    act(() => {
      editor.commands.undo();
    });
    expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false);
    expect(editor.getText()).toBe("");
  });

  it("does not upload images when the field disables images", async () => {
    const { textbox, editor, notice } = await mountComposer({
      ...SAT_RICH_COMPOSER_CAPABILITIES,
      image: false,
    });
    paste(textbox, { files: [imageFile()] });
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        expect.objectContaining({ rejectedImageCount: 1, canUndo: false })
      )
    );
    expect(uploadAssessmentAsset).not.toHaveBeenCalled();
    expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false);
  });
});
