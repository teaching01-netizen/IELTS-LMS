import { useMemo, useState } from "react";
import { useStudentExamPageLock } from "@components/student/layout/useStudentExamPageLock";
import { useStudentExamViewport } from "@components/student/layout/useStudentExamViewport";
import { useStudentFocusedControlVisibility } from "@components/student/layout/useStudentFocusedControlVisibility";
import type { DeliveredQuestion } from "../../../features/student-delivery/contracts/assessmentDelivery";
import type { SatQuestionResponseDraft } from "../../../features/student-delivery/domain/satResponses";
import { useSatReadingPreferences } from "../../../features/student-delivery/hooks/useSatReadingPreferences";
import { SatExamShell } from "../../../features/student-delivery/ui/SatExamShell";
import { SatQuestionRenderer } from "../../../features/student-delivery/ui/question/SatQuestionRenderer";
import { SatBlockingOverlay } from "../../../features/student-delivery/ui/feedback/SatControlFeedback";
import { SatCalculatorHost } from "../../../features/student-delivery/ui/tools/SatCalculatorHost";
import { SatReferenceSheetPanel } from "../../../features/student-delivery/ui/tools/SatReferenceSheetPanel";
import { StudentExamInteractionScopeProvider } from "../../../shared/ui/touch-selection/StudentExamInteractionScope";

const paragraph = (id: string, text: string) => ({
  version: 1 as const,
  nodes: [{ type: "paragraph" as const, id, text }],
});

const readingQuestion: DeliveredQuestion = {
  examQuestionId: "debug-q1",
  questionId: "debug-question",
  displayOrder: 0,
  isPretest: false,
  questionType: "single_choice",
  stimulus: paragraph(
    "stimulus",
    "Several researchers examined how urban tree cover changes surface temperature during periods of extreme heat. Their results suggest that the relationship depends on both canopy density and the surrounding built environment."
  ),
  prompt: paragraph("prompt", "Which choice best states the main idea of the text?"),
  answer: {
    kind: "single_choice",
    options: [
      {
        id: "a",
        content: paragraph(
          "a",
          "Tree cover can affect heat differently depending on local conditions."
        ),
      },
      {
        id: "b",
        content: paragraph(
          "b",
          "All cities experience identical temperature changes from tree cover."
        ),
      },
      {
        id: "c",
        content: paragraph("c", "Built environments have no relationship to urban temperature."),
      },
      {
        id: "d",
        content: paragraph("d", "Researchers no longer study the effects of extreme heat."),
      },
    ],
  },
  metadata: {
    sectionKey: "reading-writing",
    domain: "Information and Ideas",
    skill: "Central Ideas and Details",
    difficulty: "medium",
    tags: [],
  },
  accessibility: { longDescription: null },
};

/**
 * The same passage at the length of a real one.
 *
 * The default stimulus above is deliberately a few lines, because most of the
 * accessibility suite measures surfaces around a short passage and its assertions
 * are about those surfaces. A passage that is longer than its pane is what makes
 * a student scroll, though, and the placement rule has a case that only a scroll
 * can reach — so it is opt-in (`?long=1`), and nothing that does not ask for it
 * changes shape. A real SAT passage is this long, which is also why the opt-in is
 * the only way to see the whole-pane behaviour at all.
 */
const longStimulus = paragraph(
  "stimulus",
  "Several researchers examined how urban tree cover changes surface temperature during periods of extreme heat. Their results suggest that the relationship depends on both canopy density and the surrounding built environment. Follow-up measurements taken across four summers found that the cooling effect weakens as the proportion of paved surface rises, though the pattern varied between neighbourhoods. Sites with mature trees and irrigated ground stayed measurably cooler at midday, while sites dominated by asphalt and bare soil recorded little difference from unshaded ground. The authors caution that their sample covered a limited range of climates, and that local wind patterns may explain part of the variation they observed. They conclude that planting programmes should be planned alongside decisions about paving, drainage and shade, rather than treated as a single remedy for rising urban temperatures."
);

const longReadingQuestion: DeliveredQuestion = { ...readingQuestion, stimulus: longStimulus };

