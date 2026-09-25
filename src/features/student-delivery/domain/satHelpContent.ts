/**
 * Help modal content (Phase 2). Static, bundled, no fetch.
 *
 * Copy exemption: entry titles/bodies live here (not SAT_COPY) so Help
 * ships as one content unit. Modal chrome (title, Close, Expand/Collapse)
 * comes from SAT_COPY.help. No string exists in both places.
 *
 * Contextual documentation embedded inside the exam: students are never
 * sent to an external site. Each entry names where the tool lives so Help
 * doubles as a tool locator. Opening Help never pauses the timer and never
 * touches answers.
 */

export interface SatHelpEntry {
  id: string;
  title: string;
  body: string;
  whereToFind: string;
}

export const SAT_HELP_ENTRIES: readonly SatHelpEntry[] = [
  {
    id: "zoom",
    title: "Zoom and Magnification",
    body: "Enlarge charts, graphs, and images to inspect detail, or adjust screen zoom to change the size of everything. Zoom changes only how the exam looks.",
    whereToFind: "Where to find it: select an image to enlarge it; Display settings adjust overall size.",
  },
  {
    id: "calculator",
    title: "In-App Calculator",
    body: "A Desmos graphing and scientific calculator is available in Math. It floats over the test so the question stays visible. Switch between Scientific and Graphing at the top of the panel.",
    whereToFind: "Where to find it: Calculator in the top bar during Math.",
  },
  {
    id: "timers",
    title: "Testing Timers",
    body: "The timer shows remaining module time. You can hide it to reduce pressure; it reappears automatically when 5 minutes remain. Hiding the timer never stops it.",
    whereToFind: "Where to find it: center of the top bar, Hide / Show.",
  },
  {
    id: "highlights",
    title: "Highlights & Notes",
    body: "Turn on Highlights & Notes, then select passage or question text to highlight it. Attach a note to any highlight to revisit your thinking. Highlights stay with the question when you navigate.",
    whereToFind: "Where to find it: Highlights & Notes in the top bar.",
  },
  {
    id: "lineReader",
    title: "Line Reader",
    body: "The line reader dims surrounding content so you can focus on one portion at a time. Drag the move handle, or focus it and use the arrow keys. Closing it changes only the display.",
    whereToFind: "Where to find it: More \u22ee Line Reader. Escape or \u00d7 closes it.",
  },
  {
    id: "eliminator",
    title: "Option Eliminator",
    body: "Cross out answers you have ruled out. Crossed-out choices stay in place so you keep context, and Undo restores any of them. Eliminating never selects or clears your answer.",
    whereToFind: "Where to find it: the crossed-out ABC icon at the right of the question header.",
  },
  {
    id: "mark",
    title: "Mark for Review",
    body: "Bookmark questions to revisit before submitting the module. Marked questions show a bookmark in the question menu and on the review page.",
    whereToFind: "Where to find it: beside the question number; review from the Question Menu.",
  },
];
