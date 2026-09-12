/**
 * SAT student-delivery controlled vocabulary (Phase 0 foundation).
 *
 * Single source of truth for user-visible exam copy. Every label, banner,
 * button, and announcement that the UX audit flagged as ambiguous lives here
 * so wording stays consistent across shell, review, transitions, and tools.
 *
 * Rules:
 * - Static strings are plain constants; parameterized strings are functions.
 * - Values are strings only — never HTML — so there is no injection seam.
 * - Components must reference these keys instead of hardcoding exam copy.
 * - Tests assert the table contract (stable keys, non-empty values, correct
 *   interpolation), not pixels.
 */

export const SAT_COPY = {
  displaySettings: {
    title: "Display",
    subtitle: "Only changes how the exam looks. Your answers are not affected.",
    close: "Close display settings",
    textSize: "Text size",
    textSizeHint: "Text only",
    screenZoom: "Screen zoom",
    screenZoomHint: "Everything",
    lineSpacing: "Line spacing",
    lineReader: "Line reader",
    contrast: "Contrast",
    contrastDefault: "Default",
    contrastHigh: "High contrast",
    reset: "Reset display settings",
    decreaseTextSize: "Decrease text size",
    increaseTextSize: "Increase text size",
    decreaseZoom: "Decrease screen zoom",
    increaseZoom: "Increase screen zoom",
  },
  questionNote: {
    title: "Question note",
    fieldLabel: "Note for this question",
    placeholder: "Add a note you can revisit in this module.",
    saveAndClose: "Save and close",
    close: "Close question note",
    autoSaveHint: "Notes save automatically for this module.",
    hasNote: "Has note",
    unavailableInMath: "Notes are not available in Math.",
  },
  noteOnSelection: {
    title: "Note on selected text",
    yourNote: "Your note",
    delete: "Delete this note",
    done: "Done",
  },
  flag: {
    flag: "Flag for later",
    flagged: "Flagged",
    turnOnEliminator: "Turn on cross-out mode",
    turnOffEliminator: "Turn off cross-out mode",
    eliminator: "Cross out",
    // Bluebook 2026 vocabulary (Phase 0 reservation; Phase 6 switches renderers over).
    markForReview: "Mark for Review",
    markedForReview: "Marked for Review",
    optionEliminator: "Option Eliminator",
  },
  navigation: {
    allQuestions: "All questions",
    previousQuestion: "Previous question",
    nextQuestion: "Next question",
    // Wave C R-15: canonical review-destination name (CTA-bare; the H1
    // at review.eyebrow keeps the pronoun per the CTA-bare/H1-pronoun rule).
    reviewAnswers: "Review answers",
    backToQuestions: "Back to questions",
    passage: "Passage",
    question: "Question",
    splitView: "Split view",
    passageOnly: "Passage only",
    questionOnly: "Question only",
  },
  review: {
    eyebrow: "Review your answers",
    unansweredNotice: "Some questions are still unanswered. You may still submit the module.",
    allAnswered: "Every question in this module has an answer.",
    keepChecking: "Keep checking",
    submitAnyway: "Submit anyway",
  },
  submit: {
    submitModule: "Submit module",
    submitting: "Submitting" + "\u2026",
    cannotReturn: "You cannot return to this module after submitting.",
    timeExpiredFinalizing: "Time expired \u2014 submitting your saved answers.",
    finalizingResponses: "Finalizing SAT responses" + "\u2026",
    almostUp: "Time almost up \u2014 answers save automatically.",
  },
  directions: {
    beginModule: "Begin module",
    timerBegins: "The timer begins when you start.",
    leaveExam: "Leave exam",
    starting: "Starting" + "\u2026",
    calculatorCleared: "Calculator cleared between modules.",
    leaveConfirmTitle: "Leave this exam?",
    // Wave C R-16c: destuttered — same two facts (saved = safe;
    // in-flight = at risk), no new term; title + buttons unchanged.
    leaveConfirmBody: "Answers you have already saved stay saved. Anything you are typing right now may not.",
    stayAndContinue: "Stay and continue",
    leaveForSure: "Leave without saving more",
  },
  transitions: {
    waitingForBreak: "Waiting for the break to start",
    onBreak: "On break",
    breakStartsAutomatically: "The break starts automatically. You do not need to do anything.",
    nextOpensAutomatically: "Your next section opens automatically when this ends.",
    stuckHelp: "If this reaches zero and nothing happens, wait 30 seconds then reload \u2014 answers are saved.",
    // Wave C R-11 decision (settles R-14 casing pair): H1s are NOT
    // declared sentence-case house-wide (directions H1 is the Title Case
    // section label; group headings are Title Case; only the review H1 keeps
    // sentence case as a deliberate CTA-bare/H1-pronoun exception) — so the
    // complete H1 reads as a Title Case fragment.
    completeTitle: "SAT Complete",
    completeSubtitle: "All responses submitted.",
    practiceScoreReady: "Your unofficial practice score is ready.",
    backToDashboard: "Back to dashboard",
  },
  timer: {
    hidden: "Timer hidden",
    reappearsHint: "Reappears at 5:00",
    hideTimer: "Hide timer",
    showTimer: "Show timer",
  },
  saveStatus: {
    saving: "Saving" + "\u2026",
    // Wave C R-16b: reassurance clause appended; retrying branch unchanged.
    offline: "Offline \u2014 answers kept on this device. Keep working; saving resumes automatically.",
    retrying: "Reconnecting \u2014 retrying save" + "\u2026",
    failed: "Save failed.",
    superseded: "Opened in another session \u2014 answers here are paused.",
    takeOver: "Take over",
    retryNow: "Retry now",
    retry: "Retry",
    // Persistent footer indicator (Phase 6f): lives next to the hand, never
    // a transient overlay. Short nouns — the banner carries the sentence.
    saved: "All answers saved",
    savingShort: "Saving answers",
    offlineShort: "Offline \u2014 kept on this device",
    failedShort: "Save needs attention",
  },
  submitReadiness: {
    waitingForSaves: "Waiting for answers to save" + "\u2026",
    offlineBlocked: "You are offline. Answers are kept on this device.",
    errorBlocked: "Saving needs attention before you can submit.",
  },
  annotations: {
    limitReached: "Note limit reached (200) for this question \u2014 remove one to add another.",
    highlightArmed: "Highlighting \u2014 select text.",
    // Mode strings kept for the sr-only armed status + interaction machine.
    // The top bar exposes separate Highlight and Question note entries; the
    // highlight armed indicator is silent (no visible bar).
    underlineArmed: "Underlining \u2014 select text.",
    noteArmed: "Note mode \u2014 select text to attach a note.",
    eraserArmed: "Eraser on \u2014 select a highlight to remove it.",
    done: "Done",
  },
  blocking: {
    pausedTitle: "Your timer is paused",
    pausedBody: "Paused by the proctor \u2014 answers safe.",
  },
  // Bluebook tool-parity vocabulary (Phase 0 reservation). Values are
  // user-visible strings, never HTML. Components must reference these keys.
  more: {
    trigger: "More",
    triggerLabel: "More tools",
    help: "Help",
    shortcuts: "Keyboard Shortcuts",
    shortcutsShort: "Shortcuts",
    lineReader: "Line Reader",
    unscheduledBreak: "Unscheduled Break",
  },
  help: {
    title: "Help",
    close: "Close help",
    closeButton: "Close",
    expandAll: "Expand All",
    collapseAll: "Collapse All",
  },
  shortcuts: {
    title: "Keyboard Shortcuts",
    close: "Close keyboard shortcuts",
    navigationHeading: "Navigation",
    toolsHeading: "Test Tools",
    displayHeading: "Display",
    nextQuestion: "Next Question",
    previousQuestion: "Previous Question",
    questionMenu: "Question Menu",
    markForReview: "Mark for Review",
    highlightsNotes: "Highlights & Notes",
    lineReader: "Line Reader",
    calculator: "Calculator",
    referenceSheet: "Reference Sheet",
    optionEliminator: "Option Eliminator",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    resetZoom: "Reset Zoom",
    footnote: "Shortcuts match your operating system. Each shortcut performs the same action as clicking the tool.",
    keyboardOptionalNote: "A keyboard is optional. Every shortcut has a matching on-screen control.",
  },
  unscheduledBreak: {
    confirmTitle: "Take an Unscheduled Break?",
    confirmBody: "Your testing time will continue while you're away.",
    cancel: "Cancel",
    // Wave C R-11/R-12: verb-led sentence-case CTA, distinct from the
    // confirm title; signals the consequence (clock starts/keeps running).
    takeBreak: "Start my break",
    veilTitle: "Unscheduled Break",
    veilBody: "Your timer is still running.",
    returnToTest: "Return to Test",
  },
  imageViewer: {
    title: "Image viewer",
    close: "Close image viewer",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetZoom: "Reset zoom",
    enlarge: "Click to enlarge",
  },
  timerWarning: {
    // Wave C R-11: Title Case alert-title fragment, no period
    // (alerts.md Content fragment rule; matches sibling alert titles).
    title: "5 Minutes Remaining",
    dismiss: "Dismiss timer warning",
    body: "5 minutes remain in this module. Your hidden timer is shown again.",
  },
} as const;

export type SatCopy = typeof SAT_COPY;

export function satSelectedTextLabel(quote: string): string {
  return "Selected text: " + quote;
}

export function satBackToQuestionLabel(questionNumber: number): string {
  return "Back to question " + questionNumber;
}

export function satSubmitConfirmTitle(moduleTitle: string): string {
  return "Submit " + moduleTitle + " answers?";
}

export function satSubmitConfirmSummary(unanswered: number, flagged: number): string {
  return unanswered + " unanswered \u00B7 " + flagged + " flagged";
}

export function satWaitingForSavesLabel(pendingCount: number): string {
  return pendingCount === 1
    ? "Waiting for 1 answer to save" + "\u2026"
    : "Waiting for " + pendingCount + " answers to save" + "\u2026";
}

export function satLastQuestionLabel(questionNumber: number, questionCount: number): string {
  return "Question " + questionNumber + " of " + questionCount + ", last question";
}

export function satContinueToDirectionsLabel(sectionTitle: string): string {
  return "Continue to " + sectionTitle + " directions";
}

export function satTimerRevealedAnnouncement(): string {
  return "Timer shown \u2014 under 5 minutes left. You can hide it again.";
}
