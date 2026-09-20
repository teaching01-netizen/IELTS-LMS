import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeAuthoringDraftOnEntry,
  peekAuthoringDraftOnEntry,
  requestAuthoringDraftOnEntry,
} from "../../application/authoringEntryIntent";
import type { AssessmentAuthoringShell } from "../../contracts/assessment";
import type { AuthoringShellState } from "../../application/authoringShellLifecycle";
import { useDraftOpenOnEntry, type DraftOpenOnEntryInput } from "../useDraftOpenOnEntry";

const EXAM = "exam-1";

const NO_DRAFT: AuthoringShellState = { kind: "no-draft" };
const LOADING: AuthoringShellState = { kind: "loading" };
const READY: AuthoringShellState = {
  kind: "ready",
  shell: { examId: EXAM } as unknown as AssessmentAuthoringShell,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={[`/sat/exams/${EXAM}`]}>{children}</MemoryRouter>
);

function props(openDraft: () => void, overrides: Partial<DraftOpenOnEntryInput> = {}) {
  return {
    examId: EXAM,
    state: NO_DRAFT,
    canOpenDraft: true,
    isOpening: false,
    isFailed: false,
    openDraft,
    ...overrides,
  } satisfies DraftOpenOnEntryInput;
}

function renderEntry(overrides: Partial<DraftOpenOnEntryInput> = {}) {
  const openDraft = vi.fn();
  const view = renderHook((input: DraftOpenOnEntryInput) => useDraftOpenOnEntry(input), {
    wrapper,
    initialProps: props(openDraft, overrides),
  });
  return { openDraft, view };
}

afterEach(() => {
  consumeAuthoringDraftOnEntry(EXAM);
});

describe("useDraftOpenOnEntry", () => {
  it("opens the draft once for an armed arrival and shows progress until it settles", () => {
    requestAuthoringDraftOnEntry(EXAM);
    const { openDraft, view } = renderEntry();

    expect(openDraft).toHaveBeenCalledTimes(1);
    expect(view.result.current.opening).toBe(true);

    // In flight: still the author's arrival, still progress.
    view.rerender(props(openDraft, { isOpening: true }));
    expect(view.result.current.opening).toBe(true);

    // Settled with nothing to show for it: the lifecycle surface takes over.
    view.rerender(props(openDraft));
    expect(view.result.current.opening).toBe(false);
    expect(openDraft).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a gesture: a refresh stays a read", () => {
    const { openDraft, view } = renderEntry();
    expect(openDraft).not.toHaveBeenCalled();
    expect(view.result.current.opening).toBe(false);
    expect(peekAuthoringDraftOnEntry(EXAM)).toBe(false);
  });

  it("waits for the read to answer instead of spending the gesture on loading", () => {
    requestAuthoringDraftOnEntry(EXAM);
    const { openDraft, view } = renderEntry({ state: LOADING });
    expect(openDraft).not.toHaveBeenCalled();
    expect(view.result.current.opening).toBe(false);

    view.rerender(props(openDraft));
    expect(openDraft).toHaveBeenCalledTimes(1);
    expect(view.result.current.opening).toBe(true);
  });

  it("leaves a READY exam alone and spends the gesture so it cannot fire later", () => {
    requestAuthoringDraftOnEntry(EXAM);
    const { openDraft, view } = renderEntry({ state: READY });
    expect(openDraft).not.toHaveBeenCalled();

    view.rerender(props(openDraft));
    expect(openDraft).not.toHaveBeenCalled();
  });

  it("never opens for a role that may not write", () => {
    requestAuthoringDraftOnEntry(EXAM);
    const { openDraft } = renderEntry({ canOpenDraft: false });
    expect(openDraft).not.toHaveBeenCalled();
  });

  it("stops showing progress once the open fails, so its error can speak", () => {
    requestAuthoringDraftOnEntry(EXAM);
    const { openDraft, view } = renderEntry();
    expect(view.result.current.opening).toBe(true);

    view.rerender(props(openDraft, { isFailed: true }));
    expect(view.result.current.opening).toBe(false);
  });

  it("issues one command per arrival, not one per render", () => {
    requestAuthoringDraftOnEntry(EXAM);
    const { openDraft, view } = renderEntry();

    view.rerender(props(openDraft, { isOpening: true }));
    view.rerender(props(openDraft));
    view.rerender(props(openDraft, { state: LOADING }));
    view.rerender(props(openDraft));

    expect(openDraft).toHaveBeenCalledTimes(1);
  });

  it("honours a gesture that arrives while the workspace is already mounted", () => {
    // The author goes back to the Exam Library and picks the SAME exam: the
    // mount does not change, so the arrival — not the mount — is what decides.
    const openDraft = vi.fn();
    function Harness() {
      const navigate = useNavigate();
      const { opening } = useDraftOpenOnEntry(props(openDraft));
      return (
        <>
          <button type="button" onClick={() => navigate(`/sat/exams/${EXAM}`)}>
            reenter
          </button>
          <span>{opening ? "opening" : "idle"}</span>
        </>
      );
    }

    render(
      <MemoryRouter initialEntries={[`/sat/exams/${EXAM}`]}>
        <Harness />
      </MemoryRouter>
    );
    expect(openDraft).not.toHaveBeenCalled();
    expect(screen.getByText("idle")).toBeInTheDocument();

    requestAuthoringDraftOnEntry(EXAM);
    fireEvent.click(screen.getByRole("button", { name: "reenter" }));

    expect(openDraft).toHaveBeenCalledTimes(1);
  });
});