/**
 * A passage no pane can hold, for the cases that need a pane in overflow
 * whatever the viewport is (`?long=2`).
 *
 * Auto-fit is verified by walking it down to a smaller zoom and checking that
 * the scrolling stops, so the harness needs an input that scrolls first —
 * the realistic passage above fits a 1920x1080 pane at 100% and would prove
 * nothing there.
 */
const oversizedStimulus = paragraph(
  "stimulus",
  [longStimulus.nodes[0]!.text, longStimulus.nodes[0]!.text, longStimulus.nodes[0]!.text].join(" ")
);

const oversizedReadingQuestion: DeliveredQuestion = { ...readingQuestion, stimulus: oversizedStimulus };

/**
 * A prompt no pane can hold, in the same v1 paragraph shape as the passage ones.
 *
 * The passage fixtures above lengthen the STIMULUS, so the question pane still
 * fits whatever viewport they are opened on — and "did the question pane keep its
 * reading position across a reflow?" is a question about the pane that has
 * somewhere to have been. This is that fixture for the other pane; the text is a
 * real prompt's shape rather than lorem, because it is read by the same renderer
 * either way.
 */
const LONG_PROMPT_TEXT =
  "Which choice best states the main idea of the text, and which detail from the passage most directly supports that idea? Consider how the researchers' conclusion about canopy density relates to the measurements they took across four summers of extreme heat.";

const longPrompt = paragraph(
  "prompt",
  Array.from({ length: 5 }, () => LONG_PROMPT_TEXT).join(" ")
);

/**
 * A question and a passage that BOTH overflow their panes (`?long=3`).
 *
 * The fixture the reflow cases need: a layout whose panes have a reading position
 * to lose, in both of them, so the assertion is about the panes rather than about
 * whichever pane happened to have enough text.
 */
const longPanesQuestion: DeliveredQuestion = { ...oversizedReadingQuestion, prompt: longPrompt };

/**
 * A stimulus whose CHARACTERS are the point (`?clusters=1`).
 *
 * A handle is the precision instrument, and precision is measured in characters a
 * student can SEE: the family emoji below is eleven UTF-16 code units, the flag
 * two, the Thai syllable with its tone mark four, and `café` two — each of them one
 * character on screen, so an endpoint that moved by offset would anchor an
 * annotation to a fragment of one. The default stimulus is pure ASCII and cannot
 * show the difference either way, so the cluster text is opt-in: nothing that does
 * not ask for it changes shape.
 */
const clusterStimulus = paragraph(
  "stimulus",
  "Several \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} \u{1F1F9}\u{1F1ED} ก่อน cafe\u0301 researchers examined how urban tree cover changes surface temperature."
);

const clusterReadingQuestion: DeliveredQuestion = { ...readingQuestion, stimulus: clusterStimulus };

/**
 * A 108-character token with no break opportunity in it (`?unbreakable=1`).
 *
 * Deliberately not a URL: line breaking follows UAX #14, which offers a break
 * after every `/` — so a long address wraps on its own and would prove nothing
 * about the rule. This is the case the rule actually exists for, one run of
 * characters wider than the pane that has to break where it stands rather than
 * widen the pane or the exam around it. `coefficient` is repeated only to be
 * long enough to exceed a 200%-text pane at 1024px, which is where the wrap is
 * load-bearing; the sentence around it stays legible prose.
 */
const UNBREAKABLE_TOKEN = "coolingcoefficient".repeat(6);

const unbreakableStimulus = paragraph(
  "stimulus",
  `Researchers filed the raw estimate under ${UNBREAKABLE_TOKEN} and asked other groups to re-check it.`
);

const unbreakableReadingQuestion: DeliveredQuestion = {
  ...readingQuestion,
  stimulus: unbreakableStimulus,
};

