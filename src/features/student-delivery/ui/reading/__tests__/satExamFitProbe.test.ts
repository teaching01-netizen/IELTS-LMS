import { describe, expect, it } from "vitest";
import { createSatExamFitProbe } from "../satExamFitProbe";

/**
 * The probe's whole job is to hand the domain real numbers or nothing at all.
 * jsdom lays nothing out, so the heights are stubbed here — which is also the
 * point of the port: a pane that reports no number must be dropped rather than
 * passed on as a zero-height pane, because a fabricated 0 is an overflow.
 */
function pane(attributes: Record<string, string>, scrollHeight: number, clientHeight: number) {
  const element = document.createElement("section");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
  return element;
}

function rootWith(...panes: HTMLElement[]): HTMLElement {
  const root = document.createElement("div");
  for (const element of panes) root.appendChild(element);
  return root;
}

describe("createSatExamFitProbe", () => {
  const probe = createSatExamFitProbe();

  it("reads both panes that can force a scroll", () => {
    const root = rootWith(
      pane({ "data-sat-passage-scroll": "true" }, 1400, 900),
      pane({ "data-sat-question-scroll": "true" }, 600, 900),
    );
    expect(probe.readPanes(root)).toEqual([
      { scrollHeight: 1400, clientHeight: 900 },
      { scrollHeight: 600, clientHeight: 900 },
    ]);
  });

  it("ignores a pane that is not part of the layout", () => {
    const root = rootWith(
      pane({ "data-sat-question-scroll": "true" }, 600, 900),
      document.createElement("section"),
    );
    expect(probe.readPanes(root)).toEqual([{ scrollHeight: 600, clientHeight: 900 }]);
  });

  it("reads nothing from a shell that is not there yet", () => {
    expect(probe.readPanes(null)).toEqual([]);
    expect(probe.readPanes(rootWith())).toEqual([]);
  });

  it("leaves a pane that reports no number out instead of calling it empty", () => {
    const unreadable = document.createElement("section");
    unreadable.setAttribute("data-sat-question-scroll", "true");
    Object.defineProperty(unreadable, "scrollHeight", {
      get: () => undefined,
      configurable: true,
    });
    expect(probe.readPanes(rootWith(unreadable))).toEqual([]);
  });
});
