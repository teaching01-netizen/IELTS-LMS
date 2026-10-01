import React, { useState } from "react";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StimulusPane } from "../StimulusPane";
import { createInitialExamState } from "../../services/examAdapterService";
import { uploadActScienceStimulusImage } from "../../services/actScienceChoiceImageService";
import type { ActScienceStimulus, ExamState } from "../../types";

vi.mock("../../services/actScienceChoiceImageService", () => ({
  rotateImageFile: vi.fn(),
  uploadActScienceStimulusImage: vi.fn(),
}));

describe("StimulusPane ACT Science media persistence", () => {
  it("moves an existing inline passage image to managed storage before saving it in state", async () => {
    vi.mocked(uploadActScienceStimulusImage).mockResolvedValue("/api/v1/media/asset-1/content");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["image bytes"], { type: "image/png" })),
    }));

    const state = createInitialExamState("ACT Science", "ACT", "ACT Science");
    state.activeModule = "science";
    const imageData = "data:image/png;base64,aGVsbG8=";
    const stimulus: ActScienceStimulus = {
      id: "science-stimulus-1",
      title: "Stimulus 1",
      content: "<p>Passage text</p>",
      blocks: [],
      images: [{
        id: "passage-image-1",
        alt: "Passage figure",
        annotations: [],
        crop: { x: 0, y: 0, width: 100, height: 100 },
        height: 520,
        src: imageData,
        width: 840,
        zoom: 1,
      }],
      wordCount: 2,
    };
    state.science.stimuli = [stimulus];
    state.activeScienceStimulusId = stimulus.id;

    function Harness() {
      const [current, setCurrent] = useState<ExamState>(state);
      const currentStimulus = current.science.stimuli[0]!;
      return <StimulusPane passage={currentStimulus} state={current} setState={setCurrent} examId="exam-123" section="science" />;
    }

    render(<Harness />);

    await waitFor(() => expect(uploadActScienceStimulusImage).toHaveBeenCalledWith(expect.any(File), "exam-123"));
    expect(await screen.findByRole("img", { name: "Passage figure" })).toHaveAttribute(
      "src",
      "/api/v1/media/asset-1/content",
    );
  });


  it("uploads pasted ACT Science images before inserting them into Passage", async () => {
    vi.mocked(uploadActScienceStimulusImage).mockResolvedValue("/api/v1/media/pasted-asset/content");
    const state = createInitialExamState("ACT Science", "ACT", "ACT Science");
    state.activeModule = "science";
    const stimulus: ActScienceStimulus = {
      id: "science-stimulus-paste",
      title: "Stimulus 1",
      content: "<p>Passage text</p>",
      blocks: [],
      images: [],
      wordCount: 2,
    };
    state.science.stimuli = [stimulus];
    state.activeScienceStimulusId = stimulus.id;

    function Harness() {
      const [current, setCurrent] = useState<ExamState>(state);
      return <StimulusPane passage={current.science.stimuli[0]!} state={current} setState={setCurrent} examId="exam-123" section="science" />;
    }

    render(<Harness />);
    const imageFile = new File(["image bytes"], "clipboard.png", { type: "image/png" });
    fireEvent.paste(screen.getByRole("textbox", { name: "ACT Science stimulus editor" }), {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => imageFile }],
        getData: () => "",
      },
    });

    const image = await screen.findByRole("img", { name: "clipboard.png" });
    expect(image).toHaveAttribute("src", "/api/v1/media/pasted-asset/content");
    expect(uploadActScienceStimulusImage).toHaveBeenCalledWith(imageFile, "exam-123");
  });
});
