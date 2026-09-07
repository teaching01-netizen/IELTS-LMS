import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentPreviewProjection,
  StructuredContent,
} from "../../../exam-authoring/api/assessmentContracts";
import { SatPreviewRoute } from "../SatPreviewRoute";

const getPreviewMock = vi.hoisted(() => vi.fn());
vi.mock("../../../exam-authoring/api/assessmentAuthoringApi", () => ({
  assessmentAuthoringApi: { getPreview: getPreviewMock },
}));

const content = (text: string): StructuredContent => ({
  version: 1,
  nodes: [{ type: "paragraph", id: `p-${text}`, text }],
});

const projection: AssessmentPreviewProjection = {
  examId: "exam-1",
  providerKey: "sat",
  versionId: "draft-1",
  versionRevision: 1,
  sections: [
    {
      id: "rw",
      sectionKey: "reading-writing",
      title: "Reading & Writing",
      displayOrder: 0,
      durationSeconds: 1200,
      breakAfterSeconds: 600,
      instructions: content("Section directions"),
      modules: [
        {
          id: "rw-m1",
          moduleKey: "rw-m1",
          title: "Module 1",
          displayOrder: 0,
          durationSeconds: 600,
          targetQuestionCount: 1,
          adaptiveRole: "base",
          instructions: content("Module directions"),
          toolPolicy: [],
          questions: [
            {
              examQuestionId: "rw-q1",
              questionId: "q1",
              displayOrder: 0,
              isPretest: false,
              questionType: "single_choice",
              stimulus: content("Passage"),
              prompt: content("Preview question"),
              answer: {
                kind: "single_choice",
                options: ["A", "B", "C", "D"].map((id) => ({
                  id,
                  content: content(`Choice ${id}`),
                })),
              },
              metadata: {
                sectionKey: "reading-writing",
                domain: null,
                skill: null,
                difficulty: "medium",
                tags: [],
              },
              accessibility: { longDescription: null },
            },
          ],
        },
        {
          id: "rw-m2-lower",
          moduleKey: "rw-m2-lower",
          title: "Module 2",
          displayOrder: 1,
          durationSeconds: 600,
          targetQuestionCount: 1,
          adaptiveRole: "lower_branch",
          instructions: content("Lower directions"),
          toolPolicy: [],
          questions: [
            {
              examQuestionId: "lower-q1",
              questionId: "lower-q1",
              displayOrder: 0,
              isPretest: false,
              questionType: "single_choice",
              stimulus: content("Lower passage"),
              prompt: content("Lower branch question"),
              answer: { kind: "single_choice", options: [] },
              metadata: {
                sectionKey: "reading-writing",
                domain: null,
                skill: null,
                difficulty: "medium",
                tags: [],
              },
              accessibility: { longDescription: null },
            },
          ],
        },
        {
          id: "rw-m2-higher",
          moduleKey: "rw-m2-higher",
          title: "Module 2",
          displayOrder: 2,
          durationSeconds: 600,
          targetQuestionCount: 1,
          adaptiveRole: "higher_branch",
          instructions: content("Higher directions"),
          toolPolicy: [],
          questions: [
            {
              examQuestionId: "higher-q1",
              questionId: "higher-q1",
              displayOrder: 0,
              isPretest: false,
              questionType: "single_choice",
              stimulus: content("Higher passage"),
              prompt: content("Higher branch question"),
              answer: { kind: "single_choice", options: [] },
              metadata: {
                sectionKey: "reading-writing",
                domain: null,
                skill: null,
                difficulty: "hard",
                tags: [],
              },
              accessibility: { longDescription: null },
            },
          ],
        },
      ],
    },
    {
      id: "math",
      sectionKey: "math",
      title: "Math",
      displayOrder: 1,
      durationSeconds: 700,
      breakAfterSeconds: 0,
      instructions: content("Math directions"),
      modules: [
        {
          id: "math-m1",
          moduleKey: "math-m1",
          title: "Module 1",
          displayOrder: 0,
          durationSeconds: 700,
          targetQuestionCount: 1,
          adaptiveRole: "base",
          instructions: content("Math module directions"),
          toolPolicy: ["calculator", "reference_sheet"],
          questions: [
            {
              examQuestionId: "math-q1",
              questionId: "math-q1",
              displayOrder: 0,
              isPretest: false,
              questionType: "student_produced_response",
              stimulus: { version: 1, nodes: [] },
              prompt: content("Math preview question"),
              answer: {
                kind: "student_produced_response",
                normalizeFraction: true,
                normalizeDecimal: true,
                numericTolerance: null,
              },
              metadata: {
                sectionKey: "math",
                domain: null,
                skill: null,
                difficulty: "medium",
                tags: [],
              },
              accessibility: { longDescription: null },
            },
          ],
        },
      ],
    },
  ],
};

