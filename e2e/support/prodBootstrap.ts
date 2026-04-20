import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createInitialExamState } from '../../src/services/examAdapterService';
import type { ExamState } from '../../src/types';
import { pollUntil } from './prodOrchestration';

export interface BootstrapResult {
  examId: string;
  scheduleId: string;
  publishedVersionId: string;
}

function requireBootstrapConsent() {
  if (process.env['E2E_PROD_ALLOW_BOOTSTRAP'] === 'true') {
    return;
  }

  throw new Error(
    [
      'Refusing to bootstrap exam/schedule on remote environment.',
      'This creates real exams + schedules in the target database.',
      '',
      'If and only if this is a dedicated E2E tenant with no real-user impact, re-run with:',
      '  E2E_PROD_ALLOW_BOOTSTRAP=true',
    ].join('\n'),
  );
}

function nowPlusMinutesIso(minutes: number): string {
  const ts = new Date(Date.now() + minutes * 60_000);
  return ts.toISOString();
}

function minutesBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, Math.round((end - start) / 60_000));
}

function addShortAnswerBlock(state: ExamState, opts: { module: 'reading' | 'listening'; index: number }) {
  const instruction = 'Answer the questions. Write NO MORE THAN TWO WORDS.';
  const questions = [
    {
      id: `q-${opts.module}-${opts.index}-1`,
      prompt: 'According to the passage, what began in Britain in the late 18th century?',
      correctAnswer: 'Industrial Revolution',
      answerRule: 'EXACT' as const,
    },
    {
      id: `q-${opts.module}-${opts.index}-2`,
      prompt: 'Write one key factor mentioned.',
      correctAnswer: 'technology',
      answerRule: 'CONTAINS' as const,
    },
  ];

  const block = {
    id: `b-${opts.module}-${opts.index}-1`,
    type: 'SHORT_ANSWER' as const,
    instruction,
    questions,
  };

  if (opts.module === 'reading') {
    const passage = state.reading.passages[opts.index];
    if (!passage) return;
    passage.content ||= `IELTS Reading passage ${opts.index + 1}. ` + 'Sample content. '.repeat(80);
    passage.blocks = [block];
  } else {
    const part = state.listening.parts[opts.index];
    if (!part) return;
    part.blocks = [block];
  }
}

export function buildIeltsLikeState(params: { title: string; preset: 'Academic' | 'General Training' }) {
  const base = createInitialExamState(params.title, 'Academic', params.preset);

  // Match IELTS structure; explicitly skip speaking.
  base.config.sections.speaking.enabled = false;
  base.config.sections.listening.enabled = true;
  base.config.sections.reading.enabled = true;
  base.config.sections.writing.enabled = true;

  // Ensure ordering: Listening -> Reading -> Writing.
  base.config.sections.listening.order = 0;
  base.config.sections.reading.order = 1;
  base.config.sections.writing.order = 2;
  base.config.sections.speaking.order = 3;

  // Ensure real IELTS module counts.
  base.config.sections.listening.partCount = 4;
  base.config.sections.reading.passageCount = 3;

  // Ensure durations look like IELTS (students can still submit early).
  base.config.sections.listening.duration = 30;
  base.config.sections.reading.duration = 60;
  base.config.sections.writing.duration = 60;

  // Expand parts/passages arrays to match config.
  while (base.listening.parts.length < 4) {
    base.listening.parts.push({
      id: `l${base.listening.parts.length + 1}`,
      title: `Part ${base.listening.parts.length + 1}`,
      pins: [],
      blocks: [],
    });
  }
  base.listening.parts = base.listening.parts.slice(0, 4);

  while (base.reading.passages.length < 3) {
    base.reading.passages.push({
      id: `p${base.reading.passages.length + 1}`,
      title: `Passage ${base.reading.passages.length + 1}`,
      content: '',
      blocks: [],
      images: [],
      wordCount: 0,
    });
  }
  base.reading.passages = base.reading.passages.slice(0, 3);

  // Fill required content + minimal valid blocks for publish validation.
  for (let idx = 0; idx < 3; idx += 1) {
    addShortAnswerBlock(base, { module: 'reading', index: idx });
  }
  for (let idx = 0; idx < 4; idx += 1) {
    addShortAnswerBlock(base, { module: 'listening', index: idx });
  }

  return base;
}

