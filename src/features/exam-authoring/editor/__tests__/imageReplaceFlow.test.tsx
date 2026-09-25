/**
 * Regressions for repairing an image that a publish check rejected.
 *
 * The exam this came from held two questions whose images pointed at asset IDs
 * that no longer had objects behind them, and one of them stored `alt: ""`.
 * Replacement has to work for exactly that content: a finalized asset is the
 * only requirement, the old image is untouched until the new one is ready, and
 * a failure is never reported as a success.
 */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import type { StructuredContent } from "../../contracts/assessment";
import type { AssessmentMediaAsset } from "../../api/assessmentMediaApi";
import { RichQuestionComposer } from "../RichQuestionComposer";
import { plainContentFromText } from "../richContent";

const uploadAssessmentAsset = vi.hoisted(() => vi.fn());
const importAssessmentImageUrl = vi.hoisted(() => vi.fn());
const getAssessmentMediaAsset = vi.hoisted(() => vi.fn());

vi.mock("../../api/assessmentMediaApi", () => ({
  uploadAssessmentAsset,
  importAssessmentImageUrl,
  getAssessmentMediaAsset,
}));

const NativeURL = globalThis.URL;
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

// The two IDs from the failing exam are shaped like these; the point is that a
// replacement stops referencing the old one entirely.
const MISSING_ASSET_ID = "63a5b1e2-0000-4000-8000-000000000001";
const REPLACEMENT_ASSET_ID = "a7a55800-1111-4111-9111-111111111111";

function finalizedAsset(id: string): AssessmentMediaAsset {
  return {
    id,
    fileName: `${id}.png`,
    contentType: "image/png",
    uploadStatus: "finalized",
    downloadUrl: `/api/v1/media/${id}/content`,
  };
}

const editors: Editor[] = [];

function legacyQuestion(): StructuredContent {
  return {
    version: 2,
    nodes: [],
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Use the chart." }] },
        {
          type: "image",
          attrs: {
            src: `/api/v1/media/${MISSING_ASSET_ID}`,
            assetId: MISSING_ASSET_ID,
            // Legacy content: the stored description is empty.
            alt: "",
            caption: "Chart 1",
          },
        },
      ],
    },
  };
}

function imagePosition(editor: Editor): number {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") {
      position = pos;
      return false;
    }
    return true;
  });
  return position;
}

function imageFile(): File {
  return new File([PNG_BYTES as unknown as BlobPart], "replacement.png", {
    type: "image/png",
  });
}

async function mountComposer(initial: StructuredContent) {
  const changed = vi.fn<(value: StructuredContent) => void>();

  function ControlledComposer() {
    const [value, setValue] = useState(() => initial);
    return (
      <RichQuestionComposer
        label="Replace flow"
        value={value}
        assetOwnerId="question-legacy"
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }

  render(<ControlledComposer />);
  const textbox = await screen.findByRole("textbox", { name: "Replace flow" });
  const editor = (textbox as HTMLElement & { editor: Editor }).editor;
  editors.push(editor);
  return { editor, changed };
}

/** Lets async state updates (upload settle, dialog exit portal) land inside act. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Selects the image the way the author does, then opens the replace dialog. */
async function openReplaceDialog(editor: Editor) {
  act(() => {
    editor.commands.setNodeSelection(imagePosition(editor));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Replace image" }));
  });
  await screen.findByRole("dialog");
}

/** Opens the insert dialog from the toolbar, the way an author reaches it. */
async function openInsertDialog() {
  await screen.findByRole("button", { name: "Insert content" });
  fireEvent.click(screen.getByRole("button", { name: "Insert content" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Insert image or graph" }));
  await screen.findByRole("dialog");
}

/** Chooses a file and waits for its upload to land. */
async function chooseUpload(file: File) {
  await act(async () => {
    fireEvent.change(await screen.findByLabelText("Upload image or graph"), {
      target: { files: [file] },
    });
  });
  await waitFor(() =>
    expect(uploadAssessmentAsset).toHaveBeenCalledWith(file, "question-legacy")
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadAssessmentAsset.mockResolvedValue(finalizedAsset(REPLACEMENT_ASSET_ID));
  getAssessmentMediaAsset.mockResolvedValue(finalizedAsset(REPLACEMENT_ASSET_ID));
  importAssessmentImageUrl.mockResolvedValue(finalizedAsset(REPLACEMENT_ASSET_ID));
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4, height: 4, close: vi.fn() }))
  );
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:replace-preview");
      static revokeObjectURL = vi.fn();
    }
  );
});

