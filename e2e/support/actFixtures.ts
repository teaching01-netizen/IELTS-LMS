/**
 * Phase 05 ACT verification fixtures (ai-planning-workflow, Phase 05 §2).
 *
 * Test-only deterministic inputs for the ACT Science full-chain spec
 * (e2e/act-full-cycle.spec.ts). This file owns NO production behavior:
 * it builds isolated per-test IDs, a two-stimulus / four-question fixture
 * exam payload (mixed skill categories + weights), an independent score
 * oracle (never the Go scorer or a client helper), durable media
 * references, 40-minute/no-pause timing expectations, and the SQL probes
 * the spec uses to assert sealed DB state.
 *
 * Why a new fixture instead of extending backendE2e.ts: the seeded manifest
 * (global-setup → cmd/e2e_seed) carries exactly ONE shared ACT attempt
 * (single question, shared schedule/candidate IDs). AT-01…AT-12 require
 * isolated deterministic IDs per test plus multi-question weighted scoring
 * with case-variation and missing-answer coverage — none of which the
 * shared seed provides. The shared seed stays untouched; this module
 * generates the per-test identity and oracle the new spec needs.
 *
 * Cleanup rule (§2): specs delete only rows keyed by the IDs minted here;
 * the shared manifest/seed rows are never touched.
 */

export interface ActFixtureQuestion {
  questionId: string;
  stem: string;
  skillCategory:
    | "interpretation_of_data"
    | "scientific_investigation"
    | "evaluating_scientific_arguments_and_models_with_evidence";
  options: Array<{ id: string; text: string; isCorrect: boolean }>;
  /** Per-question weight used by the oracle (default 1). */
  weight?: number;
}

export interface ActFixtureStimulus {
  id: string;
  title: string;
  content: string;
  imageRef: { id: string; alt: string; src: string };
  blockId: string;
  questions: ActFixtureQuestion[];
}

export interface ActFullCycleFixture {
  /** Deterministic per-test namespace, e.g. "at05-03". */
  namespace: string;
  examTitle: string;
  providerKey: "act";
  examType: "ACT";
  sectionKey: "science";
  /** 40 minutes, pausing disallowed (AT-04 invariant). */
  timing: { totalMinutes: 40; allowPause: false };
  stimuli: ActFixtureStimulus[];
  /** Canonical ordered question IDs across stimuli. */
  questionOrder: string[];
  /** Sealed answer key: questionId -> correct option id. */
  answerKey: Record<string, string>;
  /** Per-question weights in sealed order. */
  weights: number[];
}

/**
 * Mint an isolated deterministic fixture namespace. Pure function of the
 * test name + worker-stable counter so parallel workers never collide and
 * reruns reproduce the same IDs.
 */
export function mintActFixtureNamespace(testSlug: string, attempt = 0): string {
  const clean = testSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `act-${clean || "case"}${attempt > 0 ? `-r${attempt}` : ""}`;
}

