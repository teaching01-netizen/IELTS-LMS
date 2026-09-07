import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "../../../constants/examDefaults";
import type { ExamState } from "../../../types";
import { StudentExamPreview } from "../StudentExamPreview";

function createExamState(): ExamState {
  return {
    title: "Preview Exam",
    type: "Academic",
    activeModule: "writing",
    activePassageId: "p1",
    activeListeningPartId: "l1",
    config: createDefaultConfig("Academic", "Academic"),
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: "Task 1 prompt",
      task2Prompt: "Task 2 prompt",
    },
    speaking: {
      part1Topics: [],
      cueCard: "",
      part3Discussion: [],
    },
  };
}

describe("StudentExamPreview", () => {
  it("shows accessibility controls without zoom controls in the preview shell", () => {
    render(
      <MemoryRouter>
        <StudentExamPreview state={createExamState()} examId="exam-1" initialModule="writing" />
      </MemoryRouter>
    );

    expect(screen.queryByTestId("zoom-controls")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /zoom out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /zoom in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset zoom/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open accessibility settings/i })
    ).toBeInTheDocument();
  });

  it("updates the preview shell font size when the accessibility setting changes", () => {
    const { container } = render(
      <MemoryRouter>
        <StudentExamPreview state={createExamState()} examId="exam-1" initialModule="writing" />
      </MemoryRouter>
    );

    const shell = container.querySelector(".student-exam-shell") as HTMLElement;
    const initialFontSize = shell.style.fontSize;

    fireEvent.click(screen.getByRole("button", { name: /open accessibility settings/i }));
    fireEvent.click(screen.getByTestId("font-size-option-large"));

    expect(shell.style.fontSize).not.toBe(initialFontSize);
    expect(shell.style.fontSize).toContain("clamp");
  });

  it("keeps long objective typing in preview without clearing the value", () => {
    const state = createExamState();
    state.activeModule = "listening";
    state.activeListeningPartId = "part-1";
    state.listening.parts = [
      {
        id: "part-1",
        title: "Part 1",
        audioUrl: "",
        transcript: "",
        pins: [],
        blocks: [
          {
            id: "short-1",
            type: "SHORT_ANSWER",
            instruction: "Answer the question.",
            questions: [{ id: "q-1", prompt: "Name?", correctAnswer: "Alice" }],
            answerRule: "ONE_WORD",
          },
        ],
      },
    ];

    render(
      <MemoryRouter>
        <StudentExamPreview state={state} examId="exam-1" initialModule="listening" />
      </MemoryRouter>
    );

    const input = screen.getByRole("textbox", {
      name: /answer for question 1/i,
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abcdefghijklmnop" } });
    expect(input.value).toBe("abcdefghijklmnop");
  });

  it("shows a single writing placeholder in preview mode", () => {
    render(
      <MemoryRouter>
        <StudentExamPreview state={createExamState()} examId="exam-1" initialModule="writing" />
      </MemoryRouter>
    );

    expect(screen.getAllByText("Write your answer here…")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: /writing response/i })).not.toHaveAttribute(
      "placeholder"
    );
  });

  it("preserves sibling slot values in preview during slot-targeted updates", () => {
    const state = createExamState();
    state.activeModule = "reading";
    state.activePassageId = "passage-1";
    state.reading.passages = [
      {
        id: "passage-1",
        title: "Passage 1",
        content: "Sample",
        blocks: [
          {
            id: "table-1",
            type: "TABLE_COMPLETION",
            instruction: "Complete the table.",
            headers: ["A", "B"],
            rows: [
              ["x", ""],
              ["y", ""],
            ],
            cells: [
              { id: "cell-1", row: 0, col: 1, correctAnswer: "one" },
              { id: "cell-2", row: 1, col: 1, correctAnswer: "two" },
            ],
            answerRule: "ONE_WORD",
          },
        ],
      },
    ];

    render(
      <MemoryRouter>
        <StudentExamPreview state={state} examId="exam-1" initialModule="reading" />
      </MemoryRouter>
    );

    const q1Input = screen.getByRole("textbox", {
      name: /answer for question 1/i,
    }) as HTMLInputElement;
    const q2Input = screen.getByRole("textbox", {
      name: /answer for question 2/i,
    }) as HTMLInputElement;

    fireEvent.change(q1Input, { target: { value: "ONE" } });
    fireEvent.change(q2Input, { target: { value: "TWO" } });

    expect(q1Input.value).toBe("ONE");
    expect(q2Input.value).toBe("TWO");
  });

  it("performs zero network writes while typing and flagging in preview mode", async () => {
    const previewFetchFailure = new Error("preview must not fetch");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(previewFetchFailure);
    // jsdom has no sendBeacon: install a trap only when the surface exists,
    // otherwise define one so any beacon attempt is still observed.
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
    vi.useFakeTimers();
    try {
      const state = createExamState();
      state.activeModule = "listening";
      state.activeListeningPartId = "part-1";
      state.listening.parts = [
        {
          id: "part-1",
          title: "Part 1",
          audioUrl: "",
          transcript: "",
          pins: [],
          blocks: [
            {
              id: "short-1",
              type: "SHORT_ANSWER",
              instruction: "Answer the question.",
              questions: [{ id: "q-1", prompt: "Name?", correctAnswer: "Alice" }],
              answerRule: "ONE_WORD",
            },
          ],
        },
      ];

      render(
        <MemoryRouter>
          <StudentExamPreview state={state} examId="exam-1" initialModule="listening" />
        </MemoryRouter>
      );

      const input = screen.getByRole("textbox", {
        name: /answer for question 1/i,
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "preview-answer" } });
      expect(input.value).toBe("preview-answer");

      const flagButton = screen.getByRole("button", { name: /flag question|unflag question/i });
      fireEvent.click(flagButton);

      const flagAgain = screen.getByRole("button", { name: /flag question|unflag question/i });
      fireEvent.click(flagAgain);

      // Flush any debounced durability or heartbeat window (100ms debounce +
      // heartbeat cadence) while the network is failed-closed: any scheduled
      // write must surface through the failed fetch spy or the beacon/WS traps.
      await vi.advanceTimersByTimeAsync(60_000);

      // Under fake timers waitFor cannot progress: assert synchronously after
      // the flush. Any scheduled write would already have hit a network trap.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beaconSpy).not.toHaveBeenCalled();
      expect(wsSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      fetchSpy.mockRestore();
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the same image zoom fit contract in preview mode", () => {
    const state = createExamState();
    state.activeModule = "reading";
    state.activePassageId = "passage-1";
    state.reading.passages = [
      {
        id: "passage-1",
        title: "Passage 1",
        content: "Sample",
        images: [{ id: "img-1", src: "/preview-image.png", alt: "Preview chart", annotations: [] }],
        blocks: [],
      },
    ];

    render(
      <MemoryRouter>
        <StudentExamPreview state={state} examId="exam-1" initialModule="reading" />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /^preview chart$/i }));

    const modalImage = screen.getByTestId("zoom-media-image") as HTMLImageElement;
    Object.defineProperty(modalImage, "naturalWidth", { configurable: true, value: 1200 });
    Object.defineProperty(modalImage, "naturalHeight", { configurable: true, value: 1800 });
    fireEvent.load(modalImage);

    expect(screen.getByRole("button", { name: /reset image zoom/i })).toHaveTextContent("100%");
    fireEvent.click(screen.getByRole("button", { name: /zoom in image/i }));
    expect(screen.getByRole("button", { name: /reset image zoom/i })).toHaveTextContent("120%");
    fireEvent.click(screen.getByRole("button", { name: /reset image zoom/i }));
    expect(screen.getByRole("button", { name: /reset image zoom/i })).toHaveTextContent("100%");
  });
});
