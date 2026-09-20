import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSatExamFitZoom, type SatExamFitZoomInput } from "../useSatExamFitZoom";
import type { SatExamFitPane } from "../../domain/satExamFit";
import type { SatExamFitProbe } from "../../ui/reading/satExamFitProbe";

const FITS: readonly SatExamFitPane[] = [{ scrollHeight: 600, clientHeight: 900 }];
const OVERFLOWS: readonly SatExamFitPane[] = [{ scrollHeight: 1400, clientHeight: 900 }];

/**
 * Renders a question through the hook with a fake probe, so the walk can be
 * followed without a layout engine.
 *
 * `appliedZoom` is what makes the fake honest: it records the zoom the hook
 * actually rendered, and the probe answers for that value — the same contract
 * the DOM probe has. A fit that measured a candidate it never rendered would
 * still pass a test that assumed the zoom, so this one does not assume.
 */
function harness(options: {
  layout: Map<number, readonly SatExamFitPane[]>;
  input?: Partial<Omit<SatExamFitZoomInput, "contentRef" | "probe">>;
}) {
  const probed: number[] = [];
  let appliedZoom = 1;
  const onDecide = vi.fn();
  const probe: SatExamFitProbe = {
    readPanes: () => {
      probed.push(appliedZoom);
      return options.layout.get(appliedZoom) ?? [];
    },
  };

  const rendered = renderHook(() => {
    const contentRef = useRef<HTMLElement | null>(null);
    const fit = useSatExamFitZoom({
      enabled: true,
      zoomDecided: false,
      storedZoom: null,
      compact: false,
      blocked: false,
      onDecide,
      ...options.input,
      contentRef,
      probe,
    });
    appliedZoom = fit.zoom ?? 1;
    return fit;
  });

  return { ...rendered, onDecide, probed, applied: () => appliedZoom };
}

describe("useSatExamFitZoom", () => {
  it("decides the resting point when the question already fits, writing nothing", () => {
    const { onDecide, probed, result } = harness({ layout: new Map([[1, FITS]]) });

    expect(probed).toEqual([1]);
    expect(result.current.zoom).toBeNull();
    expect(result.current.probing).toBe(false);
    // The decision is still reported: "nothing needs to change" is an answer,
    // and the attempt has to remember that it was given — otherwise the next
    // module, a fresh mount of the same attempt, would decide all over again.
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(null);
  });

  it("commits one step down when only the smaller rendering fits", () => {
    const { onDecide, probed, result } = harness({
      layout: new Map([
        [1, OVERFLOWS],
        [0.75, FITS],
      ]),
    });

    expect(probed).toEqual([1, 0.75]);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(0.75);
    expect(result.current.zoom).toBeNull();
    expect(result.current.probing).toBe(false);
  });

  it("stops at the floor when no candidate fits", () => {
    const { onDecide, probed } = harness({
      layout: new Map([
        [1, OVERFLOWS],
        [0.75, OVERFLOWS],
        [0.5, OVERFLOWS],
      ]),
    });

    expect(probed).toEqual([1, 0.75, 0.5]);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(0.5);
  });

  it("runs once per mount, however the exam re-renders", () => {
    const { onDecide, probed, rerender } = harness({
      layout: new Map([
        [1, OVERFLOWS],
        [0.75, FITS],
      ]),
    });

    rerender();
    rerender();

    expect(probed).toEqual([1, 0.75]);
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it("never runs over a zoom the attempt already carries", () => {
    const { onDecide, probed, applied, result } = harness({
      layout: new Map([[1, OVERFLOWS]]),
      input: { storedZoom: 0.75 },
    });

    expect(probed).toEqual([]);
    expect(onDecide).not.toHaveBeenCalled();
    expect(result.current.zoom).toBeNull();
    expect(applied()).toBe(1);
  });

  it("reads an explicit 100% as a zoom the student chose", () => {
    const { probed } = harness({
      layout: new Map([[1, OVERFLOWS]]),
      input: { storedZoom: 1 },
    });

    expect(probed).toEqual([]);
  });

  it("does not decide an attempt that already decided", () => {
    // The next module of an attempt whose first module needed no shrink.
    const { onDecide, probed } = harness({
      layout: new Map([[1, OVERFLOWS]]),
      input: { zoomDecided: true },
    });

    expect(probed).toEqual([]);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("never shrinks a compact layout, a blocked exam, or an unrequested fit", () => {
    for (const input of [
      { compact: true },
      { blocked: true },
      { enabled: false },
    ] as const) {
      const { onDecide, probed } = harness({ layout: new Map([[1, OVERFLOWS]]), input });
      expect(probed, JSON.stringify(input)).toEqual([]);
      expect(onDecide, JSON.stringify(input)).not.toHaveBeenCalled();
    }
  });

  it("gives up without deciding when there is nothing to measure", () => {
    const { onDecide, probed, result } = harness({ layout: new Map() });

    expect(probed).toEqual([1]);
    // A pane the fit cannot read is not an overflow, so the walk ends without
    // inventing anything: no zoom is rendered, nothing is written, and the
    // attempt stays free to fit when the panes exist.
    expect(onDecide).not.toHaveBeenCalled();
    expect(result.current.zoom).toBeNull();
  });

  it("fits on request even when the attempt already carries a zoom", () => {
    const { onDecide, probed, result } = harness({
      layout: new Map([
        [1, OVERFLOWS],
        [0.75, FITS],
      ]),
      input: { storedZoom: 0.75 },
    });

    act(() => {
      result.current.fitNow();
    });

    expect(probed).toEqual([1, 0.75]);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(0.75);
  });

  it("reports the resting point when the student asks for a fit that needs none", () => {
    const { onDecide, result } = harness({ layout: new Map([[1, FITS]]) });

    act(() => {
      result.current.fitNow();
    });

    // Two decisions, both real: opening the exam decided that nothing needed to
    // change, and the explicit request decided the zoom the student asked for.
    // "Fit to screen" landing on 100% is an answer, not a no-op.
    expect(onDecide.mock.calls).toEqual([[null], [1]]);
  });
});
