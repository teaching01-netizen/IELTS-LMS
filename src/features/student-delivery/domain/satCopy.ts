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

import {
  EXAM_VISIBILITY_WARNING_ACKNOWLEDGE,
  EXAM_VISIBILITY_WARNING_MESSAGE,
  EXAM_VISIBILITY_WARNING_TITLE,
} from "@student/api/examVisibilityIntegrity";

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
    // The question's own note has no highlighted source to quote, so this is the
    // only note that needs a name at all — and it is spoken rather than drawn:
    // the pane's shape already says which note hangs off a passage phrase.
    questionSource: "This question",
    placeholder: "Write a note\u2026",
    // The two halves of autosave feedback, and only ever one of them at a time:
    // "Saving" while a draft is still waiting on the idle pause, "Saved" for a
    // moment once it lands. At rest the field says nothing, which is the point.
    saving: "Saving" + "\u2026",
    saved: "Saved",
    // A note's secondary actions, behind one neutral control: the destructive
    // verb is disclosed, never parked beside the student's writing.
    noteActions: "Note actions",
    deleteNote: "Delete note",
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
    // A Student Link may admit only one section. That sitting has a section
    // score (200\u2013800) and deliberately NO total \u2014 the 400\u20131600 scale is
    // defined over both sections \u2014 so the completion screen names the section
    // instead of leaving the score area blank.
    sectionScoreHeading: "Section score",
    sectionScoreOnlyNote:
      "This link covered one section, so there is no total score. This is your unofficial practice result for that section.",
    sectionLabelReadingWriting: "Reading and Writing",
    sectionLabelMath: "Math",
  },
  timer: {
    hidden: "Timer hidden",
    reappearsHint: "Reappears at 5:00",
    hideTimer: "Hide timer",
    showTimer: "Show timer",
  },
  // Failure-only save copy. Healthy saving is never narrated: there is no
  // "Saving…"/"Saved"/offline string because the exam no longer shows them.
  // What remains is what asks the student to do something.
  saveStatus: {
    failed: "Save failed.",
    superseded: "Opened in another session \u2014 answers here are paused.",
    takeOver: "Take over",
    retryNow: "Retry now",
    retry: "Retry",
  },
  submitReadiness: {
    offlineBlocked: "You are offline. Answers are kept on this device.",
    errorBlocked: "Saving needs attention before you can submit.",
  },
  // Highlights & Notes (self-teaching pass). Every control carries a written
  // label: the feature is meant to be understood by using it, with no tutorial
  // to read, so "Add note" always appears next to the note glyph.
  annotations: {
    limitReached: "Note limit reached (200) for this question \u2014 remove one to add another.",
    // The top-bar entry that ARMS annotation. Never dynamically shortened: an
    // icon-only entry would have to be decoded, and decoding is what this pass
    // removes. Its pressed state is the mode, so the label never changes with
    // it — the control is still the same control, and renaming it on toggle
    // would make a student re-find it every time.
    toolLabel: "Highlights & Notes",
    // The disclosure beside it, which is the only thing that opens the Notes
    // column. Named for the destination, never for the mode: the two controls
    // must never be mistakable for each other, in speech or on screen.
    notesTool: "Notes",
    notesToolHasHighlights: "Notes, has highlights",
    // Action affordance names shared by the selection toolbar and a mark's own
    // edit controls — the same surface in two states.
    highlight: "Highlight",
    underline: "Underline",
    selectedTextActions: "Selected text actions",
    editAnnotation: "Edit annotation",
    // The visible way out of either popover. Esc, a click outside, and a new
    // selection all dismiss it too, but a panel that can only be dismissed by a
    // gesture the student has to guess is a panel they will try to avoid.
    closeTools: "Close text tools",
    // The activation cue: one quiet line at the top of the passage, shown when
    // the student arms annotation, until they annotate something. It answers
    // "what did I just turn on?" where the answer applies — over the text that
    // is now selectable — instead of pointing back at the control.
    activationCue: "Highlighting on \u2014 select text to highlight or add a note",
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
  // Exam-screen integrity (one shared rule across IELTS, ACT, and SAT). The SAT
  // surfaces reference the same canonical strings the IELTS warning uses: one
  // delivery rule must not produce two different sentences for the student.
  // The browser only establishes that the exam document became hidden, so the
  // copy names that fact and never claims to know what the student opened.
  integrity: {
    visibilityTitle: EXAM_VISIBILITY_WARNING_TITLE,
    visibilityBody: EXAM_VISIBILITY_WARNING_MESSAGE,
    visibilityContinue: EXAM_VISIBILITY_WARNING_ACKNOWLEDGE,
    // Spoken name for the hold itself; the visible copy is the body above.
    visibilityHoldLabel: "Exam screen integrity warning",
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
  // Figure inspection (Bluebook two-layer model). No "click to enlarge" any
  // more: the strip above the figure *is* the affordance, and Full screen is the
  // escalation of the view the student already has, not the only way in.
  imageViewer: {
    title: "Image viewer",
    // The strip's own spoken name, before the figure it belongs to: several
    // figures in one question must not become indistinguishable in speech.
    controls: "Figure controls",
    // Names the percentage readout, which is otherwise a bare number.
    zoomLevel: "Zoom level",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetZoom: "Reset zoom",
    // The drawn word stays short; the spoken name carries the verb, because an
    // icon-plus-word control should still say what pressing it will do. The
    // visible text is a substring of the spoken name, so the two never disagree.
    fullScreen: "Full screen",
    enterFullScreen: "Enter full screen",
    exitFullScreen: "Exit full screen",
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
 * A highlighted excerpt, normalized and capped, for the places that have to name
 * it in speech.
 *
 * The Notes column shows the excerpt itself, in semibold type, with no quotes and
 * no label — but a screen reader cannot hear typography, and several notes in one
 * pane need to be told apart. The quotes that would be noise on screen are what
 * mark the boundary of the excerpt when it is spoken, and the cap keeps a whole
 * paragraph from becoming a control's name.
 */
function satExcerptLabel(excerpt: string, max = 60): string {
  const normalized = excerpt.replace(/\s+/g, " ").trim();
  const capped =
    normalized.length > max ? normalized.slice(0, max).trimEnd() + "\u2026" : normalized;
  return "\u201C" + capped + "\u201D";
}

/**
 * The spoken name of a note's own field, e.g. `Note on \u201CSeveral\u201D`.
 *
 * Every card in the pane carries a live field now, so "Notes" can no longer name
 * them all: a student tabbing through the column has to hear which note each
 * field belongs to, and which excerpt it is about.
 */
export function satNoteFieldLabel(excerpt: string): string {
  return "Note on " + satExcerptLabel(excerpt);
}

/** The spoken name of a note's secondary actions, scoped to its own excerpt. */
export function satNoteActionsLabel(excerpt: string): string {
  return SAT_COPY.notes.noteActions + " for " + satExcerptLabel(excerpt);
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
 * The Notes disclosure's name, spoken and written.
 *
 * Always begins with "Notes" so the control that opens the column is one
 * predictable thing in speech, whatever it currently holds; the suffix reports
 * content ("2 notes") or, when there is ink but no writing, that there is
 * something of the student's to look at ("has highlights").
 */
export function satNotesToolLabel(input: { count: number; hasHighlights: boolean }): string {
  if (input.count > 0) return SAT_COPY.annotations.notesTool + ", " + satNotesCountLabel(input.count);
  if (input.hasHighlights) return SAT_COPY.annotations.notesToolHasHighlights;
  return SAT_COPY.annotations.notesTool;
}

/**
 * Announced (never displayed) after a highlight lands, so assistive tech hears
 * the same cause-and-effect the ink shows sighted students.
 * `colorLabel` is the swatch's written name, e.g. "yellow".
 */
export function satHighlightedAnnouncement(colorLabel: string): string {
  return "Text highlighted " + colorLabel + ".";
}

/**
 * The strip's spoken name, e.g. `Figure controls: Graph of f`.
 *
 * The label names the *thing being commanded* rather than repeating the control
 * names: a student tabbing between two figures needs to hear which graph they
 * just zoomed, and "Zoom in" alone would be identical for both.
 */
export function satImageControlsLabel(label: string): string {
  return SAT_COPY.imageViewer.controls + ": " + label;
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

export function satLastQuestionLabel(questionNumber: number, questionCount: number): string {
  return "Question " + questionNumber + " of " + questionCount + ", last question";
}

export function satContinueToDirectionsLabel(sectionTitle: string): string {
  return "Continue to " + sectionTitle + " directions";
}

export function satTimerRevealedAnnouncement(): string {
  return "Timer shown \u2014 under 5 minutes left. You can hide it again.";
}