describe("SatPreviewRoute", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getPreviewMock.mockReset();
    getPreviewMock.mockResolvedValue(projection);
  });

  it("renders the real SAT shell and lets staff inspect adaptive modules and sections", async () => {
    render(
      <MemoryRouter>
        <SatPreviewRoute examId="exam-1" />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("sat-exam-shell")).toBeInTheDocument());
    expect(await screen.findByText("Preview question")).toBeInTheDocument();
    expect(screen.getByText("Staff Preview")).toBeInTheDocument();

    const storageWrite = vi.spyOn(window.localStorage, "setItem");
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    const reading = screen.getByRole("dialog", { name: "Reading" });
    fireEvent.click(within(reading).getByRole("button", { name: "Increase text size" }));
    expect(reading).toHaveTextContent("115%");
    fireEvent.click(within(reading).getByRole("button", { name: "Close reading options" }));

    fireEvent.change(screen.getByLabelText("Preview module"), {
      target: { value: "rw-m2-higher" },
    });
    expect(await screen.findByText("Higher branch question")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    expect(screen.getByRole("dialog", { name: "Reading" })).toHaveTextContent("115%");
    fireEvent.click(screen.getByRole("button", { name: "Close reading options" }));
    expect(storageWrite).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Preview section"), { target: { value: "math" } });
    expect(await screen.findByText("Math preview question")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /calculator/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reference/i })).toBeInTheDocument();
  });

  it("performs zero delivery writes while answering in SAT staff preview", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("SAT preview must not fetch"));
    const beaconSpy = vi.fn().mockReturnValue(true);
    const hadBeacon = typeof navigator.sendBeacon === "function";
    const originalBeacon = hadBeacon ? navigator.sendBeacon.bind(navigator) : undefined;
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: beaconSpy,
    });
    const wsSpy = vi.fn();
    const OriginalWebSocket = globalThis.WebSocket;
    (globalThis as unknown as Record<string, unknown>).WebSocket = wsSpy;
    try {
      render(
        <MemoryRouter>
          <SatPreviewRoute examId="exam-1" />
        </MemoryRouter>
      );
      expect(await screen.findByText("Preview question")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: /option a/i }));
      expect(screen.getByRole("radio", { name: /option a/i })).toBeChecked();
      fireEvent.click(screen.getByRole("radio", { name: /option b/i }));
      expect(screen.getByRole("radio", { name: /option b/i })).toBeChecked();

      // The draft projection resolves via the mocked module API (authoring
      // read, not delivery). Flush microtasks/timers on real timers so any
      // debounced delivery write would surface through the network traps.
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(60_000);
      vi.useRealTimers();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beaconSpy).not.toHaveBeenCalled();
      expect(wsSpy).not.toHaveBeenCalled();
      // Draft fetch is authoring-read, not delivery: the only fetch-shaped
      // dependency is mocked at the module boundary, so global fetch stays idle.
      expect(getPreviewMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      fetchSpy.mockRestore();
      vi.restoreAllMocks();
      if (originalBeacon) {
        Object.defineProperty(navigator, "sendBeacon", {
          configurable: true,
          writable: true,
          value: originalBeacon,
        });
      } else {
        Reflect.deleteProperty(navigator, "sendBeacon");
      }
      (globalThis as unknown as Record<string, unknown>).WebSocket = OriginalWebSocket;
    }
  });
});
