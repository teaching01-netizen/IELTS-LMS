/**
 * P0.4 — Fixture coverage manifest (plans/ielts-act-ux-production phase-00-baseline.md).
 *
 * Deterministic, test-only exam/question fixtures covering every supported
 * `QuestionType` plus the edge invariants later phases assert against:
 * long/short content, identical prompts on different task IDs, empty
 * content, 1,000+ word essays, IME text, broken media, and non-40 ACT
 * question counts. Every fixture carries a stable ID and a label naming the
 * invariant it exercises, so a failure names the regression.
 *
 * This module owns NO production behavior and never contains candidate data,
 * credentials, or live API URLs. E2E runtime fixtures remain in
 * e2e/support/actFixtures.ts; these builders serve component/integration
 * tests. All IDs are namespaced so suites can run in parallel without
 * collisions.
 */

import type {
  ActScienceStimulus,
  ClassificationBlock,
  ClozeBlock,
  DiagramLabelingBlock,
  Exam,
  ExamConfig,
  ExamState,
  FlowChartBlock,
  ListeningPart,
  MapBlock,
  MatchingBlock,
  MatchingFeaturesBlock,
  ModuleType,
  MultiMCQBlock,
  NoteCompletionBlock,
  Passage,
  QuestionBlock,
  QuestionType,
  SentenceCompletionBlock,
  ShortAnswerBlock,
  SingleMCQBlock,
  TableCompletionBlock,
  TFNGBlock,
  WritingTaskContent,
} from "../../../types";

/** Stable fixture namespace shared by every builder in this module. */
export const FIXTURE_NAMESPACE = "uxfx";

let fixtureCounter = 0;

/**
 * Deterministic unique IDs: a monotonically increasing counter gives every
 * builder call distinct IDs within a build pass, while a per-label sequence
 * number keeps repeated passes (same call order) reproducible across tests.
 */
export function nextFixtureId(label: string): string {
  fixtureCounter += 1;
  return `${FIXTURE_NAMESPACE}-${label}-${String(fixtureCounter).padStart(4, "0")}`;
}

/** Reset the ID sequence; call inside a test's build pass for stable snapshots. */
export function resetFixtureIds(): void {
  fixtureCounter = 0;
}

/** Test-only band table: raw -> band, deterministic and bounded. */
function bandTable(): Record<number, number> {
  const table: Record<number, number> = {};
  for (let raw = 0; raw <= 40; raw += 1) {
    table[raw] = Math.min(9, Math.floor((raw / 40) * 9 * 2) / 2);
  }
  return table;
}

function moduleConfig(
  label: string,
  order: number,
  allowedQuestionTypes: QuestionType[],
): ExamConfig["sections"]["reading"] {
  return {
    enabled: true,
    label,
    duration: 60,
    order,
    gapAfterMinutes: 0,
    allowedQuestionTypes,
    passageCount: 1,
    bandScoreTable: bandTable(),
  } as ExamConfig["sections"]["reading"];
}

function scienceConfig(questionCount: number): ExamConfig["sections"]["science"] {
  return {
    enabled: true,
    label: "Science",
    duration: 40,
    order: 1,
    gapAfterMinutes: 0,
    allowedQuestionTypes: ["SINGLE_MCQ"],
    questionCount,
    bandScoreTable: bandTable(),
  } as ExamConfig["sections"]["science"];
}

