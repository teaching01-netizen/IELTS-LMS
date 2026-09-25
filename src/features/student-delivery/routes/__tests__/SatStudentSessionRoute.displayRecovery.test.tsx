import { cleanup, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { createSatReadingPreferences } from "../../domain/satReadingPreferences";
import {
  loadSatNotesColumnOpen,
  satNotesColumnKey,
} from "../../infrastructure/satNotesColumnStore";
import { saveSatReadingPreferences } from "../../infrastructure/satReadingPreferencesStore";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

/**
 * A recovered sitting comes back the way it was left.
 *
 * The display choices a student makes — the passage/question split, screen zoom,
 * and whether the Notes column is part of the layout — used to be a property of
 * the PAGE, so a reload mid-module handed back a fresh-looking exam: the passage
 * snapped back to half width, the zoom reset, and a column the student was
 * writing in vanished. The split and the zoom already ride the attempt's reading
 * preferences; the Notes column rides its own record. These tests pin all of them
 * at the seam where they are read back — a fresh mount of the same attempt — and
 * pin that nothing leaks between attempts or modules.
 */

const controllerMock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../hooks/useSatExamController", () => ({
  useSatExamController: () => controllerMock.current,
}));

function matchMediaMock() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function para(text: string) {
  return { version: 1 as const, nodes: [{ type: "paragraph" as const, id: `p-${text}`, text }] };
}

const MODULES = [
  { id: "math-m1", questionId: "q1", attemptId: "ma-1", order: 0 },
  { id: "math-m2", questionId: "q2", attemptId: "ma-2", order: 1 },
] as const;

function moduleData(): AssessmentDeliveryBootstrap {
  const now = new Date().toISOString();
  const sections = [
    {
      id: "sec-math",
      sectionKey: "math",
      title: "Math",
      displayOrder: 0,
      durationSeconds: 2100,
      breakAfterSeconds: 0,
      instructions: para("Math section directions"),
      modules: MODULES.map((entry) => ({
        id: entry.id,
        moduleKey: entry.id,
        title: `Module ${entry.order + 1}`,
        displayOrder: entry.order,
        durationSeconds: 2100,
        targetQuestionCount: 1,
        adaptiveRole: "base" as const,
        instructions: para("Math module directions"),
        toolPolicy: { calculator: false, reference_sheet: false },
        questions: [
          {
            examQuestionId: entry.questionId,
            questionId: entry.questionId,
            displayOrder: 0,
            isPretest: false,
            questionType: "single_choice" as const,
            stimulus: para(`Passage of ${entry.questionId}`),
            prompt: para(`Display recovery marker ${entry.questionId}`),
            answer: {
              kind: "single_choice" as const,
              options: ["a", "b"].map((id) => ({ id, content: para(`Choice ${id}`) })),
            },
            metadata: {
              sectionKey: "math",
              domain: null,
              skill: null,
              difficulty: "medium" as const,
              tags: [],
            },
            accessibility: { longDescription: null },
          },
        ],
      })),
    },
  ];

  return {
    scheduleId: "schedule-1",
    examId: "exam-1",
    providerKey: "sat",
    versionId: "v1",
    serverNow: now,
    candidateName: "Ada Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "legacy_attempt",
      timingModel: "legacy_section_v1",
      stageKey: null,
      stageStatus: null,
      serverNow: now,
      deadlineAt: null,
      remainingSeconds: 2100,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: sections as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "attempt-1",
      moduleAttempts: MODULES.map((entry) => ({
        id: entry.attemptId,
        moduleId: entry.id,
        state: "active",
        allocatedSeconds: 2100,
        availableAt: now,
        startedAt: now,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionSeconds: 0,
        deadlineAt: null,
        remainingSeconds: 2100,
        completionReason: null,
        rawCorrect: null,
        operationalQuestionCount: null,
        toolState: {},
        revision: 1,
      })) as unknown as AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"],
      responses: [],
    },
    result: null,
  } as AssessmentDeliveryBootstrap;
}

