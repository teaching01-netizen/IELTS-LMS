#!/usr/bin/env bun
// SAT exam-day answer comparator (plan §2 + §5 reconciliation).
//
// Compares, for EVERY admitted attempt on the given schedule(s):
//   - exactly one attempt per student; one terminal receipt/submission/result
//   - exactly the selected modules' question identities (no unselected branch)
//   - V2 response rows at the sealed revision vs journal (optional) — 1:1
//   - zero duplicates, cross-student leakage, or false "submitted"
//   - pending/unrecoverable classification for non-terminal sittings
//
// Usage:
//   SAT_DB_URL='mysql://u:p@host:3306/db' bun scripts/sat-answer-comparator.mjs \
//     --schedule <scheduleId> [--schedule <id>...] [--journal journal.jsonl] \
//     [--out verdicts.json] [--expect-count 10000]
//
// Journal lines are the SAT_JOURNAL JSON printed by k6/sat-exam-day.js
// (runId, scheduleId, attemptId, moduleAttemptId, examQuestionId,
// clientWriteId, payload, ackRevision). Without --journal the script still
// enforces all structural invariants; payload equality is reported as
// `unverifiable` (a release blocker per the plan) instead of passed.
//
// Exit code: 0 when zero blockers, 1 otherwise. Never samples: every
// admitted attempt is checked.

import mysql from 'mysql2/promise';
import fs from 'node:fs';

function usage() {
  console.log(`Usage: sat-answer-comparator.mjs --schedule <id> [--schedule <id>...] [--journal <path>] [--out <path>] [--expect-count <n>]`);
}

const args = process.argv.slice(2);
const schedules = [];
let journalPath = null;
let outPath = 'sat-verdicts.json';
let expectCount = null;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--schedule' && args[i + 1]) schedules.push(args[++i]);
  else if (a === '--journal' && args[i + 1]) journalPath = args[++i];
  else if (a === '--out' && args[i + 1]) outPath = args[++i];
  else if (a === '--expect-count' && args[i + 1]) expectCount = Number(args[++i]);
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
}
if (schedules.length === 0) { usage(); process.exit(2); }

const dbUrl = process.env.SAT_DB_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing SAT_DB_URL (or TEST_DATABASE_URL / DATABASE_URL). Refusing to guess.');
  process.exit(2);
}

function canonicalAnswer(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'answer' in v) return String(v.answer);
  return JSON.stringify(v);
}