function baseConfig(type: Exam["type"], preset: ExamConfig["general"]["preset"]): ExamConfig {
  return {
    general: {
      preset,
      type,
      ieltsMode: type !== "ACT",
      title: "UX fixture exam",
      summary: "Deterministic fixture used by student UX tests",
      instructions: "Answer every question. The timer is authoritative.",
    },
    sections: {
      listening: moduleConfig("Listening", 1, [
        "CLOZE",
        "SENTENCE_COMPLETION",
        "TABLE_COMPLETION",
        "NOTE_COMPLETION",
        "MULTI_MCQ",
      ]),
      reading: moduleConfig("Reading", 2, [
        "TFNG",
        "MATCHING",
        "MAP",
        "SHORT_ANSWER",
        "DIAGRAM_LABELING",
        "FLOW_CHART",
        "CLASSIFICATION",
        "MATCHING_FEATURES",
        "SINGLE_MCQ",
      ]),
      writing: {
        enabled: true,
        label: "Writing",
        duration: 60,
        order: 3,
        gapAfterMinutes: 0,
        allowedQuestionTypes: [],
        tasks: [
          { id: "task1", label: "Task 1", taskType: "task1-academic", minWords: 150, recommendedTime: 20 },
          { id: "task2", label: "Task 2", taskType: "task2-essay", minWords: 250, recommendedTime: 40 },
        ],
        rubricWeights: { taskAchievement: 25, coherenceCohesion: 25, lexicalResource: 25, grammaticalRangeAccuracy: 25 },
      } as ExamConfig["sections"]["writing"],
      speaking: {
        enabled: true,
        label: "Speaking",
        duration: 15,
        order: 4,
        gapAfterMinutes: 0,
        allowedQuestionTypes: [],
        parts: [
          { id: "part1", label: "Part 1", prepTime: 60, speakingTime: 120 },
          { id: "part2", label: "Part 2", prepTime: 60, speakingTime: 120 },
        ],
        rubricWeights: { fluencyCoherence: 25, lexicalResource: 25, grammaticalRangeAccuracy: 25, pronunciation: 25 },
      } as ExamConfig["sections"]["speaking"],
      science: scienceConfig(35),
    },
    standards: {
      passageWordCount: { optimalMin: 600, optimalMax: 900, warningMin: 500, warningMax: 1000 },
      writingTasks: {
        task1: { minWords: 150, recommendedTime: 20 },
        task2: { minWords: 250, recommendedTime: 40 },
      },
      rubricDeviationThreshold: 1,
      rubricWeights: {
        writing: { taskAchievement: 25, coherenceCohesion: 25, lexicalResource: 25, grammaticalRangeAccuracy: 25 },
        speaking: { fluencyCoherence: 25, lexicalResource: 25, grammaticalRangeAccuracy: 25, pronunciation: 25 },
      },
      bandScoreTables: {
        listening: bandTable(),
        readingAcademic: bandTable(),
        readingGeneralTraining: bandTable(),
      },
    },
    progression: {
      autoSubmit: true,
      lockAfterSubmit: true,
      allowPause: false,
      showWarnings: true,
      warningThreshold: 5,
      unansweredSubmissionPolicy: "confirm",
    },
    delivery: {
      launchMode: "proctor_start",
      transitionMode: "auto_with_proctor_override",
      allowedExtensionMinutes: [5, 10],
    },
    scoring: { overallRounding: "nearest-0.5" },
    security: {
      tabSwitchRule: "warn",
      detectSecondaryScreen: false,
      blockClipboard: true,
      antiScreenshotGuardEnabled: false,
      preventAutofill: true,
      preventAutocorrect: false,
      preventTranslation: true,
      proctoringFlags: { webcam: false, audio: false, screen: false },
    },
  };
}

/** Every supported QuestionType — the manifest asserts this list stays complete. */
export const ALL_QUESTION_TYPES: readonly QuestionType[] = [
  "TFNG",
  "CLOZE",
  "MATCHING",
  "MAP",
  "MULTI_MCQ",
  "SINGLE_MCQ",
  "SHORT_ANSWER",
  "SENTENCE_COMPLETION",
  "DIAGRAM_LABELING",
  "FLOW_CHART",
  "TABLE_COMPLETION",
  "NOTE_COMPLETION",
  "CLASSIFICATION",
  "MATCHING_FEATURES",
];