const mathQuestion: DeliveredQuestion = {
  ...readingQuestion,
  examQuestionId: "debug-math-q1",
  questionId: "debug-math-question",
  stimulus: { version: 1, nodes: [] },
  prompt: {
    version: 2,
    nodes: [],
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { id: "math-prompt" },
        content: [
          { type: "text", text: "The graph of " },
          { type: "inlineMath", attrs: { latex: "x^2" } },
          { type: "text", text: " has its minimum at which point?" },
        ],
      }],
    },
  },
  metadata: {
    sectionKey: "math",
    domain: "Algebra",
    skill: "Linear equations",
    difficulty: "easy",
    tags: [],
  },
  answer: {
    kind: "single_choice",
    options: [
      { id: "a", content: paragraph("ma", "3") },
      { id: "b", content: paragraph("mb", "5") },
      { id: "c", content: paragraph("mc", "10") },
      { id: "d", content: paragraph("md", "15") },
    ],
  },
};

const sprQuestion: DeliveredQuestion = {
  ...readingQuestion,
  examQuestionId: "debug-spr-q1",
  questionId: "debug-spr-question",
  questionType: "student_produced_response",
  answer: {
    kind: "student_produced_response",
    normalizeFraction: true,
    normalizeDecimal: true,
    numericTolerance: null,
  },
};

