/**
 * Phase 05 verification: unit pins for e2e/support/actFixtures.ts.
 *
 * Lives under src/ because vitest excludes e2e/** (vitest.config.ts).
 * Runs with no browser and no DB: locks the deterministic namespace, the
 * two-stimulus/four-question shape, the independent oracle semantics
 * (trim/case, unanswered, unknown-excluded, weighted), and the read-only
 * character of the SQL probes. The Playwright spec (e2e/act-full-cycle)
 * consumes the same module; these tests prove the fixture logic locally.
 */
import { describe, expect, it } from "vitest";
import {
  actDbProbes,
  buildActFullCycleFixture,
  happyPathAnswers,
  mintActFixtureNamespace,
  oracleActScienceScore,
} from "../../../e2e/support/actFixtures";

describe("Phase 05 actFixtures oracle", () => {
  it("mints isolated deterministic namespaces", () => {
    expect(mintActFixtureNamespace("AT-06 forged score")).toBe("act-at-06-forged-score");
    expect(mintActFixtureNamespace("AT-06 forged score", 1)).toBe("act-at-06-forged-score-r1");
    expect(mintActFixtureNamespace("AT-06 forged score")).toBe(
      mintActFixtureNamespace("AT-06 forged score"),
    );
  });

  it("builds two stimuli with four mixed-category weighted questions", () => {
    const fx = buildActFullCycleFixture("act-demo");
    expect(fx.providerKey).toBe("act");
    expect(fx.examType).toBe("ACT");
    expect(fx.sectionKey).toBe("science");
    expect(fx.timing).toEqual({ totalMinutes: 40, allowPause: false });
    expect(fx.stimuli).toHaveLength(2);
    expect(fx.questionOrder).toHaveLength(4);
    expect(new Set(fx.questionOrder).size).toBe(4);
    // Every question has exactly four options with exactly one key.
    for (const s of fx.stimuli) {
      expect(s.imageRef.src.startsWith("data:")).toBe(false);
      for (const q of s.questions) {
        expect(q.options).toHaveLength(4);
        expect(q.options.filter((o) => o.isCorrect)).toHaveLength(1);
      }
    }
    // q4 carries double weight; everything else is 1.
    expect(fx.weights).toEqual([1, 1, 1, 2]);
  });

  it("oracle trims, ignores case, skips unanswered, excludes unknown IDs", () => {
    const fx = buildActFullCycleFixture("act-oracle");
    const [q1, q2, q3, q4] = fx.questionOrder;
    const score = oracleActScienceScore(fx, {
      [q1!]: fx.answerKey[q1!],
      [q2!]: `  ${String(fx.answerKey[q2!]).toLowerCase()}  `,
      [q3!]: "   ",
      [q4!]: null,
      "unknown-q9": "whatever",
    });
    // q1 + q2 correct (1+1), q3/q4 unanswered, unknown excluded.
    expect(score).toEqual({ totalScore: 2, maxScore: 5, percentage: 40 });
  });

  it("happy-path answers score 4/5 = 80%", () => {
    const fx = buildActFullCycleFixture("act-happy");
    const score = oracleActScienceScore(fx, happyPathAnswers(fx));
    expect(score.totalScore).toBe(4);
    expect(score.maxScore).toBe(5);
    expect(score.percentage).toBeCloseTo(80, 9);
  });

  it("keeps SQL probes read-only", () => {
    for (const sql of Object.values(actDbProbes)) {
      expect(sql.trimStart().toUpperCase().startsWith("SELECT")).toBe(true);
    }
  });
});