function moduleState(moduleId: string) {
  const now = new Date().toISOString();
  const entry = MODULES.find((candidate) => candidate.id === moduleId)!;
  return {
    phase: "module",
    scheduleId: "schedule-1",
    candidateId: "candidate-1",
    assessmentId: "exam-1",
    sectionKey: "math",
    moduleKey: moduleId,
    questionIds: [entry.questionId],
    questionIndex: 0,
    responses: {
      [entry.questionId]: {
        questionId: entry.questionId,
        answer: "",
        markedForReview: false,
        eliminatedOptionIds: [],
        annotations: { version: 2, annotations: [], legacyQuestionNote: "" },
      },
    },
    responseRevisions: {},
    toolCapabilities: { calculator: false, referenceSheet: false },
    activeTool: null,
    activeTools: { calculator: false, referenceSheet: false },
    startedAt: now,
    endsAt: now,
  };
}

function baseCommands() {
  return {
    startPendingModule: vi.fn(),
    submitModule: vi.fn(),
    retryFinalization: vi.fn(),
    takeOverDurabilityLease: vi.fn().mockResolvedValue(undefined),
    setAnswer: vi.fn(),
    toggleReview: vi.fn(),
    toggleEliminatedOption: vi.fn(),
    setAnnotationNote: vi.fn(),
    setAnnotations: vi.fn(),
    selectQuestion: vi.fn(),
    returnToQuestion: vi.fn(),
    previousQuestion: vi.fn(),
    nextQuestion: vi.fn(),
    reviewModule: vi.fn(),
    returnToModule: vi.fn(),
    showDirections: vi.fn(),
    toggleCalculator: vi.fn(),
    toggleReference: vi.fn(),
    closeTool: vi.fn(),
  };
}

let activeModuleId = "math-m1";

function seed() {
  const data = moduleData();
  const module = data.sections.flatMap((section) => section.modules).find((entry) => entry.id === activeModuleId)!;
  const attempt = data.attempt.moduleAttempts.find((entry) => entry.moduleId === activeModuleId)!;
  controllerMock.current = {
    state: moduleState(activeModuleId),
    data,
    result: null,
    error: null,
    setError: vi.fn(),
    isSubmitting: false,
    isStarting: false,
    autoEntryRecoverable: false,
    entryAutoStartPending: false,
    pendingModule: module,
    pendingBreakSeconds: 0,
    pendingSectionWaitSeconds: 0,
    pendingStageReady: true,
    effectiveTiming: data.timing,
    stateModule: module,
    stateModuleAttempt: attempt,
    stateSection: data.sections[0],
    remainingSeconds: 2100,
    blocked: false,
    warning: null,
    answersRecorded: false,
    showAlmostUp: false,
    pendingTabSwitchWarning: null,
    acknowledgeTabSwitchWarning: vi.fn(),
    persistence: {
      pendingCount: 0,
      visibleDrafts: {},
      failure: null,
      failureKind: null,
      isTakingOver: false,
      flush: vi.fn().mockResolvedValue(undefined),
      retryFailed: vi.fn(),
      takeOverLease: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(),
      submit: vi.fn(),
    },
    commands: baseCommands(),
  };
}

function routeProps(attemptId = "attempt-1") {
  return {
    scheduleId: "schedule-1",
    attemptId,
    candidateId: "candidate-1",
    runtimeSnapshot: null,
    liveSocketConnected: false,
    attemptUpdateToken: 0,
    onExit: () => undefined,
  } as unknown as never;
}

function mount(attemptId = "attempt-1") {
  seed();
  return render(createElement(SatStudentSessionRoute, routeProps(attemptId)));
}

/** The Notes disclosure in the top bar — the one control that opens the column. */
const notesDisclosure = () => screen.getByRole("button", { name: /^Notes/ });

const notesColumn = () => document.querySelector('[data-sat-notes-column="true"]');