export function SatAccessibilityDebugRoute() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const math = params.get("mode") === "math";
  const spr = params.get("mode") === "spr";
  /** A passage longer than its pane, for the cases that need a real scroll. */
  const longPassage = params.get("long") === "1";
  /** A passage longer than any pane, for the cases that need overflow itself. */
  const oversizedPassage = params.get("long") === "2";
  /** Both panes longer than the room they have, for the reflow cases. */
  const longPanes = params.get("long") === "3";
  /** A stimulus made of multi-code-unit characters, for the handle-precision cases. */
  const clusters = params.get("clusters") === "1";
  /** A stimulus holding one token no pane can fit, for the wrapping cases. */
  const unbreakable = params.get("unbreakable") === "1";
  /**
   * Auto-fit, as real delivery runs it (once, when the exam opens).
   *
   * Opt-in here because the harness is also how the resting 100% view is
   * exercised: `?long=1&autoFit=1` is the pair that shows the fit doing
   * something, and `?long=1` alone is the same page without it.
   */
  const autoFit = params.get("autoFit") === "1";
  /** Opt into the student-owned touch gesture used by SAT live delivery. */
  const ownedTouchSelection = params.get("ownedTouchSelection") === "1";
  const paused = params.get("paused") === "1";
  const initialTool =
    params.get("tool") === "calculator"
      ? "calculator"
      : params.get("tool") === "reference"
        ? "reference"
        : null;
  const [activeTools, setActiveTools] = useState<{ calculator: boolean; referenceSheet: boolean }>(() => ({
    calculator: initialTool === "calculator",
    referenceSheet: initialTool === "reference",
  }));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [eliminationMode, setEliminationMode] = useState(false);
  /** The attempt-scoped half of the fit's rule, held where delivery holds it. */
  const [screenZoomDecided, setScreenZoomDecided] = useState(false);
  const reading = useSatReadingPreferences("debug-schedule", "debug-attempt");
  const examViewport = useStudentExamViewport(true);
  useStudentExamPageLock(true);
  useStudentFocusedControlVisibility(examViewport.keyboardOpen);
  const [response, setResponse] = useState<SatQuestionResponseDraft>({
    questionId: math
      ? mathQuestion.examQuestionId
      : spr
        ? sprQuestion.examQuestionId
        : readingQuestion.examQuestionId,
    answer: "",
    markedForReview: false,
    eliminatedOptionIds: [],
    annotations: { version: 2, annotations: [], legacyQuestionNote: "" },
  });
  const question = math
    ? mathQuestion
    : spr
      ? sprQuestion
      : clusters
        ? clusterReadingQuestion
        : unbreakable
          ? unbreakableReadingQuestion
          : longPanes
            ? longPanesQuestion
            : oversizedPassage
              ? oversizedReadingQuestion
              : longPassage
                ? longReadingQuestion
                : readingQuestion;
  const navigationItems = [0, 1, 2].map((index) => ({
    id: `debug-${index}`,
    index,
    number: index + 1,
    status: index === 0 && response.answer ? ("answered" as const) : ("unanswered" as const),
    current: index === questionIndex,
    markedForReview: index === 0 && response.markedForReview,
  }));

  return (
    <StudentExamInteractionScopeProvider ownedTouchSelection={ownedTouchSelection}>
      {paused ? <SatBlockingOverlay note="Accessibility harness pause" /> : null}
      <SatExamShell
        sectionLabel={math ? "Section 2: Math" : "Section 1: Reading and Writing"}
        sectionKey={math ? "math" : "reading-writing"}
        directions={paragraph(
          "directions",
          "Answer every question. You may return to questions in this module before submitting it."
        )}
        remainingLabel="27:14"
        remainingSeconds={1634}
        examHeight={examViewport.stableExamHeight}
        keyboardOpen={examViewport.keyboardOpen}
        candidateName="Accessibility Candidate"
        questionIndex={questionIndex}
        questionCount={3}
        navigationItems={navigationItems}
        calculatorAvailable={math}
        calculatorOpen={activeTools.calculator}
        referenceAvailable={math}
        referenceOpen={activeTools.referenceSheet}
        notesAvailable
        blocked={paused}
        saveState="idle"
        questionNote={response.annotations.legacyQuestionNote}
        readingPreferences={reading.preferences}
        onReadingPreferencesChange={reading.setPreferences}
        autoFitScreenZoom={autoFit}
        screenZoomDecided={screenZoomDecided}
        onScreenZoomDecided={() => setScreenZoomDecided(true)}
        onSelectQuestion={setQuestionIndex}
        onToggleCalculator={() =>
          setActiveTools((current) => ({ ...current, calculator: !current.calculator }))
        }
        onToggleReference={() =>
          setActiveTools((current) => ({ ...current, referenceSheet: !current.referenceSheet }))
        }
        onPrevious={() => setQuestionIndex((current) => Math.max(0, current - 1))}
        onNext={() => setQuestionIndex((current) => Math.min(2, current + 1))}
        onReviewModule={() => undefined}
        onSaveNote={(note) =>
          setResponse((current) => ({ ...current, annotations: { ...current.annotations, legacyQuestionNote: note } }))
        }
        annotations={response.annotations}
        onAnnotationsChange={(annotations) => setResponse((current) => ({ ...current, annotations }))}
        answered={Boolean(response.answer.trim())}
        educationKey="debug-attempt"
        referenceTool={math ? (controls) => (
          <SatReferenceSheetPanel
            {...controls}
            open={activeTools.referenceSheet}
            disabled={paused}
            onClose={() => setActiveTools((current) => ({ ...current, referenceSheet: false }))}
          />
        ) : undefined}
      >
        <SatQuestionRenderer
          sectionKey={math ? "math" : "reading-writing"}
          questionNumber={questionIndex + 1}
          selectionScopeKey={`${math ? "math" : "reading-writing"}::${questionIndex}`}
          question={question}
          response={response}
          eliminationMode={eliminationMode}
          disabled={paused}
          readingPreferences={reading.preferences}
          onReadingSplitRatioChange={(splitRatio) =>
            reading.setPreferences((current) => ({ ...current, splitRatio }))
          }
          onAnswerChange={(answer) => setResponse((current) => ({ ...current, answer }))}
          onToggleReview={() =>
            setResponse((current) => ({ ...current, markedForReview: !current.markedForReview }))
          }
          onToggleEliminationMode={() => setEliminationMode((current) => !current)}
          onToggleEliminatedOption={(optionId) =>
            setResponse((current) => ({
              ...current,
              eliminatedOptionIds: current.eliminatedOptionIds.includes(optionId)
                ? current.eliminatedOptionIds.filter((id) => id !== optionId)
                : [...current.eliminatedOptionIds, optionId],
            }))
          }
        />
      </SatExamShell>
      {math ? (
        <>
          <SatCalculatorHost
            open={activeTools.calculator}
            scheduleId="debug-schedule"
            attemptId="debug-attempt"
            moduleAttemptId="debug-module"
            disabled={paused}
            moduleId="debug-module"
            examZoom={reading.preferences.examZoom}
            contrastMode={reading.preferences.contrastMode}
            onClose={() => setActiveTools((current) => ({ ...current, calculator: false }))}
          />
        </>
      ) : null}
    </StudentExamInteractionScopeProvider>
  );
}