afterEach(() => {
  // Unmount before tearing the editors down: an editor destroyed while its
  // React tree is still mounted updates portals outside act.
  cleanup();
  for (const editor of editors.splice(0)) {
    if (!editor.isDestroyed) editor.destroy();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("replacing an image that publish rejected", () => {
  it("repairs a missing asset behind empty alt text and commits the new finalized asset", async () => {
    const { editor, changed } = await mountComposer(legacyQuestion());

    await openReplaceDialog(editor);

    const file = imageFile();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Upload image or graph"), {
        target: { files: [file] },
      });
    });
    await waitFor(() =>
      expect(uploadAssessmentAsset).toHaveBeenCalledWith(file, "question-legacy")
    );

    // Empty alt text is not a reason to block the repair: the action becomes
    // available as soon as the replacement asset is finalized.
    const replaceAction = screen.getByRole("button", { name: "Replace visual" });
    await waitFor(() => expect(replaceAction).toBeEnabled());
    fireEvent.click(replaceAction);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const committed = changed.mock.calls.at(-1)?.[0] as StructuredContent;
    const image = committed.document?.content?.find((node) => node.type === "image");
    expect(image?.attrs).toMatchObject({
      assetId: REPLACEMENT_ASSET_ID,
      // The replacement also repairs the missing description: an empty alt is
      // its own blocking publish issue (sat.accessibility.alt.required), so the
      // uploaded file names it. "replacement.png" -> "Replacement".
      alt: "Replacement",
      caption: "Chart 1",
    });
    // The old ID is gone from what gets saved: publish collects asset
    // references from exactly this document.
    expect(JSON.stringify(committed)).not.toContain(MISSING_ASSET_ID);
    expect(await screen.findByText("Image replaced")).toBeInTheDocument();
    await settle();
  });

  it("leaves the original image and its asset ID untouched when the upload fails", async () => {
    const { editor, changed } = await mountComposer(legacyQuestion());
    uploadAssessmentAsset.mockRejectedValueOnce(new Error("storage down"));

    await openReplaceDialog(editor);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Upload image or graph"), {
        target: { files: [imageFile()] },
      });
    });

    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-image-error-code='upload']")).not.toBeNull();

    // Nothing was written: the node still points at the original asset, and
    // the only source the action could submit is that same original asset, so
    // it stays disabled rather than reporting a replacement that never
    // happened.
    const node = editor.state.doc.nodeAt(imagePosition(editor));
    expect(node?.attrs["assetId"]).toBe(MISSING_ASSET_ID);
    expect(JSON.stringify(changed.mock.calls)).not.toContain(REPLACEMENT_ASSET_ID);
    expect(screen.getByRole("button", { name: "Replace visual" })).toBeDisabled();
    expect(screen.queryByText("Image replaced")).toBeNull();
    await settle();
  });

  it("never overwrites a stored description or caption when replacing the visual", async () => {
    const stored = legacyQuestion();
    const storedImage = stored.document?.content?.find((node) => node.type === "image");
    // A description the author already wrote, on an image whose asset is lost:
    // the replacement must not push the new file's words over it.
    if (storedImage?.attrs) storedImage.attrs["alt"] = "Bar chart of quarterly exports";
    const { editor, changed } = await mountComposer(stored);

    await openReplaceDialog(editor);
    // "replacement.png" suggests "Replacement"; the stored text must win.
    await chooseUpload(imageFile());

    const altField = screen.getByRole("textbox", { name: /Alternative text/ });
    await waitFor(() => expect(altField).toHaveValue("Bar chart of quarterly exports"));

    const replaceAction = screen.getByRole("button", { name: "Replace visual" });
    await waitFor(() => expect(replaceAction).toBeEnabled());
    fireEvent.click(replaceAction);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const committed = changed.mock.calls.at(-1)?.[0] as StructuredContent;
    const committedImage = committed.document?.content?.find((node) => node.type === "image");
    expect(committedImage?.attrs).toMatchObject({
      assetId: REPLACEMENT_ASSET_ID,
      alt: "Bar chart of quarterly exports",
      caption: "Chart 1",
    });
    await settle();
  });

  it("refuses an image that left the question instead of reporting a replacement", async () => {
    const { editor, changed } = await mountComposer(legacyQuestion());
    await openReplaceDialog(editor);

    // The dialog holds a position, not a node: the author can delete the image
    // (or undo the insert) while it is open. Applying then must not close on a
    // silent no-op that reads as success.
    await act(async () => {
      const position = imagePosition(editor);
      const node = editor.state.doc.nodeAt(position);
      editor.view.dispatch(
        editor.state.tr.delete(position, position + (node?.nodeSize ?? 0))
      );
    });
    expect(imagePosition(editor)).toBe(-1);

    await chooseUpload(imageFile());
    const replaceAction = screen.getByRole("button", { name: "Replace visual" });
    await waitFor(() => expect(replaceAction).toBeEnabled());
    fireEvent.click(replaceAction);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("no longer part of the question");
    expect(screen.queryByText("Image replaced")).toBeNull();
    expect(JSON.stringify(changed.mock.calls)).not.toContain(REPLACEMENT_ASSET_ID);
    await settle();
  });

  it("keeps replace unavailable, and says why, when no new asset is chosen", async () => {
    const { editor } = await mountComposer(legacyQuestion());
    await openReplaceDialog(editor);

    const altField = screen.getByRole("textbox", { name: /Alternative text/ });
    fireEvent.change(altField, { target: { value: "Exports rising since 2019" } });

    // A description edit is not a replacement: the asset the node already
    // points at is the broken one, so committing it would report a swap that
    // never happened and leave publish blocked. The dialog names the way out.
    await screen.findByText(/use “Alt text” on the image/);
    expect(screen.getByRole("button", { name: "Replace visual" })).toBeDisabled();
    await settle();
  });

  it("describes an inserted image from the file that was uploaded", async () => {
    const { changed } = await mountComposer(plainContentFromText(""));
    await openInsertDialog();

    const file = new File(
      [PNG_BYTES as unknown as BlobPart],
      "supply-demand-curve.png",
      { type: "image/png" }
    );
    await chooseUpload(file);

    // Choosing the file IS the description step: an empty alt text is its own
    // blocking publish issue, so the author is never asked for one.
    const altField = screen.getByRole("textbox", { name: /Alternative text/ });
    await waitFor(() => expect(altField).toHaveValue("Supply demand curve"));

    fireEvent.click(screen.getByRole("button", { name: "Insert visual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const committed = changed.mock.calls.at(-1)?.[0] as StructuredContent;
    const image = committed.document?.content?.find((node) => node.type === "image");
    expect(image?.attrs).toMatchObject({
      assetId: REPLACEMENT_ASSET_ID,
      alt: "Supply demand curve",
    });
    await settle();
  });

  it("never overwrites a description the author wrote", async () => {
    const { changed } = await mountComposer(plainContentFromText(""));
    await openInsertDialog();

    const altField = screen.getByRole("textbox", { name: /Alternative text/ });
    fireEvent.change(altField, { target: { value: "A demand curve shifting right" } });

    await chooseUpload(
      new File([PNG_BYTES as unknown as BlobPart], "supply-demand-curve.png", {
        type: "image/png",
      })
    );

    expect(altField).toHaveValue("A demand curve shifting right");

    fireEvent.click(screen.getByRole("button", { name: "Insert visual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const committed = changed.mock.calls.at(-1)?.[0] as StructuredContent;
    const image = committed.document?.content?.find((node) => node.type === "image");
    expect(image?.attrs).toMatchObject({ alt: "A demand curve shifting right" });
    await settle();
  });
});