/** One representative, stable block per QuestionType. */
export function blockForType(type: QuestionType): QuestionBlock {
  switch (type) {
    case "TFNG":
      return {
        id: nextFixtureId("tfng"),
        type: "TFNG",
        instruction: "Do the following statements agree with the information?",
        mode: "TFNG",
        questions: [
          { id: nextFixtureId("tfng-q"), statement: "The bridge opened before the railway.", correctAnswer: "T" },
          { id: nextFixtureId("tfng-q"), statement: "The tunnel is the longest in the region.", correctAnswer: "NG" },
        ],
      } satisfies TFNGBlock;
    case "CLOZE":
      return {
        id: nextFixtureId("cloze"),
        type: "CLOZE",
        instruction: "Complete the summary with ONE WORD ONLY.",
        answerRule: "ONE_WORD",
        questions: [
          { id: nextFixtureId("cloze-q"), prompt: "The canal was widened in ___ to carry coal.", correctAnswer: "1790", acceptedAnswers: ["1790", "in 1790"] },
        ],
      } satisfies ClozeBlock;
    case "MATCHING":
      return {
        id: nextFixtureId("matching"),
        type: "MATCHING",
        instruction: "Choose the correct heading for each paragraph.",
        headings: [
          { id: "h1", text: "Early resistance" },
          { id: "h2", text: "A change of law" },
          { id: "h3", text: "Modern reassessment" },
        ],
        questions: [
          { id: nextFixtureId("matching-q"), paragraphLabel: "A", correctHeading: "h1" },
          { id: nextFixtureId("matching-q"), paragraphLabel: "B", correctHeading: "h2" },
        ],
      } satisfies MatchingBlock;
    case "MAP":
      return {
        id: nextFixtureId("map"),
        type: "MAP",
        instruction: "Label the map below.",
        assetUrl: "fixture://maps/valley-plan.svg",
        questions: [
          { id: nextFixtureId("map-q"), label: "Weighbridge", correctAnswer: "office", x: 20, y: 40 },
        ],
      } satisfies MapBlock;
    case "MULTI_MCQ":
      return {
        id: nextFixtureId("multi-mcq"),
        type: "MULTI_MCQ",
        instruction: "Choose TWO answers.",
        stem: "Which two materials were imported?",
        requiredSelections: 2,
        options: [
          { id: "opt-a", text: "Teak", isCorrect: true },
          { id: "opt-b", text: "Granite", isCorrect: false },
          { id: "opt-c", text: "Slate", isCorrect: true },
          { id: "opt-d", text: "Oak", isCorrect: false },
        ],
      } satisfies MultiMCQBlock;
    case "SINGLE_MCQ":
      return {
        id: nextFixtureId("single-mcq"),
        type: "SINGLE_MCQ",
        instruction: "Choose the correct letter.",
        stem: "What does the writer conclude about the mill?",
        options: [
          { id: "opt-1", text: "It was rebuilt after a fire.", isCorrect: false },
          { id: "opt-2", text: "It outlasted the canal network.", isCorrect: true },
        ],
      } satisfies SingleMCQBlock;
    case "SHORT_ANSWER":
      return {
        id: nextFixtureId("short-answer"),
        type: "SHORT_ANSWER",
        instruction: "Answer with NO MORE THAN TWO WORDS.",
        questions: [
          { id: nextFixtureId("sa-q"), prompt: "Who funded the viaduct?", correctAnswer: "town council", acceptedAnswers: ["town council", "the town council"], answerRule: "TWO_WORDS" },
        ],
      } satisfies ShortAnswerBlock;
    case "SENTENCE_COMPLETION":
      return {
        id: nextFixtureId("sentence"),
        type: "SENTENCE_COMPLETION",
        instruction: "Complete each sentence with ONE WORD ONLY.",
        answerRule: "ONE_WORD",
        questions: [
          {
            id: nextFixtureId("sentence-q"),
            sentence: "The last barge sailed through the ___ in 1948.",
            blanks: [{ id: nextFixtureId("blank"), correctAnswer: "lock", position: 0 }],
          },
        ],
      } satisfies SentenceCompletionBlock;
    case "DIAGRAM_LABELING":
      return {
        id: nextFixtureId("diagram"),
        type: "DIAGRAM_LABELING",
        instruction: "Label the diagram of the lock system.",
        imageUrl: "fixture://images/lock-diagram.svg",
        labels: [
          { id: nextFixtureId("label"), x: 30, y: 60, prompt: "Upper gate", correctAnswer: "gate" },
        ],
      } satisfies DiagramLabelingBlock;
    case "FLOW_CHART":
      return {
        id: nextFixtureId("flow"),
        type: "FLOW_CHART",
        instruction: "Complete the flow chart.",
        steps: [
          { id: nextFixtureId("step"), label: "Survey the route", correctAnswer: "survey" },
        ],
      } satisfies FlowChartBlock;
    case "TABLE_COMPLETION":
      return {
        id: nextFixtureId("table"),
        type: "TABLE_COMPLETION",
        instruction: "Complete the table.",
        headers: ["Year", "Cargo", "Note"],
        rows: [["1890", "___", "peak tonnage"], ["1904", "coal", "___"]],
        cells: [
          { id: nextFixtureId("cell"), correctAnswer: "wool", row: 0, col: 1, position: 0 },
          { id: nextFixtureId("cell"), correctAnswer: "decline", row: 1, col: 2, position: 1 },
        ],
        answerRule: "ONE_WORD",
      } satisfies TableCompletionBlock;
    case "NOTE_COMPLETION":
      return {
        id: nextFixtureId("note"),
        type: "NOTE_COMPLETION",
        instruction: "Complete the notes.",
        questions: [
          {
            id: nextFixtureId("note-q"),
            noteText: "Fees were shared between the ___ and the canal trust.",
            blanks: [{ id: nextFixtureId("nblank"), correctAnswer: "county", position: 0 }],
            answerRule: "ONE_WORD",
          },
        ],
      } satisfies NoteCompletionBlock;
    case "CLASSIFICATION":
      return {
        id: nextFixtureId("classification"),
        type: "CLASSIFICATION",
        instruction: "Classify each statement.",
        categories: ["Canal", "Railway"],
        items: [
          { id: nextFixtureId("item"), text: "Carried coal from 1790.", correctCategory: "Canal" },
        ],
      } satisfies ClassificationBlock;
    case "MATCHING_FEATURES":
      return {
        id: nextFixtureId("matching-features"),
        type: "MATCHING_FEATURES",
        instruction: "Match each feature to the correct person.",
        features: [
          { id: nextFixtureId("feature"), text: "Designed the aqueduct", correctMatch: "telford" },
        ],
        options: ["brindley", "telford"],
      } satisfies MatchingFeaturesBlock;
  }
}