const splitGrid = () =>
  (document.querySelector("[data-sat-reading-split]") as HTMLElement | null)?.style
    .gridTemplateColumns ?? "";

function rememberNotesColumnOpen(attemptId = "attempt-1", moduleAttemptId = "ma-1") {
  window.localStorage.setItem(
    satNotesColumnKey("schedule-1", attemptId),
    JSON.stringify({ version: 1, moduleAttemptId, open: true })
  );
}

describe("SatStudentSessionRoute recovered display state", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    activeModuleId = "math-m1";
    matchMediaMock();
  });

  it("resumes the split and the screen zoom the attempt was left with", () => {
    saveSatReadingPreferences("schedule-1", "attempt-1", {
      ...createSatReadingPreferences(),
      splitRatio: 0.62,
      examZoom: 1.25,
    });

    mount();

    // The passage keeps the share of the pane the student dragged...
    expect(splitGrid()).toContain("0.62fr");
    expect(screen.getByRole("slider", { name: /and question width/ })).toHaveAttribute(
      "aria-valuenow",
      "62"
    );
    // ...and the exam keeps the size they chose, not the resting 100%.
    expect(document.querySelector("[data-sat-screen-zoom]")).toHaveAttribute(
      "data-sat-screen-zoom",
      "1.25"
    );
  });

  it("resumes the Notes column the attempt was left with", () => {
    rememberNotesColumnOpen();

    mount();

    expect(notesColumn()).not.toBeNull();
    expect(notesDisclosure()).toHaveAttribute("aria-expanded", "true");
  });

  it("opens with a plain, half-split exam when the attempt remembers nothing", () => {
    mount();

    expect(splitGrid()).toContain("0.5fr");
    expect(document.querySelector("[data-sat-screen-zoom]")).toHaveAttribute(
      "data-sat-screen-zoom",
      "1"
    );
    expect(notesColumn()).toBeNull();
  });

  it("remembers the column across a reload, and remembers closing it", () => {
    const first = mount();
    expect(notesColumn()).toBeNull();

    fireEvent.click(notesDisclosure());
    expect(notesColumn()).not.toBeNull();
    expect(loadSatNotesColumnOpen("schedule-1", "attempt-1", "ma-1")).toBe(true);
    first.unmount();

    // A reload is a fresh mount of the same attempt: the pane comes back.
    const second = mount();
    expect(notesColumn()).not.toBeNull();
    expect(notesDisclosure()).toHaveAttribute("aria-expanded", "true");

    // Closing it is remembered too, so the next load does not reopen it.
    fireEvent.click(notesDisclosure());
    expect(notesColumn()).toBeNull();
    expect(loadSatNotesColumnOpen("schedule-1", "attempt-1", "ma-1")).toBe(false);
    second.unmount();

    mount();
    expect(notesColumn()).toBeNull();
  });

  it("does not carry the pane into the next module", () => {
    rememberNotesColumnOpen();
    const view: RenderResult = mount();
    expect(notesColumn()).not.toBeNull();

    // M1 -> M2 inside one attempt: the record names ma-1, so ma-2 starts closed.
    activeModuleId = "math-m2";
    seed();
    view.rerender(createElement(SatStudentSessionRoute, routeProps()));
    expect(notesColumn()).toBeNull();
    expect(notesDisclosure()).toHaveAttribute("aria-expanded", "false");
  });

  it("does not read another attempt's display state", () => {
    rememberNotesColumnOpen("attempt-2");
    saveSatReadingPreferences("schedule-1", "attempt-2", {
      ...createSatReadingPreferences(),
      splitRatio: 0.62,
      examZoom: 1.25,
    });

    mount();

    expect(notesColumn()).toBeNull();
    expect(splitGrid()).toContain("0.5fr");
    expect(document.querySelector("[data-sat-screen-zoom]")).toHaveAttribute(
      "data-sat-screen-zoom",
      "1"
    );
  });
});
