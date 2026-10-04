import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StimulusPane } from "../StimulusPane";
import { createInitialExamState } from "../../services/examAdapterService";
import {
  rotateImageFile,
  uploadAssessmentPassageImage,
} from "../../services/actScienceChoiceImageService";
import type { ExamState, StimulusImageAsset } from "../../types";

vi.mock("../../services/actScienceChoiceImageService", () => ({
  ACT_SCIENCE_CHOICE_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp"],
  uploadActScienceChoiceImage: vi.fn(),
  uploadActScienceQuestionImage: vi.fn(),
  uploadActScienceStimulusImage: vi.fn(),
  uploadAssessmentPassageImage: vi.fn(),
  rotateImageFile: vi.fn(),
}));

const createPassageImage = (): StimulusImageAsset => ({
  id: "reading-image-1",
  alt: "Passage figure",
  annotations: [],
  crop: { x: 0, y: 0, width: 100, height: 100 },
  height: 520,
  src: "/api/v1/media/reading-image-1/content",
  width: 840,
  zoom: 1,
});

describe("IELTS Reading passage images", () => {
  beforeEach(() => {
    vi.mocked(uploadAssessmentPassageImage).mockReset();
    vi.mocked(rotateImageFile).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pastes a clipboard image inline into the passage", async () => {
    vi.mocked(uploadAssessmentPassageImage).mockResolvedValue("/api/v1/media/pasted-asset/content");
    const state = createInitialExamState("IELTS Practice", "Academic", "Academic");
    state.reading.passages[0]!.content = "<p>Passage text</p>";
    state.reading.passages[0]!.images = [];

    function Harness() {
      const [current, setCurrent] = useState<ExamState>(state);
      return (
        <StimulusPane
          passage={current.reading.passages[0]!}
          state={current}
          setState={setCurrent}
          examId="exam-ielts-1"
        />
      );
    }

    render(<Harness />);
    const imageFile = new File(["image bytes"], "diagram.jpeg", { type: "image/jpeg" });
    const editor = screen.getByRole("textbox", { name: "Reading passage editor" });
    const textNode = editor.querySelector("p")?.firstChild;
    expect(textNode).toBeTruthy();
    const range = document.createRange();
    range.setStart(textNode!, "Passage ".length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.paste(editor, {
      clipboardData: {
        items: [{ kind: "file", type: "image/jpeg", getAsFile: () => imageFile }],
        files: [imageFile],
        getData: () => "",
      },
    });

    await waitFor(() => {
      expect(editor.querySelector("img")).toHaveAttribute("alt", "diagram.jpeg");
    });
    expect(editor.querySelector("p")?.innerHTML).toContain("Passage <img");
    expect(editor.querySelector("img")).toHaveAttribute("src", "/api/v1/media/pasted-asset/content");
    expect(uploadAssessmentPassageImage).toHaveBeenCalledWith(imageFile, "exam-ielts-1");
  });

  it("rotates and uploads images added through the Passage toolbar", async () => {
    vi.mocked(uploadAssessmentPassageImage).mockResolvedValue("/api/v1/media/uploaded-asset/content");
    const rotatedFile = new File(["rotated image bytes"], "uploaded.jpeg", { type: "image/jpeg" });
    vi.mocked(rotateImageFile).mockResolvedValue(rotatedFile);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["image bytes"], { type: "image/jpeg" })),
    }));
    const state = createInitialExamState("IELTS Practice", "Academic", "Academic");

    function Harness() {
      const [current, setCurrent] = useState<ExamState>(state);
      return (
        <StimulusPane
          passage={current.reading.passages[0]!}
          state={current}
          setState={setCurrent}
          examId="exam-ielts-1"
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Insert image" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const imageFile = new File(["image bytes"], "uploaded.jpeg", { type: "image/jpeg" });
    fireEvent.change(fileInput!, { target: { files: [imageFile] } });

    await screen.findByRole("img", { name: "uploaded.jpeg" });
    const saveButton = await screen.findByRole("button", { name: "Save Annotations" });
    expect(screen.getByText("Rotate image")).toBeInTheDocument();
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Rotate image right 90 degrees" }));
    await waitFor(() => expect(rotateImageFile).toHaveBeenCalledWith(expect.any(File), "right"));
    fireEvent.click(saveButton);

    await waitFor(() => expect(uploadAssessmentPassageImage).toHaveBeenCalled());
    expect(await screen.findByRole("img", { name: "uploaded.jpeg" })).toHaveAttribute(
      "src",
      "/api/v1/media/uploaded-asset/content",
    );
    expect(uploadAssessmentPassageImage).toHaveBeenCalledWith(rotatedFile, "exam-ielts-1");
    expect(screen.getByText("Attached Images: 1")).toBeInTheDocument();
  });

  it("moves existing embedded IELTS passage images to managed storage", async () => {
    vi.mocked(uploadAssessmentPassageImage).mockResolvedValue("/api/v1/media/legacy-asset/content");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["image bytes"], { type: "image/jpeg" })),
    }));
    const state = createInitialExamState("IELTS Practice", "Academic", "Academic");
    state.reading.passages[0]!.images = [{
      ...createPassageImage(),
      src: "data:image/jpeg;base64,aGVsbG8=",
    }];

    function Harness() {
      const [current, setCurrent] = useState<ExamState>(state);
      return (
        <StimulusPane
          passage={current.reading.passages[0]!}
          state={current}
          setState={setCurrent}
          examId="exam-ielts-1"
        />
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Passage figure" })).toHaveAttribute(
        "src",
        "/api/v1/media/legacy-asset/content",
      );
    });
    expect(uploadAssessmentPassageImage).toHaveBeenCalledWith(expect.any(File), "exam-ielts-1");
  });

  it("lets an author remove an image attached below the passage", () => {
    const state = createInitialExamState("IELTS Practice", "Academic", "Academic");
    state.reading.passages[0]!.images = [createPassageImage()];

    function Harness() {
      const [current, setCurrent] = useState<ExamState>(state);
      return (
        <StimulusPane
          passage={current.reading.passages[0]!}
          state={current}
          setState={setCurrent}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByTestId("passage-attached-images-grid").style.gridTemplateColumns).toContain(
      "auto-fit",
    );
    expect(screen.getByText("0 annotations").parentElement).toHaveClass("flex-wrap");
    const displayWidthGroup = screen.getByRole("group", {
      name: "Image display width for Passage figure",
    });
    expect(displayWidthGroup).toHaveClass("grid", "grid-cols-4");
    expect(displayWidthGroup.querySelectorAll("button")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Remove image: Passage figure" }));

    expect(screen.queryByRole("img", { name: "Passage figure" })).not.toBeInTheDocument();
    expect(screen.getByText("Attached Images: 0")).toBeInTheDocument();
  });

  it("rotates an attached IELTS passage image and uploads the rotated image to assessment media", async () => {
    const rotatedFile = new File(["rotated bytes"], "Passage figure.jpg", { type: "image/jpeg" });
    vi.mocked(rotateImageFile).mockResolvedValue(rotatedFile);
    vi.mocked(uploadAssessmentPassageImage).mockResolvedValue("/api/v1/media/rotated-image/content");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["source bytes"], { type: "image/jpeg" })),
    }));
    const state = createInitialExamState("IELTS Practice", "Academic", "Academic");
    state.reading.passages[0]!.images = [createPassageImage()];

    function Harness() {
      const [current, setCurrent] = useState<ExamState>(state);
      return (
        <StimulusPane
          passage={current.reading.passages[0]!}
          state={current}
          setState={setCurrent}
          examId="exam-ielts-rotate"
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate Passage figure right 90 degrees" }));

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Passage figure" })).toHaveAttribute(
        "src",
        "/api/v1/media/rotated-image/content",
      );
    });
    expect(rotateImageFile).toHaveBeenCalledWith(expect.any(File), "right");
    expect(uploadAssessmentPassageImage).toHaveBeenCalledWith(rotatedFile, "exam-ielts-rotate");
  });
});