/** A passage whose content can be swapped for long/empty/annotated variants. */
export function makePassage(overrides?: Partial<Passage>): Passage {
  return {
    id: nextFixtureId("passage"),
    title: "The Canal Engineers",
    content:
      "<p><strong>A</strong> The first proposal for a locks-based route was mocked…</p>" +
      "<p><strong>B</strong> Brindley's answer was to follow the contour…</p>",
    blocks: [blockForType("TFNG"), blockForType("MATCHING")],
    ...overrides,
  };
}

/** Two tasks with IDENTICAL prompt text but different task IDs (P4.2 regression). */
export function makeIdenticalPromptTasks(): WritingTaskContent[] {
  const identicalPrompt =
    "Some people believe every town should have a car-free city centre. To what extent do you agree?";
  return [
    { taskId: "task-identical-1", prompt: identicalPrompt },
    { taskId: "task-identical-2", prompt: identicalPrompt },
  ];
}

/** A deterministic 1,000+ word draft (no truncation surprises). */
export function longEssayDraft(minWords = 1050): string {
  const sentence = "The committee reviewed the canal accounts and deferred the levy until spring. ";
  const words = Math.ceil(minWords / 11);
  return Array.from({ length: words }, (_, i) => sentence + (i % 25 === 0 ? String(i) : "")).join(" ");
}

/** IME composition text: Japanese, CJK, and combining-diacritic sequences. */
export const IME_DRAFT_SAMPLES = [
  "にほんごの れんしゅう", // kana composition mid-IME
  "测量运河的费用", // CJK
  "cafe\u0301 note\u0308", // combining diacritics (decomposed)
] as const;

/** Broken/missing media references for failure-state fixtures. */
export const BROKEN_MEDIA = {
  listeningAudio: "fixture://audio/missing-track.mp3",
  diagramImage: "fixture://images/missing-diagram.svg",
  stimulusImage: "fixture://images/missing-stimulus.png",
} as const;

/** Minimal IELTS exam fixture; callers override content per test. */
export function makeExamFixture(options?: {
  type?: Exam["type"];
  preset?: ExamConfig["general"]["preset"];
  passages?: Passage[];
  listeningParts?: ListeningPart[];
  writingTasks?: WritingTaskContent[];
  stimuli?: ActScienceStimulus[];
  activeModule?: ModuleType;
}): Exam {
  const type = options?.type ?? "Academic";
  const preset = options?.preset ?? (type === "ACT" ? "ACT Science" : "Academic");
  const config = baseConfig(type, preset);
  const content: ExamState = {
    title: "UX fixture exam",
    type,
    activeModule: options?.activeModule ?? "reading",
    activePassageId: "passage-1",
    activeListeningPartId: "part-1",
    activeScienceStimulusId: "stimulus-1",
    config,
    reading: { passages: options?.passages ?? [makePassage({ id: "passage-1" })] },
    listening: { parts: options?.listeningParts ?? [] },
    writing: {
      task1Prompt: options?.writingTasks?.[0]?.prompt ?? "Task 1 prompt",
      task2Prompt: options?.writingTasks?.[1]?.prompt ?? "Task 2 prompt",
      tasks: options?.writingTasks,
    },
    speaking: {
      part1Topics: ["Your home town", "Daily routines"],
      cueCard: "Describe a canal or river you have visited.",
      part3Discussion: ["Why do people value waterways?"],
    },
    science: { stimuli: options?.stimuli ?? [] },
  };
  return {
    id: nextFixtureId("exam"),
    title: "UX fixture exam",
    type,
    status: "Published",
    author: "UX fixture suite",
    lastModified: "2026-09-12T00:00:00.000Z",
    createdAt: "2026-09-12T00:00:00.000Z",
    content,
  };
}

