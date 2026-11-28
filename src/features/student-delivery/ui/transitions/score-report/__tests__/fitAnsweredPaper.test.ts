import { beforeEach, describe, expect, it } from "vitest";
import { fitAnsweredPaper, PAPER_PAGE_HEIGHT_PX } from "../fitAnsweredPaper";

const THEAD = 40;
const TFOOT = 120;
const AVAILABLE = (PAPER_PAGE_HEIGHT_PX - THEAD - TFOOT) * 0.97;

function rect(height: number): () => DOMRect {
  return () => ({ height } as DOMRect);
}

type Fixture = {
  questionHeight: number;
  explanationHeight?: number;
  continued?: boolean;
};

function build({ questionHeight, explanationHeight, continued = false }: Fixture) {
  const paper = document.createElement("div");
  paper.innerHTML = `
    <table class="sat-paper-review">
      <thead><tr><th>runhead</th></tr></thead>
      <tbody>
        <tr class="sat-paper-question-row"><td><div class="sat-paper-exam-frame"></div></td></tr>
        ${
          explanationHeight === undefined
            ? ""
            : `<tr class="sat-paper-explanation-row"${continued ? " data-continued" : ""}><td>explanation</td></tr>`
        }
      </tbody>
      <tfoot><tr><td>legal</td></tr></tfoot>
    </table>`;
  document.body.append(paper);

  const table = paper.querySelector<HTMLElement>(".sat-paper-review")!;
  const row = paper.querySelector<HTMLElement>(".sat-paper-question-row")!;
  const frame = row.querySelector<HTMLElement>(".sat-paper-exam-frame")!;
  const explanation = paper.querySelector<HTMLElement>(".sat-paper-explanation-row");

  Object.defineProperty(table.querySelector("thead"), "getBoundingClientRect", { value: rect(THEAD) });
  Object.defineProperty(table.querySelector("tfoot"), "getBoundingClientRect", { value: rect(TFOOT) });
  if (explanation) {
    Object.defineProperty(explanation, "getBoundingClientRect", { value: rect(explanationHeight!) });
  }
  // The plane shrinks linearly here; the real reflow is not linear, which is
  // why the implementation measures between passes. The loop only needs a
  // height that responds to the zoom it just wrote.
  Object.defineProperty(row, "getBoundingClientRect", {
    value: () => {
      const fit = Number(frame.style.getPropertyValue("--sat-paper-fit") || "0.75");
      return { height: questionHeight * fit } as DOMRect;
    },
  });
  return { paper, row, frame, explanation };
}

describe("fitAnsweredPaper", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("fits a question without an explanation to the whole page", () => {
    const { paper, frame } = build({ questionHeight: 700 });

    expect(fitAnsweredPaper(paper)).toBe(0);
    expect(Number(frame.style.getPropertyValue("--sat-paper-fit"))).toBeCloseTo(0.75, 3);
  });

  it("reserves the explanation so both share one sheet", () => {
    const { paper, row, frame, explanation } = build({ questionHeight: 700, explanationHeight: 80 });

    expect(fitAnsweredPaper(paper)).toBe(0);

    const question = row.getBoundingClientRect().height;
    expect(question + 80).toBeLessThanOrEqual(AVAILABLE);
    // The question gives up size for the explanation, and nothing is moved.
    expect(Number(frame.style.getPropertyValue("--sat-paper-fit"))).toBeLessThan(0.75);
    expect(explanation!.hasAttribute("data-continued")).toBe(false);
  });

  it("gives the full page back when the pair cannot share it", () => {
    const { paper, row, frame, explanation } = build({ questionHeight: 700, explanationHeight: 600 });

    expect(fitAnsweredPaper(paper)).toBe(0);

    // The explanation continues overleaf, so the question keeps its legibility
    // instead of shrinking for room that was never usable.
    expect(Number(frame.style.getPropertyValue("--sat-paper-fit"))).toBeCloseTo(0.75, 3);
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(AVAILABLE);
    expect(explanation!.hasAttribute("data-continued")).toBe(true);
  });

  it("clears a stale continuation mark when the pair now fits", () => {
    const { paper, explanation } = build({ questionHeight: 700, explanationHeight: 80, continued: true });

    fitAnsweredPaper(paper);

    expect(explanation!.hasAttribute("data-continued")).toBe(false);
  });

  it("reports a question that needs more than one page even at the floor", () => {
    const { paper } = build({ questionHeight: 4_000 });

    expect(fitAnsweredPaper(paper)).toBe(1);
  });
});