async function getExamEntity(request: APIRequestContext, examId: string) {
  const resp = await request.get(`/api/v1/exams/${examId}`);
  if (!resp.ok()) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GET /api/v1/exams/${examId} failed: ${resp.status()} ${body.slice(0, 300)}`);
  }
  return (await resp.json()) as any;
}

export async function bootstrapExamAndSchedule(params: {
  request: APIRequestContext;
  page: Page;
  runId: string;
  institution?: string;
  startOffsetMinutes?: number;
}): Promise<BootstrapResult> {
  requireBootstrapConsent();

  const csrfCookieName = process.env['AUTH_CSRF_COOKIE_NAME'];
  const candidates = [
    typeof csrfCookieName === 'string' && csrfCookieName.length > 0 ? csrfCookieName : null,
    '__Host-csrf',
    'csrf',
  ].filter((value): value is string => Boolean(value));

  const cookies = await params.page.context().cookies();
  const csrfCookie = cookies.find((cookie) => candidates.includes(cookie.name));
  const csrfToken = csrfCookie?.value ?? '';
  if (!csrfToken) {
    throw new Error(
      `Missing CSRF cookie after login (looked for: ${candidates.join(', ')}). ` +
        'Cannot bootstrap via API without x-csrf-token.',
    );
  }

  const csrfHeaders = { 'x-csrf-token': csrfToken };

  const title = `IELTS LRW (No Speaking) - ${params.runId}`;
  const slug = `ielts-lrw-${params.runId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');

  const create = await params.request.post('/api/v1/exams', {
    headers: csrfHeaders,
    data: {
      slug,
      title,
      examType: 'Academic',
      visibility: 'organization',
    },
  });

  if (!create.ok()) {
    const body = await create.text().catch(() => '');
    throw new Error(`Failed to create exam: ${create.status()} ${body.slice(0, 300)}`);
  }

  const created = (await create.json()) as any;
  const examId = String(created?.data?.id ?? created?.id ?? '');
  if (!examId) {
    throw new Error('Create exam response missing exam id.');
  }

  const state = buildIeltsLikeState({ title, preset: 'Academic' });

  // Save draft (requires exam revision).
  const entityAfterCreate = await getExamEntity(params.request, examId);
  const revision = Number(entityAfterCreate?.data?.revision ?? entityAfterCreate?.revision ?? 0);

  const saveDraft = await params.request.patch(`/api/v1/exams/${examId}/draft`, {
    headers: csrfHeaders,
    data: {
      contentSnapshot: state,
      configSnapshot: state.config,
      revision,
    },
  });
  if (!saveDraft.ok()) {
    const body = await saveDraft.text().catch(() => '');
    throw new Error(`Failed to save draft: ${saveDraft.status()} ${body.slice(0, 300)}`);
  }

  // Publish (needs latest exam revision).
  const entityAfterDraft = await getExamEntity(params.request, examId);
  const publishRevision = Number(entityAfterDraft?.data?.revision ?? entityAfterDraft?.revision ?? 0);

  const publish = await params.request.post(`/api/v1/exams/${examId}/publish`, {
    headers: csrfHeaders,
    data: {
      publishNotes: `Automated prod load bootstrap ${params.runId}`,
      revision: publishRevision,
    },
  });
  if (!publish.ok()) {
    const body = await publish.text().catch(() => '');
    throw new Error(`Failed to publish exam: ${publish.status()} ${body.slice(0, 300)}`);
  }

  const publishedEntity = await pollUntil(
    async () => {
      const entity = await getExamEntity(params.request, examId);
      const exam = entity?.data ?? entity;
      const status = String(exam?.status ?? '');
      const publishedVersionId = String(exam?.currentPublishedVersionId ?? '');
      if (status !== 'published' || !publishedVersionId) {
        throw new Error(`status=${status} publishedVersionId=${publishedVersionId}`);
      }
      return { publishedVersionId };
    },
    { timeoutMs: 60_000, intervalMs: 2000, description: 'wait exam publish' },
  );

  const startOffset = params.startOffsetMinutes ?? 10;
  const startTime = nowPlusMinutesIso(startOffset);

  // Create an ample window; server will validate it against planned duration.
  const endTime = nowPlusMinutesIso(startOffset + 4 * 60);
  if (minutesBetween(startTime, endTime) < 120) {
    throw new Error('Schedule window too short for IELTS-like exam.');
  }

  const scheduleResp = await params.request.post('/api/v1/schedules', {
    headers: csrfHeaders,
    data: {
      examId,
      publishedVersionId: publishedEntity.publishedVersionId,
      cohortName: `E2E ${params.runId}`,
      institution: params.institution ?? 'E2E',
      startTime,
      endTime,
      autoStart: false,
      autoStop: false,
    },
  });
  if (!scheduleResp.ok()) {
    const body = await scheduleResp.text().catch(() => '');
    throw new Error(`Failed to create schedule: ${scheduleResp.status()} ${body.slice(0, 300)}`);
  }

  const scheduleJson = (await scheduleResp.json()) as any;
  const scheduleId = String(scheduleJson?.data?.id ?? scheduleJson?.id ?? '');
  if (!scheduleId) {
    throw new Error('Create schedule response missing schedule id.');
  }

  return {
    examId,
    scheduleId,
    publishedVersionId: publishedEntity.publishedVersionId,
  };
}

export async function writeProdRuntimeOverride(params: {
  outputPath: string;
  baseURL: string;
  examId: string;
  scheduleId: string;
}) {
  const resolved = path.resolve(process.cwd(), params.outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(
    resolved,
    JSON.stringify(
      {
        baseURL: params.baseURL,
        examId: params.examId,
        scheduleId: params.scheduleId,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
