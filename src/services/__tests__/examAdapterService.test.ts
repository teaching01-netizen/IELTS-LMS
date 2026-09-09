import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../constants/examDefaults";
import { createActScienceBlock } from "../../components/ActScienceQuestionBuilderPane";
import { hydrateExamState } from "../examAdapterService";

describe("hydrateExamState", () => {
  it("creates an ACT Science state without IELTS content containers", async () => {
    const { createInitialExamState } = await import("../examAdapterService");
    const state = createInitialExamState("ACT Science Draft", "ACT", "ACT Science");

    expect(state.type).toBe("ACT");
    expect(state.activeModule).toBe("science");
    expect(state.activeScienceStimulusId).toBe("");
    expect(state.science.stimuli).toEqual([]);
    expect(state.reading.passages).toEqual([]);
    expect(state.listening.parts).toEqual([]);
  });

  it("replaces the IELTS fallback summary when creating ACT from shared defaults", async () => {
    const { createInitialExamState } = await import("../examAdapterService");
    const sharedDefaults = createDefaultConfig("Academic", "Academic");

    const state = createInitialExamState("ACT Science Draft", "ACT", "ACT Science", sharedDefaults);

    expect(state.config.general.summary).toBe("Standard ACT Exam");
  });

  it("preserves ACT Science answer-choice image URLs during hydration", async () => {
    const { createInitialExamState } = await import("../examAdapterService");
    const state = createInitialExamState("ACT Science Image Draft", "ACT", "ACT Science");
    const block = createActScienceBlock("act-image-block");
    const imageUrl = " https://example.test/act-option-a.png ";
    const options = block.options.map((option) =>
      option.id === block.options[0]?.id ? { ...option, imageUrl } : option
    );
    block.options = options;
    block.questions![0].options = options;
    state.science.stimuli = [
      {
        id: "act-image-stimulus",
        title: "Image stimulus",
        content: "Compare the choices.",
        blocks: [block],
      },
    ];

    const hydrated = hydrateExamState(state);
    const hydratedBlock = hydrated.science.stimuli[0]?.blocks[0];

    expect(hydratedBlock?.options[0]?.imageUrl).toBe("https://example.test/act-option-a.png");
    expect(hydratedBlock?.questions?.[0]?.options[0]?.imageUrl).toBe(
      "https://example.test/act-option-a.png"
    );

    const academicState = createInitialExamState("IELTS Draft", "Academic");
    academicState.reading.passages[0].blocks = [block];
    const hydratedAcademicState = hydrateExamState(academicState);
    const hydratedAcademicBlock = hydratedAcademicState.reading.passages[0]?.blocks[0];

    expect(hydratedAcademicBlock?.options[0]?.imageUrl).toBeUndefined();
    expect(hydratedAcademicBlock?.questions?.[0]?.options[0]?.imageUrl).toBeUndefined();
  });

  it("preserves ACT Science question-stem image URLs but strips them from IELTS", async () => {
    const { createInitialExamState } = await import("../examAdapterService");
    const actState = createInitialExamState("ACT Science Stem Image Draft", "ACT", "ACT Science");
    const actBlock = createActScienceBlock("act-stem-image-block");
    actBlock.questions![0] = {
      ...actBlock.questions![0],
      imageUrl: " https://example.test/act-question.png ",
    };
    actState.science.stimuli = [
      {
        id: "act-stem-image-stimulus",
        title: "Question image stimulus",
        content: "Read the image.",
        blocks: [actBlock],
      },
    ];

    const hydratedAct = hydrateExamState(actState);
    expect(hydratedAct.science.stimuli[0]?.blocks[0]?.questions?.[0]?.imageUrl).toBe(
      "https://example.test/act-question.png"
    );

    const academicState = createInitialExamState("IELTS Draft", "Academic");
    academicState.reading.passages[0].blocks = [actBlock];
    const hydratedAcademicState = hydrateExamState(academicState);
    expect(hydratedAcademicState.reading.passages[0]?.blocks[0]?.questions?.[0]?.imageUrl).toBe(
      undefined
    );
  });

  it("fills missing exam sections when a corrupted draft only contains config", () => {
    const config = createDefaultConfig("Academic", "Academic");
    config.general.title = "Recovered Exam";

    const hydrated = hydrateExamState({ config } as any);

    expect(hydrated.title).toBe("Recovered Exam");
    expect(hydrated.reading.passages).toHaveLength(config.sections.reading.passageCount);
    expect(hydrated.listening.parts).toHaveLength(config.sections.listening.partCount);
    expect(hydrated.writing.customPromptTemplates).toEqual([]);
    expect(hydrated.speaking.part1Topics.length).toBeGreaterThan(0);
  });

  it("fills missing reading and listening containers when partial content omits them", () => {
    const config = createDefaultConfig("Academic", "Academic");

    const hydrated = hydrateExamState({
      config,
      title: "Recovered Exam",
      type: "Academic",
      writing: {
        task1Prompt: "",
        task2Prompt: "",
      },
      speaking: {
        part1Topics: [],
        cueCard: "",
        part3Discussion: [],
      },
    } as any);

    expect(Array.isArray(hydrated.reading.passages)).toBe(true);
    expect(Array.isArray(hydrated.listening.parts)).toBe(true);
    expect(hydrated.reading.passages).toHaveLength(config.sections.reading.passageCount);
    expect(hydrated.listening.parts).toHaveLength(config.sections.listening.partCount);
  });

  it("clamps invalid passage/part counts to avoid crashing hydration", () => {
    const config = createDefaultConfig("Academic", "Academic");
    (config.sections.reading as any).passageCount = -5;
    (config.sections.listening as any).partCount = Number.NaN;

    expect(() => hydrateExamState({ config } as any)).not.toThrow();

    const hydrated = hydrateExamState({ config } as any);
    expect(hydrated.reading.passages.length).toBeGreaterThan(0);
    expect(hydrated.listening.parts.length).toBeGreaterThan(0);
  });

  it("normalizes legacy diagram image fields when imageUrl is empty", () => {
    const config = createDefaultConfig("Academic", "Academic");

    const hydrated = hydrateExamState({
      config,
      title: "Diagram Recovery Exam",
      type: "Academic",
      reading: {
        passages: [],
      },
      listening: {
        parts: [
          {
            id: "l1",
            title: "Part 1",
            pins: [],
            blocks: [
              {
                id: "d1",
                type: "DIAGRAM_LABELING",
                title: "Diagram one",
                instructions: "",
                imageUrl: "   ",
                imageSrc: " /diagram-from-image-src.png ",
                labels: [{ id: "label-1", x: 10, y: 20, correctAnswer: "A" }],
              },
              {
                id: "d2",
                type: "DIAGRAM_LABELING",
                title: "Diagram two",
                instructions: "",
                imageUrl: "",
                assetUrl: " /diagram-from-asset-url.png ",
                labels: [{ id: "label-2", x: 30, y: 40, correctAnswer: "B" }],
              },
            ],
          },
        ],
      },
      writing: {
        task1Prompt: "",
        task2Prompt: "",
      },
      speaking: {
        part1Topics: [],
        cueCard: "",
        part3Discussion: [],
      },
    } as any);

    const [diagramFromImageSrc, diagramFromAssetUrl] = hydrated.listening.parts[0].blocks as any[];
    expect(diagramFromImageSrc.imageUrl).toBe("/diagram-from-image-src.png");
    expect(diagramFromAssetUrl.imageUrl).toBe("/diagram-from-asset-url.png");
  });
});