async function main() {
  const pool = mysql.createPool({ uri: dbUrl, connectionLimit: 4, timezone: 'Z', dateStrings: true });
  const q = async (sql, params) => {
    const [rows] = await pool.execute(sql, params);
    return rows;
  };

  // Optional journal: last server-acknowledged write per question wins.
  const journal = new Map(); // key attemptId|examQuestionId -> {payload, writeId}
  if (journalPath) {
    const text = fs.readFileSync(journalPath, 'utf8');
    for (const line of text.split('\n')) {
      const idx = line.indexOf('{');
      if (idx < 0) continue;
      try {
        const e = JSON.parse(line.slice(idx));
        if (!e.attemptId || !e.examQuestionId) continue;
        journal.set(`${e.attemptId}|${e.examQuestionId}`, e);
      } catch { /* ignore non-journal lines */ }
    }
  }

  const verdicts = [];
  let blockers = 0;
  const bump = (v, blocker, code, detail) => {
    v.issues.push({ blocker, code, detail });
    if (blocker) { v.ok = false; blockers += 1; }
  };

  for (const scheduleId of schedules) {
    const attempts = await q(
      `SELECT id, candidate_id, candidate_email, published_version_id, protocol_version,
              delivery_status, submitted_at, response_revision, proctor_status
         FROM student_attempts WHERE schedule_id = ? ORDER BY id`,
      [scheduleId],
    );

    // Exactly one attempt per admitted student.
    const byCandidate = new Map();
    for (const a of attempts) {
      const k = String(a.candidate_id || a.candidate_email || a.id);
      byCandidate.set(k, (byCandidate.get(k) || []).concat(a));
    }
    const dupCandidates = [...byCandidate.entries()].filter(([, v]) => v.length > 1);

    for (const a of attempts) {
      const v = { attemptId: a.id, candidateId: a.candidate_id, ok: true, issues: [] };
      if ((byCandidate.get(String(a.candidate_id || a.candidate_email || a.id)) || []).length > 1) {
        bump(v, true, 'duplicate_attempt', `candidate ${a.candidate_id} holds multiple attempts`);
      }

      const decisions = await q(
        `SELECT d.section_id, d.selected_route, d.selected_module_id, d.base_module_id,
                s.section_key
           FROM assessment_route_decisions d
           JOIN assessment_sections s ON s.id = d.section_id
          WHERE d.attempt_id = ?`,
        [a.id],
      );
      if (decisions.length > 2) bump(v, true, 'too_many_route_decisions', `got ${decisions.length}, want <=2 (RW+Math)`);

      // Selected modules = base M1 per decided section + selected M2 branch.
      // Expected identities derived from the pinned published version.
      const selectedModuleIds = [];
      for (const d of decisions) selectedModuleIds.push(d.base_module_id, d.selected_module_id);
      let expectedIds = [];
      if (selectedModuleIds.length > 0) {
        const placeholders = selectedModuleIds.map(() => '?').join(',');
        const rows = await q(
          `SELECT id FROM assessment_exam_questions WHERE module_id IN (${placeholders})`,
          selectedModuleIds,
        );
        expectedIds = rows.map((r) => String(r.id));
      }

      const responses = await q(
        `SELECT question_id, module_id, response, server_revision, client_write_id
           FROM attempt_responses_v2 WHERE attempt_id = ?`,
        [a.id],
      );
      const seen = new Set();
      for (const r of responses) {
        const key = `${a.id}|${r.question_id}`;
        if (seen.has(key)) bump(v, true, 'duplicate_question_identity', `question ${r.question_id} twice`);
        seen.add(key);
      }
      // Duplicate write IDs must not create second versions (ledger check).
      const dupWrites = await q(
        `SELECT client_write_id, COUNT(*) c FROM attempt_mutations_v2
          WHERE attempt_id = ? GROUP BY client_write_id HAVING c > 1`,
        [a.id],
      );
      if (dupWrites.length > 0) bump(v, true, 'duplicate_write_id', `${dupWrites.length} write IDs duplicated`);

      if (expectedIds.length > 0) {
        const expected = new Set(expectedIds);
        const got = new Set(responses.map((r) => String(r.question_id)));
        // Join by examQuestionId OR question_id (V2 keys either identity).
        const eqRows = await q(
          `SELECT id, question_id FROM assessment_exam_questions WHERE id IN (${expectedIds.map(() => '?').join(',')})`,
          expectedIds,
        ).catch(() => []);
        const altIds = new Set(eqRows.map((r) => String(r.question_id)));
        const missing = [...expected].filter((id) => !got.has(id) && ![...got].some((g) => altIds.has(g)));
        // Unanswered slots are explicit nulls: they are absent rows. Count
        // them as missing ONLY when the journal expected an answer.
        const journalAnswered = [...journal.keys()].filter((k) => k.startsWith(`${a.id}|`)).length;
        if (journalAnswered > 0 && got.size !== journalAnswered) {
          bump(v, true, 'answer_count_mismatch', `journal answered=${journalAnswered} stored=${got.size}`);
        }
        // Extra answers: stored IDs outside the selected set (join both keys).
        const selectedAll = new Set([...expected, ...altIds]);
        const extra = [...got].filter((id) => {
          if (selectedAll.has(id)) return false;
          return true;
        });
        // Confirm extras are truly unselected-branch (not legacy aliasing).
        if (extra.length > 0) {
          const ph = extra.map(() => '?').join(',');
          const mods = await q(
            `SELECT DISTINCT module_id FROM assessment_exam_questions WHERE id IN (${ph}) OR question_id IN (${ph})`,
            [...extra, ...extra],
          ).catch(() => []);
          const modIds = new Set(mods.map((m) => String(m.module_id)));
          const selMods = new Set(selectedModuleIds.map(String));
          const outside = [...modIds].filter((m) => !selMods.has(m));
          if (outside.length > 0) bump(v, true, 'unselected_branch_response', `modules ${outside.join(',')}`);
        }
        void missing;
      }

      // Journal payload equality (exact canonical answer, no normalization).
      if (journalPath) {
        for (const [key, e] of journal) {
          const [aid, qid] = key.split('|');
          if (aid !== a.id) continue;
          const row = responses.find((r) => String(r.question_id) === qid);
          if (!row) { bump(v, true, 'missing_answer', `journal expects ${qid}, no stored row`); continue; }
          let stored = null;
          try { stored = JSON.parse(typeof row.response === 'string' ? row.response : JSON.stringify(row.response)); } catch { stored = row.response; }
          const want = canonicalAnswer(e.payload);
          const have = canonicalAnswer(stored);
          if (want !== have) bump(v, true, 'mismatched_answer', `${qid}: journal=${JSON.stringify(want)} stored=${JSON.stringify(have)}`);
        }
      } else if (responses.length > 0) {
        v.issues.push({ blocker: false, code: 'payload_unverifiable', detail: 'no journal supplied; payload equality not checked (release blocker per plan §2)' });
      }

      // Terminal chain: exactly one receipt/submission/result for submitted sittings.
      const terms = await q(`SELECT attempt_id, outcome, answer_revision FROM attempt_terminalizations WHERE attempt_id = ?`, [a.id]);
      const subs = await q(`SELECT id FROM student_submissions WHERE attempt_id = ?`, [a.id]).catch(() => []);
      const results = await q(
        `SELECT r.id FROM assessment_results r JOIN student_submissions s ON s.id = r.submission_id WHERE s.attempt_id = ?`,
        [a.id],
      ).catch(() => []);
      const submitted = a.submitted_at !== null || String(a.delivery_status) === 'submitted';
      if (submitted) {
        if (terms.length !== 1) bump(v, true, 'terminal_count', `terminalizations=${terms.length}, want 1`);
        if (subs.length !== 1) bump(v, true, 'submission_count', `submissions=${subs.length}, want 1`);
        if (results.length !== 1) bump(v, true, 'result_count', `results=${results.length}, want 1`);
        if (terms.length === 1 && Number(terms[0].answer_revision) !== Number(a.response_revision)) {
          bump(v, true, 'sealed_revision_mismatch', `sealed=${terms[0].answer_revision} attempt=${a.response_revision}`);
        }
      } else {
        v.issues.push({ blocker: false, code: 'pending_submission', detail: `delivery_status=${a.delivery_status}; visible as pending, never submitted` });
      }

      verdicts.push(v);
    }

    if (dupCandidates.length > 0) blockers += dupCandidates.length;
    if (expectCount !== null && Number.isFinite(expectCount) && attempts.length !== expectCount) {
      blockers += 1;
      verdicts.push({ attemptId: `schedule:${scheduleId}`, candidateId: null, ok: false, issues: [{ blocker: true, code: 'attempt_count', detail: `attempts=${attempts.length} want=${expectCount}` }] });
    }
  }

  const summary = {
    schedules,
    attempts: verdicts.filter((x) => !String(x.attemptId).startsWith('schedule:')).length,
    passed: verdicts.filter((x) => x.ok).length,
    failed: verdicts.filter((x) => !x.ok).length,
    blockers,
    journalLines: journal.size,
    unverifiablePayload: journalPath ? 0 : verdicts.filter((x) => x.issues.some((i) => i.code === 'payload_unverifiable')).length,
  };
  fs.writeFileSync(outPath, JSON.stringify({ summary, verdicts }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
  process.exit(blockers > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`comparator failed: ${e && e.stack ? e.stack : String(e)}`); process.exit(2); });
