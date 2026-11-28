/**
 * Page geometry of the server render: A4 landscape, 10 mm margins, so the
 * content box is 277 × 190 mm = 1047 × 718 CSS px. The renderer's viewport
 * is the same box, so layout measured here is the printed layout.
 */
export const PAPER_PAGE_HEIGHT_PX = 718;
const BASE_FIT = 0.75;
/** Below this a question is unreadable; it may take a second page instead. */
export const MIN_FIT = 0.45;
/**
 * An explanation may pull the plane a little past that floor. Every reviewed
 * question on the paper carries one, so refusing the last few percent would
 * cost a whole extra sheet per figure question.
 */
const EXPLANATION_FIT_FLOOR = 0.41;
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
 *
 * A saved explanation sits in the row directly after its question and prints on
 * the same sheet. Its height does not move while the exam plane shrinks — the
 * explanation keeps its own width and type size — so it is reserved once and
 * the question is fitted into what is left. Fitting the question to the whole
 * page instead left no room for the explanation, so every reviewed question
 * ended up with its explanation alone on the next sheet.
 *
 * When the pair cannot share a sheet even at MIN_FIT the question takes the
 * full page again and the explanation continues overleaf under its own heading,
 * which is why that row is marked rather than silently split.
 *
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
      const sibling = row.nextElementSibling;
      const explanation = sibling?.classList.contains("sat-paper-explanation-row") ? sibling : null;
      const reserved = height(explanation);
      const fitTo = (target: number, floor = MIN_FIT) => {
        let fit = BASE_FIT;
        frame.style.setProperty("--sat-paper-fit", String(fit));
        for (let pass = 0; pass < MAX_PASSES && fit > floor; pass += 1) {
          const rowHeight = height(row);
          if (rowHeight <= target) break;
          fit = Math.max(floor, fit * (target / rowHeight));
          frame.style.setProperty("--sat-paper-fit", fit.toFixed(4));
        }
        return height(row);
      };

      let rowHeight = fitTo(available - reserved, reserved > 0 ? EXPLANATION_FIT_FLOOR : MIN_FIT);
      const sharesSheet = reserved === 0 || rowHeight + reserved <= available;
      if (!sharesSheet) {
        // Reserving the explanation cost the question its legibility without
        // buying a shared sheet, so give the full page back and continue the
        // explanation overleaf.
        rowHeight = fitTo(available);
      }
      if (rowHeight > available) overflowing += 1;
      explanation?.toggleAttribute("data-continued", !sharesSheet && reserved > 0);
    }
  }
  return overflowing;
}
