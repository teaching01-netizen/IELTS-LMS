import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfLayout, PdfLayoutEditorData, PdfTargetOption } from "@shared/sat/pdfLayout";
import type { SatPdfLayoutApi } from "../../../../api/satPdfLayoutApi";
import { ExamPdfLayoutEditor } from "../ExamPdfLayoutEditor";

/**
 * The staff member's real path through the layout editor: open it, add a
 * slide, save, take a slide back. The sample renderer is mocked because it
 * needs a real PDF pipeline; everything else is the shipped component.
 */

vi.mock("../pdfSampleRaster", () => ({
  rasterizeSampleBook: vi.fn(async () => ({ url: "blob:sample-book", pages: {} })),
  rasterizeFirstPage: vi.fn(async () => ({ src: "data:image/png;base64," })),
}));

const targets: PdfTargetOption[] = [
  { target: { kind: "cover" }, label: "Cover" },
  { target: { kind: "scoreReport" }, label: "Score report" },
  { target: { kind: "answerSummary" }, label: "Answer summary" },
];

function emptyLayout(): PdfLayout {
  return { slides: [], logos: { cover: null, leftWatermark: null, rightWatermark: null } };
}

function makeApi(layout: PdfLayout = emptyLayout(), revision = 0) {
  let saved: PdfLayoutEditorData = {
    revision,
    updatedAt: null,
    updatedBy: null,
    targets,
    assets: layout.slides.map((slide) => ({
      id: slide.assetId,
      purpose: "slide" as const,
      filename: "Orientation slide.png",
      contentType: "image/png",
      bytes: 1200,
      width: 640,
      height: 360,
    })),
    layout: structuredClone(layout),
  };
  const save = vi.fn(async (_examId: string, _expected: number, next: PdfLayout) => {
    saved = {
      ...saved,
      revision: saved.revision + 1,
      layout: structuredClone(next),
      updatedAt: new Date().toISOString(),
    };
    return structuredClone(saved);
  });
  const api: SatPdfLayoutApi = {
    load: vi.fn(async () => structuredClone(saved)),
    save: save as unknown as SatPdfLayoutApi["save"],
    imageUrl: (_examId, assetId) => "/assets/" + assetId,
    upload: vi.fn(async (_examId, purpose, file) => ({
      id: "asset-" + purpose + "-" + file.size,
      purpose,
      filename: file.name,
      contentType: file.type,
      bytes: file.size,
      width: 640,
      height: 360,
    })),
    preview: vi.fn(async () => new Blob(["sample"], { type: "application/pdf" })),
  };
  return { api, save };
}

function renderEditor(api: SatPdfLayoutApi) {
  return render(
    <ExamPdfLayoutEditor
      examId="exam-1"
      examTitle="SAT Practice 04"
      canEdit
      onDirtyChange={() => undefined}
      onBack={() => undefined}
      api={api}
    />,
  );
}

function selectFile(name: string) {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The upload form has no file input.");
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 640, height: 360, close: () => undefined }));
  // jsdom ships a crypto without randomUUID; the editor uses it for slide ids.
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "slide-uuid-" + uuidCounter++ });
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

let uuidCounter = 0;

describe("exam PDF layout editor", () => {
  it("opens on the default layout and keeps Save disabled until the draft changes", async () => {
    const { api } = makeApi();
    renderEditor(api);

    expect(await screen.findByText("Default layout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save layout" })).toBeDisabled();
    expect(screen.getByText("0 of 8 slides placed")).toBeInTheDocument();
  });

  it("adds a slide at a chosen position and saves it", async () => {
    const { api, save } = makeApi();
    renderEditor(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add slide after Cover" }));
    const dialog = within(await screen.findByRole("dialog"));
    selectFile("Orientation.png");
    fireEvent.change(dialog.getByLabelText("Describe this slide"), {
      target: { value: "How to use this SAT review." },
    });
    // The form reads the image dimensions before it accepts the file.
    await waitFor(() => expect(dialog.getByRole("button", { name: "Use image" })).toBeEnabled());
    fireEvent.click(dialog.getByRole("button", { name: "Use image" }));

    await waitFor(() => expect(screen.getByText("1 of 8 slides placed")).toBeInTheDocument());
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const submitted = save.mock.calls[0]?.[2] as PdfLayout;
    expect(submitted.slides).toHaveLength(1);
    expect(submitted.slides[0]?.side).toBe("after");
    expect(submitted.slides[0]?.target).toEqual({ kind: "cover" });
    expect(submitted.slides[0]?.description).toBe("How to use this SAT review.");
  });

  it("takes a slide back with Undo", async () => {
    const layout = emptyLayout();
    layout.slides = [
      {
        id: "slide-1",
        assetId: "asset-1",
        target: { kind: "cover" },
        side: "after",
        description: "Orientation slide.",
      },
    ];
    const { api } = makeApi(layout, 3);
    renderEditor(api);

    fireEvent.click(await screen.findByRole("button", { name: "Orientation slide.png, After Cover" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.getByText("Removed Orientation slide.png")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.getByText("1 of 8 slides placed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Orientation slide.png, After Cover" })).toBeInTheDocument();
  });

  it("states why saving is blocked when a slide has no description", async () => {
    const layout = emptyLayout();
    layout.slides = [
      { id: "slide-1", assetId: "asset-1", target: { kind: "cover" }, side: "after", description: "  " },
    ];
    const { api } = makeApi(layout, 3);
    renderEditor(api);

    expect(
      await screen.findByText("Give every slide a description so screen readers can read it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save layout" })).toBeDisabled();
  });
});
