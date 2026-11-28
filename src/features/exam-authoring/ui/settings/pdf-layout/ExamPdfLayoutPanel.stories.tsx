import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { ApiError } from "@shared/api-client/errors";
import type { PdfLayoutAsset, PdfLayoutEditorData, PdfTargetOption } from "@shared/sat/pdfLayout";
import logo from "../../../../../assets/warwick-institute-logo.png";
import "../../../../../index.css";
import type { SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";
import { ExamPdfLayoutWorkspace } from "./ExamPdfLayoutWorkspace";

type Fixture = "default" | "custom" | "loading" | "loadError" | "conflict" | "previewError";

const targets: PdfTargetOption[] = [
  { target: { kind: "cover" }, label: "Cover" },
  { target: { kind: "scoreReport" }, label: "Score report" },
  { target: { kind: "answerSummary" }, label: "Answer summary" },
  { target: { kind: "answerKey" }, label: "Answer key" },
  { target: { kind: "examReview" }, label: "Exam review" },
  { target: { kind: "reviewSubject", sectionKey: "reading-writing" }, label: "Reading and Writing" },
  { target: { kind: "reviewModule", sectionKey: "reading-writing", moduleKey: "rw-m1" }, label: "Module 1" },
  { target: { kind: "reviewSubject", sectionKey: "math" }, label: "Math" },
  { target: { kind: "reviewModule", sectionKey: "math", moduleKey: "math-m1" }, label: "Module 1" },
  { target: { kind: "reviewModule", sectionKey: "math", moduleKey: "math-m2-lower" }, label: "Module 2 · Lower" },
  { target: { kind: "reviewModule", sectionKey: "math", moduleKey: "math-m2-higher" }, label: "Module 2 · Higher" },
];

function slideThumbnail(title: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) return logo;
  context.scale(2, 2);
  context.fillStyle = "#edf2ff";
  context.fillRect(0, 0, 320, 180);
  context.fillStyle = "#1e3358";
  context.fillRect(22, 32, 44, 5);
  context.font = "bold 24px sans-serif";
  context.fillText(title, 22, 94);
  context.font = "13px sans-serif";
  context.fillText("SAT Practice 04", 22, 123);
  return canvas.toDataURL("image/png");
}

function readImage(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image could not be read."));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function makeApi(fixture: Fixture): SatPdfLayoutApi {
  const customized = fixture === "custom" || fixture === "conflict" || fixture === "previewError";
  const assets: PdfLayoutAsset[] = [
    { id: "orientation", purpose: "slide", filename: "Orientation.png", contentType: "image/png", bytes: 12200, width: 640, height: 360 },
    { id: "review", purpose: "slide", filename: "Review checklist.png", contentType: "image/png", bytes: 14500, width: 640, height: 360 },
    { id: "school", purpose: "logo", filename: "Campus mark.png", contentType: "image/png", bytes: 34401, width: 700, height: 268 },
  ];
  const images = new Map([
    ["orientation", slideThumbnail("Orientation")],
    ["review", slideThumbnail("Review checklist")],
    ["school", logo],
  ]);
  let saved: PdfLayoutEditorData = {
    revision: customized ? 3 : 0,
    updatedAt: customized ? "2026-11-28T09:04:00Z" : null,
    updatedBy: customized ? "staff-1" : null,
    targets,
    assets: customized ? [...assets] : [],
    layout: {
      slides: customized ? [
        { id: "intro-slide", assetId: "orientation", target: { kind: "cover" }, side: "after", description: "How to use this SAT review." },
        { id: "checklist-slide", assetId: "review", target: { kind: "cover" }, side: "after", description: "A checklist of topics to review." },
      ] : [],
      logos: { cover: null, leftWatermark: customized ? { assetId: "school" } : null, rightWatermark: null },
    },
  };
  let failLoad = fixture === "loadError";
  let failPreview = fixture === "previewError";

  return {
    async load(_examId, signal) {
      await Promise.resolve();
      signal.throwIfAborted();
      if (fixture === "loading") {
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      }
      if (failLoad) {
        failLoad = false;
        throw new Error("Couldn’t load this layout.");
      }
      return structuredClone(saved);
    },
    async save(_examId, revision, layout, signal) {
      signal.throwIfAborted();
      if (fixture === "conflict" && revision === 3 && saved.revision === 3) {
        saved = { ...saved, revision: 4 };
      }
      if (revision !== saved.revision) {
        throw new ApiError({ code: "CONFLICT", status: 409, message: "Another person changed this layout." });
      }
      saved = { ...saved, layout: structuredClone(layout), revision: revision + 1, assets: [...assets] };
      return structuredClone(saved);
    },
    imageUrl(_examId, assetId) {
      return images.get(assetId) ?? logo;
    },
    async upload(_examId, purpose, file, signal) {
      const data = await readImage(file);
      signal.throwIfAborted();
      const bitmap = await createImageBitmap(file);
      const asset = {
        id: crypto.randomUUID(), purpose, filename: file.name, contentType: file.type,
        bytes: file.size, width: bitmap.width, height: bitmap.height,
      };
      bitmap.close();
      signal.throwIfAborted();
      images.set(asset.id, data);
      assets.push(asset);
      return asset;
    },
    async preview(_examId, layout, withAnswerKey, signal, sectionSample, sampleBook) {
      signal.throwIfAborted();
      if (!sectionSample && !sampleBook && failPreview) {
        failPreview = false;
        throw new Error("Couldn’t generate the preview. Try again.");
      }
      const design = layout ?? saved.layout;
      const assetIds = new Set([
        ...design.slides.map((slide) => slide.assetId),
        ...Object.values(design.logos).flatMap((logo) => logo ? [logo.assetId] : []),
      ]);
      const artwork = Object.fromEntries(await Promise.all([...assetIds].map(async (id) => {
        const source = images.get(id);
        if (!source) throw new Error("A preview image is unavailable.");
        if (source.startsWith("data:")) return [id, source];
        const response = await fetch(source, { signal });
        if (!response.ok) throw new Error("A preview image could not be loaded.");
        return [id, await readImage(await response.blob())];
      })));
      const response = await fetch("/__storybook/sat-pdf-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design, artwork, targets, withAnswerKey, sectionSample, sampleBook }),
        signal,
      });
      if (!response.ok || response.headers.get("Content-Type") !== "application/pdf") {
        if (response.status === 404) throw new Error("Start the SAT PDF Storybook to render this sample.");
        throw new Error("Couldn’t generate the sample PDF. Try again.");
      }
      return response.blob();
    },
  };
}