/** ACT Science stimulus fixture with a non-40 question count and an image. */
export function makeActStimulus(options?: {
  questionCount?: number;
  imageSrc?: string;
  withChoiceImages?: boolean;
}): ActScienceStimulus {
  const questionCount = options?.questionCount ?? 35;
  const questions = Array.from({ length: questionCount }, (_, i) => ({
    id: nextFixtureId("act-q"),
    stem: `According to Study ${i % 2 === 0 ? "1" : "2"}, which prediction holds?`,
    options: [
      { id: `act-opt-${i}-a`, text: "Dissolved oxygen decreases linearly.", isCorrect: true },
      { id: `act-opt-${i}-b`, text: options?.withChoiceImages ? undefined ?? "Salinity stays constant." : "Salinity stays constant.", imageUrl: options?.withChoiceImages ? BROKEN_MEDIA.stimulusImage : undefined, isCorrect: false },
      { id: `act-opt-${i}-c`, text: "Temperature reverses the trend.", isCorrect: false },
    ],
    skillCategory: (i % 2 === 0 ? "interpretation_of_data" : "scientific_investigation") as
      | "interpretation_of_data"
      | "scientific_investigation",
  }));
  return {
    id: nextFixtureId("act-stimulus"),
    title: "Dissolved oxygen in Mill Pond",
    content:
      "<p>Students measured dissolved oxygen at three depths…</p>" +
      "<table><tr><th>Depth</th><th>mg/L</th></tr><tr><td>1 m</td><td>9.2</td></tr></table>",
    blocks: [
      {
        id: nextFixtureId("act-block"),
        type: "SINGLE_MCQ",
        instruction: "Choose the correct letter.",
        stem: "Which prediction does Study 1 support?",
        questions,
        options: questions.flatMap((q) => q.options),
      },
    ],
    images: [
      {
        id: nextFixtureId("act-image"),
        alt: "Scatter plot of oxygen against depth",
        src: options?.imageSrc ?? BROKEN_MEDIA.stimulusImage,
        annotations: [],
        crop: { x: 0, y: 0, width: 0, height: 0 },
        width: 640,
        height: 480,
        zoom: 1,
      },
    ],
  };
}

/** A General Training reading passage variant (letter-style content). */
export function makeGeneralTrainingPassage(): Passage {
  return makePassage({
    title: "Community centre booking",
    content:
      "<p>Dear residents, the committee has updated the hall booking rules…</p>",
  });
}

/**
 * Manifest label used by the P0 gate test: each entry maps an invariant to
 * the builder that must keep exercising it.
 */
export const FIXTURE_MANIFEST: ReadonlyArray<{ invariant: string; builder: string }> = [
  { invariant: "all 14 QuestionType blocks construct and typecheck", builder: "blockForType + ALL_QUESTION_TYPES" },
  { invariant: "two writing tasks with identical prompt text and distinct task IDs", builder: "makeIdenticalPromptTasks" },
  { invariant: "1,000+ word essay draft without truncation", builder: "longEssayDraft" },
  { invariant: "IME composition text (kana, CJK, combining diacritics)", builder: "IME_DRAFT_SAMPLES" },
  { invariant: "broken/missing listening audio, diagram, and stimulus images", builder: "BROKEN_MEDIA" },
  { invariant: "ACT Science with a non-40 question count (35)", builder: "makeActStimulus" },
  { invariant: "Academic and General Training reading variants", builder: "makePassage/makeGeneralTrainingPassage" },
  { invariant: "stable namespaced deterministic IDs", builder: "nextFixtureId" },
];
