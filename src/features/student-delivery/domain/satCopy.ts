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
  // One concept, one destination: the student's notes for this question. Notes
  // anchored to selected passage text and the freeform note about the question
  // itself live in the same column and the same list, because a student does not
  // experience two note systems — the earlier split only made them ask which was
  // which. Anchored notes quote their source; the question's own note says so.
  notes: {
    title: "Notes",
    // The column is a pane, not an alert: hiding it is one press away from
    // bringing it back, so the control says "Hide" rather than "Close" —
    // "Close" promises an end to something that has not ended.
    collapse: "Hide notes",
    // The handle a hidden column leaves behind. Its written label is `title`
    // itself — the handle IS the pane's tab, and a pane does not need a second
    // name to be found again. The spoken name adds the action, which the tab's
    // identity does not carry on its own.
    railAction: "Show notes",
    questionSource: "This question",
    placeholder: "Add a quick note\u2026",
    // Quiet, transient confirmation that there is no Save button to press.
    saved: "Saved",
    remove: "Remove note",
    // Shown in the same undo toast that already forgives a removed mark: the ink
    // stays, only the words go, and they can come back for a few seconds.
    removed: "Note removed",
    // Shown only when there is nothing to read AND nothing being written, so it
    // can never sit beside an open editor contradicting itself. Two lines in
    // that order — what the column is, then how to fill it — because one sentence
    // inside a dashed box read like a web form rather than an exam aid, and a
    // student who has never noted anything needs both halves.
    emptyTitle: "No notes yet",
    empty: "Select text in the passage, then choose Add note.",
    // The empty state's aside when the question carries marks but no notes, so a
    // student who only highlighted is not left wondering where their highlights
    // went — and without a second list to check.
    emptyWithHighlights: "Your highlights are marked in the passage.",
    // The question's own note, demoted to a quiet text button under the list.
    // Notes on selected text are the pattern; this one exists for a student with
    // nothing selected, and it used to compete with them as a full-width row.
    addQuestionNote: "Add question note",
    // Autosave reassurance, shown while a field is open and retired once the
    // first save it announces has been seen: a promise made once and then
    // trusted, rather than a permanent banner repeating itself.
    saveHelper: "Notes save automatically.",
    // On the hide control at widths where notes take the question's place, so
    // hiding says what it actually does.
    collapseAndShowQuestion: "Hide notes and show the question",
    unavailableInMath: "Notes are not available in Math.",
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
    // Phase 4 (kill the silent 0:00): auto-entry owns the primary path, so the
    // screen says the module is opening and the button is recovery-only.
    startingModule: "Starting your module" + "…",
    autoEntryNotice:
      "Your module opens automatically. If it does not, this button becomes available.",
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
    // Phase 4: the break countdown can legitimately read 0:00 while the server
    // finishes the section advance, so the surface names the entry progress
    // rather than freezing there with no explanation.
    startingNextSection: "Starting your next section",
    startingNextSectionBody:
      "You do not need to do anything. This screen continues on its own.",
    retryingNextSection: "Still opening your next section",
    retryingNextSectionBody:
      "Your answers are safe. Keep this screen open and it continues automatically.",
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
  // Highlights & Notes (self-teaching pass). Every control carries a written
  // label: the feature is meant to be understood by using it, with no tutorial
  // to read, so "Add note" always appears next to the note glyph.
  annotations: {
    limitReached: "Note limit reached (200) for this question \u2014 remove one to add another.",
    // One labeled top-bar entry. Never dynamically shortened: an icon-only
    // entry would have to be decoded, and decoding is what this pass removes.
    toolLabel: "Highlights & Notes",
    toolLabelHasAnnotations: "Highlights & Notes, has annotations",
    // Action affordance names shared by the toolbar, dock, and edit dock.
    highlight: "Highlight",
    underline: "Underline",
    selectedTextActions: "Selected text actions",
    editAnnotation: "Edit annotation",
    // The visible way out of either popover. Esc, a click outside, and a new
    // selection all dismiss it too, but a panel that can only be dismissed by a
    // gesture the student has to guess is a panel they will try to avoid.
    closeTools: "Close text tools",
    // Passive first-use hint: one quiet line at the top of the passage, shown
    // once per attempt, dismissed by the first selection (or the first answer).
    // It teaches where the gesture belongs instead of pointing at the tool.
    passageHint: "Select text to highlight or add a note",
    removedHighlight: "Highlight removed",
    removedUnderline: "Underline removed",
    undo: "Undo",
    addNote: "Add note",
    editNote: "Edit note",
    removeHighlight: "Remove highlight",
    removeUnderline: "Remove underline",
    // Polite announcements (never rendered visually).
    underlinedAnnouncement: "Text underlined.",
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

/**
 * A note's source, quoted the way the Notes column shows it.
 *
 * The old label read "Selected text: …", which is system language for something
 * the student did themselves a moment ago. A quoted snippet needs no preface:
 * the quotes say "this is the text you marked".
 */
export function satQuotedSource(quote: string): string {
  return "\u201C" + quote + "\u201D";
}

/**
 * The count beside the Notes heading, e.g. "3 notes".
 *
 * Rendered only when there is at least one note, so the heading stays a plain
 * word in the common case and becomes a summary once there is a list to scan.
 */
export function satNotesCountLabel(count: number): string {
  return count === 1 ? "1 note" : count + " notes";
}

/**
 * Announced (never displayed) after a highlight lands, so assistive tech hears
 * the same cause-and-effect the ink shows sighted students.
 * `colorLabel` is the swatch's written name, e.g. "yellow".
 */
export function satHighlightedAnnouncement(colorLabel: string): string {
  return "Text highlighted " + colorLabel + ".";
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