/** Two stimuli, four mixed-category questions (AT-01…AT-12 shared input). */
export function buildActFullCycleFixture(namespace: string): ActFullCycleFixture {
  const q = (id: string, stem: string, correct: string): ActFixtureQuestion => ({
    questionId: `${namespace}-${id}`,
    stem,
    skillCategory:
      id === "q1" || id === "q3"
        ? "interpretation_of_data"
        : id === "q2"
          ? "scientific_investigation"
          : "evaluating_scientific_arguments_and_models_with_evidence",
    options: ["A", "B", "C", "D"].map((letter) => ({
      id: `${namespace}-${id}-${letter}`,
      text: `${letter} option for ${id}`,
      isCorrect: letter === correct,
    })),
    weight: id === "q4" ? 2 : 1,
  });
  const stimuli: ActFixtureStimulus[] = [
    {
      id: `${namespace}-stim-1`,
      title: "Ecology experiment",
      content: "Plants were grown under four light conditions.",
      imageRef: {
        id: `${namespace}-img-growth-chart`,
        alt: "Bar chart of plant growth by light condition",
        src: `assets/act/${namespace}/growth-chart.png`,
      },
      blockId: `${namespace}-block-1`,
      questions: [
        q("q1", "Which condition produced the greatest growth?", "B"),
        q("q2", "Which variable was controlled across trays?", "A"),
      ],
    },
    {
      id: `${namespace}-stim-2`,
      title: "Titration curve",
      content: "An acid-base titration curve is shown.",
      imageRef: {
        id: `${namespace}-img-titration`,
        alt: "Titration curve with equivalence point marked",
        src: `assets/act/${namespace}/titration.png`,
      },
      blockId: `${namespace}-block-2`,
      questions: [
        q("q3", "At which volume is the equivalence point reached?", "C"),
        q("q4", "Which statement is best supported by the curve?", "D"),
      ],
    },
  ];
  const questionOrder = stimuli.flatMap((s) => s.questions.map((qq) => qq.questionId));
  const answerKey: Record<string, string> = {};
  for (const s of stimuli) {
    for (const qq of s.questions) {
      const correct = qq.options.find((o) => o.isCorrect);
      if (!correct) throw new Error(`fixture question ${qq.questionId} has no correct option`);
      answerKey[qq.questionId] = correct.id;
    }
  }
  return {
    namespace,
    examTitle: `ACT Science Phase05 ${namespace}`,
    providerKey: "act",
    examType: "ACT",
    sectionKey: "science",
    timing: { totalMinutes: 40, allowPause: false },
    stimuli,
    questionOrder,
    answerKey,
    weights: stimuli.flatMap((s) => s.questions.map((qq) => qq.weight ?? 1)),
  };
}

/**
 * Independent score oracle (Phase 05 §2: never production scoring helpers).
 * Mirrors the canonical contract only: trim + case-insensitive string match,
 * blank/null/whitespace unanswered (zero), unknown IDs excluded, weighted.
 */
export function oracleActScienceScore(
  fixture: ActFullCycleFixture,
  answers: Record<string, string | number | null | undefined>,
): { totalScore: number; maxScore: number; percentage: number } {
  let total = 0;
  let max = 0;
  fixture.questionOrder.forEach((qid, i) => {
    const w = fixture.weights[i] ?? 1;
    max += w;
    const given = answers[qid];
    if (given === null || given === undefined) return;
    if (typeof given !== "string") return;
    if (given.trim() === "") return;
    const want = fixture.answerKey[qid];
    if (given.trim().toLowerCase() === want.trim().toLowerCase()) total += w;
  });
  return { totalScore: total, maxScore: max, percentage: max > 0 ? (total / max) * 100 : 0 };
}

/**
 * Canonical student answer set for the happy-path cycle: q1 exact, q2 with
 * case/whitespace variation (must still score), q3 omitted (unanswered),
 * q4 correct at double weight. Expected oracle: total 4 / max 5 = 80%.
 */
export function happyPathAnswers(
  fixture: ActFullCycleFixture,
): Record<string, string | null> {
  const [q1, q2, , q4] = fixture.questionOrder;
  const answers: Record<string, string | null> = {};
  answers[q1!] = fixture.answerKey[q1!];
  const raw2 = fixture.answerKey[q2!];
  answers[q2!] = `  ${raw2.toLowerCase()}  `;
  answers[q4!] = fixture.answerKey[q4!];
  return answers;
}

/** SQL probes the spec uses to assert sealed DB state (read-only). */
export const actDbProbes = {
  attemptByScheduleCandidate:
    "SELECT id, phase, submitted_at, final_submission FROM student_attempts WHERE schedule_id = ? AND candidate_id = ?",
  runtimeStatus: "SELECT status FROM exam_session_runtimes WHERE schedule_id = ?",
  migrationLedger:
    "SELECT COUNT(*) AS n FROM schema_migrations",
  actMigrations:
    "SELECT filename FROM schema_migrations WHERE filename IN ('0050_act_science_support.sql','0052_act_provider_identity.sql','0054_heal_legacy_act_provider_key.sql','0059_act_phase02_answer_fencing.sql') ORDER BY filename",
} as const;
