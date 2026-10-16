/**
 * Page geometry of the server render: A4 landscape, 10 mm margins, so the
 * content box is 277 × 190 mm = 1047 × 718 CSS px. The renderer's viewport
 * is the same box, so layout measured here is the printed layout.
 */
export const PAPER_PAGE_HEIGHT_PX = 718;
const BASE_FIT = 0.75;
/** Below this a question is unreadable; it may take a second page instead. */
export const MIN_FIT = 0.45;
/** Room for sub-pixel rounding between layout and the PDF. */
const SAFETY = 0.97;
const MAX_PASSES = 6;

function height(element: Element | null): number {
  return element ? element.getBoundingClientRect().height : 0;
}

/**
 * Shrinks each review question's exam plane until the question fits the page
 * under its repeating runhead and legal footer. Text reflows as the plane
 * narrows, so height is not linear in the zoom: measure, shrink, repeat.
 * Returns how many questions still need more than one page at MIN_FIT.
 */
export function fitAnsweredPaper(paper: HTMLElement): number {
  let overflowing = 0;
  for (const table of paper.querySelectorAll<HTMLElement>(".sat-paper-review")) {
    const available =
      (PAPER_PAGE_HEIGHT_PX - height(table.querySelector(":scope > thead")) - height(table.querySelector(":scope > tfoot"))) * SAFETY;
    for (const row of table.querySelectorAll<HTMLElement>(".sat-paper-question-row")) {
      const frame = row.querySelector<HTMLElement>(".sat-paper-exam-frame");
      if (!frame) continue;
      let fit = BASE_FIT;
      frame.style.setProperty("--sat-paper-fit", String(fit));
      for (let pass = 0; pass < MAX_PASSES && fit > MIN_FIT; pass += 1) {
        const rowHeight = height(row);
        if (rowHeight <= available) break;
        fit = Math.max(MIN_FIT, fit * (available / rowHeight));
        frame.style.setProperty("--sat-paper-fit", fit.toFixed(4));
      }
      if (height(row) > available) overflowing += 1;
    }
  }
  return overflowing;
}
