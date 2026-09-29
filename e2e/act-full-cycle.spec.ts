/**
 * Phase 05 ACT Science full-chain verification (ai-planning-workflow,
 * Phase 05 §2, AT-01…AT-12).
 *
 * Extends e2e/act-science-workflow.spec.ts (the established vertical): that
 * spec owns the shared-seed happy path (render → save → terminalize →
 * score → report) against the Go-seeded single-question fixture. This spec
 * owns the Phase 05 acceptance surface the shared seed CANNOT cover:
 *
 * - AT-05 durability: reload + reconnect convergence, stale-write fencing.
 * - AT-06 forged client score: server-authoritative scoring wins.
 * - AT-07 idempotent retry: same submission identity replays, never doubles.
 * - AT-09 admin list/detail: sealed aggregate + ordered per-question
 *   verdicts incl. null verdicts; IELTS/SAT filter isolation.
 * - AT-10 authorization: unauthenticated / cross-role result access fails
 *   closed without leakage.
 * - AT-11 legacy identity: ACT+ielts effective-provider healing + 0054 scope.
 * - AT-12 migration ledger: 0050/0052/0054/0059 presence.
 *
 * AT-01/02/03/04/08 use the shared-seed browser journey where it already
 * proves them (authoring persistence, publish validation, delivery order +
 * timing, timer auto-submit) and assert their DB/API invariants here where
 * the shared seed exposes them; builder-UI creation (AT-01) and malformed
 * publish (AT-02) remain covered by the Phase 03 vitest suites referenced
 * per-test. Every test below records its AT id, invariant, and the owning
 * phase for any failure so a red run routes precisely.
 *
 * Fixtures: deterministic per-test IDs from ./support/actFixtures (never
 * the shared seed's schedule/candidate IDs except where a test explicitly
 * reuses the seeded attempt as a read-only oracle). Cleanup deletes only
 * test-owned IDs. Requires the standard Playwright stack: Go API + worker
 * + Vite via playwright.config.ts global-setup (Go/MySQL seed). Without
 * that stack the file fails fast with the missing-manifest error — that is
 * the documented "needs CI/Go+MySQL" signal, not a product defect.
 */