function Example({ fixture, canEdit, startAtSettings }: {
  fixture: Fixture;
  canEdit: boolean;
  startAtSettings: boolean;
}) {
  const [router] = useState(() => {
    const settingsPath = "/sat/exams/sat-practice-04/settings";
    const pdfPath = settingsPath + "/pdf";
    return createMemoryRouter([
      {
        path: settingsPath,
        element: (
          <main className="sat-product mx-auto min-h-dvh max-w-[920px] p-6 text-foreground">
            <h1 className="mb-5 text-2xl font-semibold">Results &amp; scoring</h1>
            <section className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-5" aria-label="Exam PDF">
              <h2 className="font-semibold">Exam PDF</h2>
              <p className="mt-1 text-sm text-muted-foreground">Slides and brand marks applied to every PDF prepared for this exam.</p>
              <Link className="rounded-lg border border-border px-4 py-2" to={pdfPath}>{canEdit ? "Edit PDF layout" : "View PDF layout"}</Link>
            </section>
          </main>
        ),
      },
      {
        path: pdfPath,
        element: <ExamPdfLayoutWorkspace examId="sat-practice-04" examTitle="SAT Practice 04" canEdit={canEdit} settingsPath={settingsPath} api={makeApi(fixture)} />,
      },
    ], { initialEntries: [startAtSettings ? settingsPath : pdfPath] });
  });
  return <RouterProvider router={router} />;
}

