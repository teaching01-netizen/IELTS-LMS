import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState, getExamStateFromEntity } from '../examAdapterService';
import { examRepository } from '../examRepository';
import { ExamLifecycleService } from '../examLifecycleService';
import type { SingleMCQBlock } from '../../types';

const response = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200, headers: { 'content-type': 'application/json' },
});

afterEach(() => vi.unstubAllGlobals());

describe('draft persistence across builder and publish navigation', () => {
  it.each(['ielts', 'act'] as const)('reloads saved %s questions from the same draft version', async (providerKey) => {
    const repository = examRepository;
    const lifecycle = new ExamLifecycleService(repository);
    const initial = createInitialExamState('Navigation test', providerKey === 'act' ? 'ACT' : 'Academic');
    const exam = {
      id: `navigation-${providerKey}`, slug: `navigation-${providerKey}`, title: initial.title,
      providerKey, examType: initial.type, status: 'draft', visibility: 'private', ownerId: 'builder',
      currentDraftVersionId: `same-draft-${providerKey}`, currentPublishedVersionId: null,
      createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z', revision: 0,
    };
    let version = {
      id: `same-draft-${providerKey}`, examId: exam.id, versionNumber: 1, revision: 0,
      contentSnapshot: initial, configSnapshot: initial.config, isDraft: true, isPublished: false,
      createdAt: exam.createdAt, createdBy: 'builder',
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/v1/exams/${exam.id}/draft` && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string);
        version = { ...version, ...body, revision: version.revision + 1 };
        exam.revision++;
        return response(version);
      }
      if (url === `/api/v1/exams/${exam.id}`) return response(exam);
      if (url === `/api/v1/versions/${version.id}`) return response(version);
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }));

    const entity = (await repository.getExamById(exam.id))!;
    const loaded = await getExamStateFromEntity(entity, repository);
    const edited = structuredClone(loaded);
    const question: SingleMCQBlock = {
      id: 'new-question', type: 'SINGLE_MCQ', instruction: 'Choose one answer',
      stem: 'Which result supports the conclusion?',
      options: [{ id: 'a', text: 'First result', isCorrect: true }, { id: 'b', text: 'Second result', isCorrect: false }],
    };
    question.questions = [{ id: question.id, stem: question.stem, options: question.options }];
    if (providerKey === 'act') {
      edited.science.stimuli.push({ id: 'new-stimulus', title: 'Experiment', content: 'New experiment', blocks: [question] });
    } else {
      edited.reading.passages[0]!.blocks.push(question);
    }
    const saved = await lifecycle.saveDraft(exam.id, edited, 'builder');
    expect(saved.success, saved.error).toBe(true);
    expect(version.contentSnapshot).toEqual(edited);

    // Publish-page reads and returning to the builder share this repository.
    const publishState = await getExamStateFromEntity(entity, repository);
    const returnedState = await getExamStateFromEntity(entity, repository);
    const blocks = (state: typeof edited) => providerKey === 'act'
      ? state.science.stimuli.flatMap(stimulus => stimulus.blocks) : state.reading.passages[0]!.blocks;
    expect(blocks(publishState)).toEqual(blocks(edited));
    expect(blocks(returnedState)).toEqual(blocks(edited));
  });
});