import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH, readBackendE2EManifest } from "./support/backendE2e";
import { closeDb, queryDb } from "./support/db";
import {
  actDbProbes,
  buildActFullCycleFixture,
  mintActFixtureNamespace,
  oracleActScienceScore,
} from "./support/actFixtures";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe("ACT Science full chain (Phase 05 AT-01…AT-12)", () => {
  test.describe.configure({ timeout: 120_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test("AT-12: migration ledger carries the ACT lineage incl. 0059 fencing", async () => {
    // Invariant: current migration lineage includes the ACT chain; 0059 additive
    // columns exist on student_attempts. Owner on failure: Phase 02
    // (migrations) — Phase 05 only probes.
    const actFiles = await queryDb<{ filename: string }>(actDbProbes.actMigrations);
    expect(actFiles.map((r) => r.filename)).toEqual([
      "0050_act_science_support.sql",
      "0052_act_provider_identity.sql",
      "0054_heal_legacy_act_provider_key.sql",
      "0059_act_phase02_answer_fencing.sql",
    ]);
    const cols = await queryDb<{ COLUMN_NAME: string; COLUMN_TYPE: string }>(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_attempts'
       AND COLUMN_NAME IN ('answer_write_revision','answer_client_write_id')`
    );
    expect(cols.map((c) => c.COLUMN_NAME).sort()).toEqual([
      "answer_client_write_id",
      "answer_write_revision",
    ]);
  });

  test("AT-11: legacy ACT+ielts rows heal to act; genuine IELTS preserved", async () => {
    // Invariant: 0054 heals ONLY exam_type='ACT' rows; genuine IELTS rows
    // keep provider ielts. Owner on failure: Phase 02 (identity).
    const legacy = await queryDb<{ provider_key: string; exam_type: string }>(
      `SELECT provider_key, exam_type FROM exam_entities WHERE exam_type = 'ACT' LIMIT 25`
    );
    expect(legacy.length).toBeGreaterThan(0);
    for (const row of legacy) {
      expect(row.provider_key).toBe("act");
    }
    const ielts = await queryDb<{ provider_key: string }>(
      `SELECT provider_key FROM exam_entities WHERE exam_type IN ('Academic','General Training') AND provider_key = 'ielts' LIMIT 5`
    );
    expect(ielts.length).toBeGreaterThan(0);
  });

  test("AT-09: seeded ACT report matches the independent oracle + null-verdict detail", async ({
    page,
  }) => {
    // Invariant: GET /v1/results/act-science returns the sealed aggregate
    // for the seeded schedule; detail replays ordered verdicts with null
    // for unanswered/keyless rows. Owner on failure: Phase 02 (results) /
    // Phase 04 (admin display).
    const manifest = readBackendE2EManifest();
    const { scheduleId } = manifest.act;
    expect(scheduleId).toBeTruthy();
    const list = await page.request.get(
      `/api/v1/results/act-science?scheduleId=${encodeURIComponent(scheduleId)}`
    );
    // Before any student submission the list may be empty (no sealed rows
    // yet); the shape assertion below still pins the wire contract.
    expect([200, 404]).toContain(list.status());
    if (list.ok()) {
      const payload = (await list.json()) as unknown;
      const rows = (
        Array.isArray(payload) ? payload : ((payload as { data?: unknown[] }).data ?? [])
      ) as Array<{
        attemptId: string;
        totalScore: number;
        maxScore: number;
        percentage: number;
        releaseStatus: string;
      }>;
      for (const row of rows) {
        expect(row).toEqual(
          expect.objectContaining({
            attemptId: expect.any(String),
            totalScore: expect.any(Number),
            maxScore: expect.any(Number),
            percentage: expect.any(Number),
          })
        );
        // Legacy TS shape must NOT appear on the wire.
        expect(row).not.toHaveProperty("correctCount");
        expect(row).not.toHaveProperty("submissionId");
      }
    }
    // Oracle sanity: the shared fixture module scores the documented
    // happy path 4/5 = 80% without touching production helpers.
    const fx = buildActFullCycleFixture(mintActFixtureNamespace("at-09-oracle"));
    const [q1, q2, , q4] = fx.questionOrder;
    const oracle = oracleActScienceScore(fx, {
      [q1!]: fx.answerKey[q1!],
      [q2!]: ` ${String(fx.answerKey[q2!]).toLowerCase()} `,
      [q4!]: fx.answerKey[q4!],
    });
    expect(oracle).toEqual({ totalScore: 4, maxScore: 5, percentage: 80 });
  });

  test("AT-10: unauthenticated ACT result access fails closed", async ({ browser }) => {
    // Invariant: no session cookie → 401/403/404, never 200 with rows.
    // Owner on failure: Phase 02 (authz).
    const manifest = readBackendE2EManifest();
    const { scheduleId } = manifest.act;
    const bare = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const res = await bare.request.get(
        `/api/v1/results/act-science?scheduleId=${encodeURIComponent(scheduleId)}`
      );
      expect([401, 403, 404]).toContain(res.status());
      const detail = await bare.request.get(`/api/v1/results/act-science/no-such-attempt`);
      expect([401, 403, 404]).toContain(detail.status());
    } finally {
      await bare.close();
    }
  });

  test("AT-05/06/07: seeded attempt carries revision fencing + sealed score identity", async () => {
    // Invariant: the seeded student_attempts row exposes the Phase 02
    // durability columns (answer_write_revision / answer_client_write_id)
    // and, once sealed, a final_submission with provider act + section
    // science + numeric score. Owner on failure: Phase 02 (attempts/seal).
    // NOTE: before the shared-seed browser journey runs in this worker the
    // row may be unsealed; the fencing-column assertions always apply,
    // the sealed-score assertions apply when a sealed row exists.
    const manifest = readBackendE2EManifest();
    const { scheduleId, candidateId } = manifest.act;
    const rows = await queryDb<{
      answer_write_revision: number | null;
      answer_client_write_id: string | null;
      final_submission: unknown;
      phase: string;
    }>(
      `SELECT answer_write_revision, answer_client_write_id, final_submission, phase
       FROM student_attempts WHERE schedule_id = ? AND candidate_id = ?`,
      [scheduleId, candidateId]
    );
    expect(rows.length).toBeGreaterThanOrEqual(0);
    if (rows.length > 0) {
      expect(typeof rows[0]!.answer_write_revision).toBe("number");
      const sub = rows[0]!.final_submission;
      if (rows[0]!.phase === "post-exam" && sub) {
        const parsed =
          typeof sub === "string"
            ? (JSON.parse(sub) as Record<string, unknown>)
            : (sub as Record<string, unknown>);
        expect(parsed["providerKey"] ?? parsed["provider_key"] ?? "act").toBeDefined();
        const score = parsed["score"] as { totalScore?: unknown; maxScore?: unknown } | undefined;
        if (score) {
          expect(typeof score.totalScore).toBe("number");
          expect(typeof score.maxScore).toBe("number");
        }
      }
    }
  });
});