const meta = {
  title: "SAT/Exam settings/PDF editor",
  component: Example,
  parameters: { layout: "fullscreen" },
  args: { fixture: "default", canEdit: true, startAtSettings: false },
  argTypes: { fixture: { control: false }, startAtSettings: { control: false } },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openEditor(canvasElement: HTMLElement) {
  return within(await within(canvasElement).findByRole("region", { name: "Exam PDF layout" }));
}

/** The outline collapses on narrow viewports; open it before using it. */
async function openOutline(canvasElement: HTMLElement) {
  const editor = await openEditor(canvasElement);
  const toggle = editor.queryByRole("button", { name: "Show report outline" });
  if (toggle) await userEvent.click(toggle);
  return within(await editor.findByRole("navigation", { name: "Report outline" }));
}

export const SettingsEntry: Story = { args: { startAtSettings: true } };

export const DefaultLayout: Story = {
  play: async ({ canvasElement }) => {
    const editor = await openEditor(canvasElement);
    await expect(await editor.findByRole("button", { name: "Save layout" })).toBeDisabled();
    await expect(await editor.findByText("Default layout")).toBeVisible();
    await expect(await editor.findByRole("img", { name: "Cover sample page" }, { timeout: 20_000 })).toBeVisible();
  },
};

export const CustomPages: Story = {
  args: { fixture: "custom" },
  play: async ({ canvasElement }) => {
    const outline = await openOutline(canvasElement);
    const section = outline.getByRole("button", { name: /^Cover$/ });
    const slide = outline.getByRole("button", { name: /Orientation\.png/ });
    await expect(section.compareDocumentPosition(slide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(slide);
    const editor = await openEditor(canvasElement);
    await expect(await editor.findByRole("img", { name: "How to use this SAT review." })).toBeInTheDocument();
  },
};

export const Branding: Story = {
  args: { fixture: "custom" },
  play: async ({ canvasElement }) => {
    const editor = await openEditor(canvasElement);
    await userEvent.click(await editor.findByRole("radio", { name: "Branding" }));
    const marks = within(await editor.findByRole("navigation", { name: "Brand marks" }));
    await expect(marks.getByText("Campus mark.png")).toBeVisible();
    await expect(await editor.findByRole("img", { name: "Cover logo sample page" }, { timeout: 20_000 })).toBeVisible();
  },
};

export const AddImage: Story = {
  play: async ({ canvasElement }) => {
    const editor = await openEditor(canvasElement);
    await userEvent.click(await editor.findByRole("button", { name: "Add slide after Cover" }));
    const dialog = within(await within(canvasElement).findByRole("dialog"));
    await expect(dialog.getByLabelText("Describe this slide")).toBeVisible();
  },
};

export const Preview: Story = {
  args: { fixture: "custom" },
  play: async ({ canvasElement }) => {
    const editor = await openEditor(canvasElement);
    await userEvent.click(await editor.findByRole("button", { name: "Preview PDF" }));
    await expect(
      await within(canvasElement).findByRole("link", { name: "Download the sample PDF" }, { timeout: 25_000 }),
    ).toBeVisible();
  },
};

export const ReadOnly: Story = {
  args: { fixture: "custom", canEdit: false },
  play: async ({ canvasElement }) => {
    const editor = await openEditor(canvasElement);
    await expect(await editor.findByText("View only")).toBeInTheDocument();
    await expect(editor.queryByRole("button", { name: "Save layout" })).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { fixture: "loading" },
  play: async ({ canvasElement }) => {
    const editor = await openEditor(canvasElement);
    await expect(await editor.findByText("Loading the saved layout…")).toBeVisible();
  },
};

export const LoadFailure: Story = {
  args: { fixture: "loadError" },
  play: async ({ canvasElement }) => {
    const editor = await openEditor(canvasElement);
    await expect(await editor.findByRole("alert")).toHaveTextContent("Couldn’t load this layout.");
    await expect(editor.getByRole("button", { name: "Retry" })).toBeEnabled();
  },
};

export const SaveConflict: Story = {
  args: { fixture: "conflict" },
  play: async ({ canvasElement }) => {
    const outline = await openOutline(canvasElement);
    await userEvent.click(outline.getByRole("button", { name: /Orientation\.png/ }));
    const editor = await openEditor(canvasElement);
    await userEvent.click(await editor.findByRole("button", { name: "Move down" }));
    await userEvent.click(editor.getByRole("button", { name: "Save layout" }));
    await expect(await editor.findByText("Another person changed this layout.")).toBeVisible();
  },
};

export const PreviewFailure: Story = {
  args: { fixture: "previewError" },
  play: async ({ canvasElement }) => {
    const editor = await openEditor(canvasElement);
    await userEvent.click(await editor.findByRole("button", { name: "Preview PDF" }));
    const dialog = within(await within(canvasElement).findByRole("dialog"));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("Couldn’t generate the preview.");
    await expect(dialog.getByRole("button", { name: "Retry preview" })).toBeEnabled();
  },
};


export const LeaveWithUnsavedChanges: Story = {
  args: { fixture: "custom" },
  play: async ({ canvasElement }) => {
    const outline = await openOutline(canvasElement);
    await userEvent.click(outline.getByRole("button", { name: /Orientation\.png/ }));
    const editor = await openEditor(canvasElement);
    await userEvent.click(await editor.findByRole("button", { name: "Move down" }));
    await userEvent.click(editor.getByRole("button", { name: "Back to settings" }));
    const leave = within(await editor.findByRole("region", { name: "Leave the exam PDF layout?" }));
    await expect(leave.getByRole("button", { name: "Save and leave" })).toBeEnabled();
  },
};
