/**
 * Objective grading parity harness.
 *
 * Replays exam content + a student's answers through both graders:
 *   - the Go projection grader (cmd/grading-parity-grade), and
 *   - the website grader used by the review page and export.
 *
 * It reports every question where the two disagree, with the saved score and
 * release state for context. Read-only: database mode opens a read-only
 * transaction and never writes.
 *
 * Usage:
 *   bun backend/scripts/grading-parity.ts --fixture testdata/objective-grading-parity/baseline-exam.json
 *   bun backend/scripts/grading-parity.ts --database-url "$PARITY_DATABASE_URL"
 *
 * Options:
 *   --fixture <path>       Grade a fixture file instead of a database.
 *   --database-url <url>   Read IELTS submissions from this dedicated database.
 *   --out <path>           Write the JSON report to this path as well as stdout.
 *   --label <text>         Label recorded in the report ("before", "after", ...).
 *   --json                 Print only the JSON report (no summary line).
 *   --fail-on-mismatch     Exit 1 when any mismatch is found (CI gate).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrateExamState, getStudentQuestionsForModule } from '../../src/services/examAdapterService';
import { gradeSectionForParity } from '../../src/features/grading/objectiveParityGrading';
import type { ExamState } from '../../src/types';
import type { StudentAnswerValue } from '../../src/types/answers';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const GO_ROOT = resolve(REPO_ROOT, 'backend/go');

type Section = 'listening' | 'reading';

interface SavedQuestionResult {
  questionId: string;
  isCorrect?: boolean | null;
  awardedScore?: number | null;
  maxScore?: number | null;
}

interface GradingCase {
  id: string;
  submissionId: string;
  scheduleId: string;
  released: boolean;
  section: Section;
  versionId: string;
  examState: ExamState;
  answers: Record<string, StudentAnswerValue | undefined>;
  keys?: Record<string, string>;
  overrides?: Record<string, unknown>;
  savedResults?: SavedQuestionResult[];
}

interface GoParityInput {
  section: Section;
  content: ExamState;
  answers: Record<string, unknown>;
  keys: Record<string, string>;
  overrides: Record<string, unknown>;
  versionId: string;
}

interface GoParityQuestion {
  questionId: string;
  correctness: boolean | null;
  status: string;
  awardedScore: number | null;
  maxScore: number | null;
  studentAnswer: string;
  correctAnswer: unknown;
  scoringRule: string;
}

interface GoParityResult {
  section: Section;
  totalScore: number;
  maxScore: number;
  percentage: number;
  questions: GoParityQuestion[];
}

interface ParityMismatch {
  caseId: string;
  submissionId: string;
  scheduleId: string;
  section: Section;
  questionId: string;
  released: boolean;
  saved: SavedQuestionResult | null;
  go: Pick<GoParityQuestion, 'correctness' | 'awardedScore' | 'maxScore' | 'status'>;
  website: {
    correctness: boolean | null;
    awardedScore: number | null;
    maxScore: number | null;
    status: string;
  };
  reasons: string[];
}

interface ParityReport {
  generatedAt: string;
  label: string;
  mode: 'fixture' | 'database';
  summary: {
    submissions: number;
    released: number;
    unreleased: number;
    cases: number;
    affectedStudents: number;
    affectedQuestions: number;
    mismatches: number;
    mismatchesReleased: number;
    mismatchesUnreleased: number;
  };
  mismatches: ParityMismatch[];
}

interface ParsedArgs {
  fixture: string | undefined;
  databaseUrl: string | undefined;
  out: string | undefined;
  label: string;
  json: boolean;
  failOnMismatch: boolean;
}

declare const Bun: {
  spawn: (
    command: string[],
    options: Record<string, unknown>,
  ) => {
    stdin: { write: (value: string) => void; end: () => Promise<void> };
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  };
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    fixture: undefined,
    databaseUrl: undefined,
    out: undefined,
    label: 'adhoc',
    json: false,
    failOnMismatch: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--fixture':
        args.fixture = argv[index + 1];
        index += 1;
        break;
      case '--database-url':
        args.databaseUrl = argv[index + 1];
        index += 1;
        break;
      case '--out':
        args.out = argv[index + 1];
        index += 1;
        break;
      case '--label':
        args.label = argv[index + 1] ?? 'adhoc';
        index += 1;
        break;
      case '--json':
        args.json = true;
        break;
      case '--fail-on-mismatch':
        args.failOnMismatch = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readAnswerMap(payload: unknown): Record<string, StudentAnswerValue | undefined> {
  if (!payload || typeof payload !== 'object') return {};
  const candidate = (payload as { answers?: unknown }).answers;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
  return candidate as Record<string, StudentAnswerValue | undefined>;
}

async function runGoGrader(inputs: GoParityInput[]): Promise<GoParityResult[]> {
  const proc = Bun.spawn(['go', 'run', './cmd/grading-parity-grade'], {
    cwd: GO_ROOT,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  proc.stdin.write(JSON.stringify(inputs));
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Go parity grader failed (exit ${exitCode}): ${stderr.slice(0, 2000)}`);
  }
  return JSON.parse(stdout) as GoParityResult[];
}

function compareNumber(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (right === null || right === undefined) return false;
  return Math.abs(left - right) < 1e-9;
}

function compareCase(
  testCase: GradingCase,
  goResult: GoParityResult,
): ParityMismatch[] {
  const examState = hydrateExamState(testCase.examState);
  const descriptors = getStudentQuestionsForModule(examState, testCase.section);
  const website = gradeSectionForParity(
    testCase.section,
    descriptors,
    testCase.answers,
    testCase.overrides as Parameters<typeof gradeSectionForParity>[3],
  );
  const goById = new Map(goResult.questions.map((question) => [question.questionId, question]));
  const websiteById = new Map(website.questions.map((question) => [question.questionId, question]));
  const savedById = new Map((testCase.savedResults ?? []).map((result) => [result.questionId, result]));
  const ids = new Set([...goById.keys(), ...websiteById.keys()]);
  const mismatches: ParityMismatch[] = [];

  if (!compareNumber(goResult.totalScore, website.totalScore) || !compareNumber(goResult.maxScore, website.maxScore)) {
    mismatches.push({
      caseId: testCase.id,
      submissionId: testCase.submissionId,
      scheduleId: testCase.scheduleId,
      section: testCase.section,
      questionId: '__section_totals__',
      released: testCase.released,
      saved: null,
      go: { correctness: null, awardedScore: goResult.totalScore, maxScore: goResult.maxScore, status: 'totals' },
      website: { correctness: null, awardedScore: website.totalScore, maxScore: website.maxScore, status: 'totals' },
      reasons: ['sectionTotals'],
    });
  }

  for (const questionId of ids) {
    const go = goById.get(questionId);
    const site = websiteById.get(questionId);
    const reasons: string[] = [];
    if (!go) reasons.push('missing-go-result');
    if (!site) reasons.push('missing-website-result');
    if (go && site) {
      if (go.correctness !== site.correctness) reasons.push('correctness');
      if (!compareNumber(go.awardedScore, site.awardedScore)) reasons.push('awardedScore');
      if (!compareNumber(go.maxScore, site.maxScore)) reasons.push('maxScore');
    }
    if (reasons.length === 0) continue;

    mismatches.push({
      caseId: testCase.id,
      submissionId: testCase.submissionId,
      scheduleId: testCase.scheduleId,
      section: testCase.section,
      questionId,
      released: testCase.released,
      saved: savedById.get(questionId) ?? null,
      go: go
        ? {
            correctness: go.correctness,
            awardedScore: go.awardedScore,
            maxScore: go.maxScore,
            status: go.status,
          }
        : { correctness: null, awardedScore: null, maxScore: null, status: 'missing' },
      website: site
        ? {
            correctness: site.correctness,
            awardedScore: site.awardedScore,
            maxScore: site.maxScore,
            status: site.status,
          }
        : { correctness: null, awardedScore: null, maxScore: null, status: 'missing' },
      reasons,
    });
  }

  return mismatches;
}

function summarise(cases: GradingCase[], mismatches: ParityMismatch[]): ParityReport['summary'] {
  const students = new Set(cases.map((testCase) => testCase.submissionId));
  const releasedStudents = new Set(
    cases.filter((testCase) => testCase.released).map((testCase) => testCase.submissionId),
  );
  return {
    submissions: students.size,
    released: releasedStudents.size,
    unreleased: students.size - releasedStudents.size,
    cases: cases.length,
    affectedStudents: new Set(mismatches.map((mismatch) => mismatch.submissionId)).size,
    affectedQuestions: new Set(mismatches.map((mismatch) => mismatch.section + ':' + mismatch.questionId)).size,
    mismatches: mismatches.length,
    mismatchesReleased: mismatches.filter((mismatch) => mismatch.released).length,
    mismatchesUnreleased: mismatches.filter((mismatch) => !mismatch.released).length,
  };
}

function buildReport(
  mode: ParityReport['mode'],
  label: string,
  cases: GradingCase[],
  mismatches: ParityMismatch[],
): ParityReport {
  return {
    generatedAt: new Date().toISOString(),
    label,
    mode,
    summary: summarise(cases, mismatches),
    mismatches: mismatches.sort(
      (left, right) =>
        left.submissionId.localeCompare(right.submissionId) ||
        left.section.localeCompare(right.section) ||
        left.questionId.localeCompare(right.questionId),
    ),
  };
}

function loadFixture(path: string): GradingCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    cases?: unknown[];
    examState?: unknown;
    answers?: unknown;
    overrides?: unknown;
    keys?: unknown;
    section?: string;
    versionId?: string;
  };
  if (Array.isArray(raw.cases)) {
    return raw.cases as GradingCase[];
  }
  if (raw.examState && raw.answers) {
    return [{
      id: path,
      submissionId: path,
      scheduleId: path,
      released: false,
      section: (raw.section as Section | undefined) ?? 'reading',
      versionId: raw.versionId ?? 'fixture',
      examState: raw.examState as ExamState,
      answers: raw.answers as Record<string, StudentAnswerValue | undefined>,
      keys: (raw.keys as Record<string, string> | undefined) ?? {},
      overrides: (raw.overrides as Record<string, unknown> | undefined) ?? {},
      savedResults: [],
    }];
  }
  throw new Error(`Fixture ${path} has neither a cases array nor examState + answers.`);
}

async function loadDatabaseCases(databaseUrl: string): Promise<GradingCase[]> {
  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection(databaseUrl);
  try {
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.beginTransaction();

    const [overrideRows] = await connection.query(
      `SELECT schedule_id, question_id, override_json
         FROM grading_schedule_question_overrides`,
    );
    const overridesBySchedule = new Map<string, Record<string, unknown>>();
    for (const row of overrideRows as Array<Record<string, unknown>>) {
      const scheduleId = String(row['schedule_id']);
      const map = overridesBySchedule.get(scheduleId) ?? {};
      map[String(row['question_id'])] = parseJson(row['override_json'], {});
      overridesBySchedule.set(scheduleId, map);
    }

    const [sourceRows] = await connection.query(
      `SELECT schedule_id, source, version_id FROM grading_schedule_objective_grading_source`,
    );
    const draftBySchedule = new Map<string, string>();
    for (const row of sourceRows as Array<Record<string, unknown>>) {
      const source = String(row['source'] ?? '');
      const versionId = row['version_id'] === null ? '' : String(row['version_id'] ?? '');
      if (source === 'draft_version' && versionId) {
        draftBySchedule.set(String(row['schedule_id']), versionId);
      }
    }

    const [versionRows] = await connection.query(
      `SELECT id, CAST(content_snapshot AS CHAR) AS content
         FROM exam_versions`,
    );
    const contentByVersion = new Map<string, ExamState>();
    for (const row of versionRows as Array<Record<string, unknown>>) {
      contentByVersion.set(String(row['id']), parseJson<ExamState>(row['content'], {} as ExamState));
    }

    const [keyRows] = await connection.query(
      `SELECT s.exam_version_id, eq.question_id, CAST(qr.answer_definition AS CHAR) AS answer_definition
         FROM assessment_exam_questions eq
         JOIN assessment_modules m ON m.id = eq.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
        WHERE s.section_key IN ('listening', 'reading')`,
    );
    const keysByVersion = new Map<string, Record<string, string>>();
    for (const row of keyRows as Array<Record<string, unknown>>) {
      const versionId = String(row['exam_version_id']);
      const map = keysByVersion.get(versionId) ?? {};
      map[String(row['question_id'])] = String(row['answer_definition'] ?? '');
      keysByVersion.set(versionId, map);
    }

    const [rows] = await connection.query(
      `SELECT s.id, s.schedule_id, s.published_version_id, s.grading_status,
              sec.section, CAST(sec.answers AS CHAR) AS answers,
              CAST(sec.auto_grading_results AS CHAR) AS auto_results
         FROM student_submissions s
         JOIN student_attempts a ON a.id = s.attempt_id
           AND a.terminal_generation = s.terminal_generation
           AND a.submitted_at IS NOT NULL
         JOIN section_submissions sec ON sec.submission_id = s.id
        WHERE s.provider_key = 'ielts'
          AND sec.section IN ('listening', 'reading')
        ORDER BY s.id, sec.section`,
    );

    const cases: GradingCase[] = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const scheduleId = String(row['schedule_id']);
      const publishedVersionId = String(row['published_version_id'] ?? '');
      const versionId = draftBySchedule.get(scheduleId) ?? publishedVersionId;
      const examState = contentByVersion.get(versionId);
      if (!examState) continue;
      const saved = parseJson<{ questionResults?: SavedQuestionResult[] }>(row['auto_results'], {});
      cases.push({
        id: `${String(row['id'])}:${String(row['section'])}`,
        submissionId: String(row['id']),
        scheduleId,
        released: String(row['grading_status'] ?? '') === 'released',
        section: String(row['section']) as Section,
        versionId,
        examState,
        answers: readAnswerMap(parseJson(row['answers'], {})),
        keys: keysByVersion.get(versionId) ?? {},
        overrides: overridesBySchedule.get(scheduleId) ?? {},
        savedResults: saved.questionResults ?? [],
      });
    }

    await connection.rollback();
    return cases;
  } finally {
    await connection.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let cases: GradingCase[];
  let mode: ParityReport['mode'];
  if (args.fixture) {
    mode = 'fixture';
    cases = loadFixture(resolve(REPO_ROOT, args.fixture));
  } else if (args.databaseUrl) {
    mode = 'database';
    if (args.databaseUrl.includes('ielts_prod_clone')) {
      throw new Error(
        'Refusing to run against the production clone. Point --database-url at a dedicated parity database.',
      );
    }
    cases = await loadDatabaseCases(args.databaseUrl);
  } else {
    throw new Error('Pass --fixture <path> or --database-url <url>.');
  }

  const inputs: GoParityInput[] = cases.map((testCase) => ({
    section: testCase.section,
    content: testCase.examState,
    answers: testCase.answers as Record<string, unknown>,
    keys: testCase.keys ?? {},
    overrides: testCase.overrides ?? {},
    versionId: testCase.versionId,
  }));
  const goResults = await runGoGrader(inputs);
  const mismatches = cases.flatMap((testCase, index) => {
    const result = goResults[index];
    if (!result) {
      throw new Error(`Go grader returned no result for case ${testCase.id}.`);
    }
    return compareCase(testCase, result);
  });
  const report = buildReport(mode, args.label, cases, mismatches);
  const serialized = JSON.stringify(report, null, 2);
  if (args.out) {
    const outPath = resolve(REPO_ROOT, args.out);
    writeFileSync(outPath, serialized + '\n');
  }
  process.stdout.write(serialized + '\n');
  if (!args.json) {
    process.stderr.write(
      `parity ${report.label}: ${report.summary.mismatches} mismatches across ` +
        `${report.summary.affectedStudents} students / ${report.summary.affectedQuestions} questions ` +
        `(released ${report.summary.mismatchesReleased}, unreleased ${report.summary.mismatchesUnreleased})\n`,
    );
  }
  if (!existsSync(resolve(REPO_ROOT, 'testdata/objective-grading-parity'))) {
    process.stderr.write('warning: parity testdata directory is missing\n');
  }
  if (args.failOnMismatch && report.summary.mismatches > 0) {
    process.exitCode = 1;
  }
}

await main();
