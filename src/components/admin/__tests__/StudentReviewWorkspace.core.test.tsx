import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../services/gradingRepository', () => {
  return {
    gradingRepository: {
      getSubmissionById: vi.fn(),
      getSectionSubmissionsBySubmissionId: vi.fn(),
      invalidateSubmissionBundle: vi.fn(),
      getWritingSubmissionsBySubmissionId: vi.fn(),
      getReviewDraftBySubmission: vi.fn(),
    },
  };
});

vi.mock('../../../services/examRepository', () => {
  return {
    examRepository: {
      getVersionById: vi.fn(),
    },
  };
});

vi.mock('../../../services/gradingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/gradingService')>();

  return {
    // The pure formatter is not worth faking: keeping the real one means the
    // alert copy exercised here cannot drift from the shipped helper.
    gradingErrorMessage: actual.gradingErrorMessage,
    gradingService: {
      startReview: vi.fn(),
      saveReviewDraft: vi.fn(),
      markGradingComplete: vi.fn(),
      markReadyToRelease: vi.fn(),
      releaseResult: vi.fn(),
      scheduleRelease: vi.fn(),
      reopenReview: vi.fn(),
      overrideObjectiveQuestion: vi.fn(),
      getObjectiveGradingSource: vi.fn().mockResolvedValue({ success: false }),
    },
  };
});

// Sparingly mocked heavy child: the annotation canvas is driven through its
// add/update/delete callbacks so annotation + drawing state branches are covered
// without simulating text selection inside the real canvas.
vi.mock('../WritingAnnotationCanvas', async () => {
  const React = await import('react');
  const stamp = '2026-01-01T00:00:00.000Z';
  const makeAnnotation = (taskId: string) => ({
    id: 'a1',
    taskId,
    type: 'highlight',
    startOffset: 0,
    endOffset: 5,
    selectedText: 'hello',
    comment: 'needs work',
    visibility: 'student_visible',
    createdBy: 't-1',
    createdAt: stamp,
  });
  const makeDrawing = (taskId: string) => ({
    id: 'd1',
    taskId,
    type: 'freehand_draw',
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
    ],
    color: '#ff0000',
    strokeWidth: 2,
    visibility: 'student_visible',
    createdBy: 't-1',
    createdAt: stamp,
  });
  return {
    WritingAnnotationCanvas: (props: any) =>
      React.createElement(
        'div',
        { 'data-testid': `canvas-${props.taskId}` },
        React.createElement(
          'button',
          { type: 'button', onClick: () => props.onAnnotationAdd(makeAnnotation(props.taskId)) },
          'add-annotation',
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () =>
              props.onAnnotationUpdate({ ...makeAnnotation(props.taskId), comment: 'updated comment' }),
          },
          'update-annotation',
        ),
        React.createElement(
          'button',
          { type: 'button', onClick: () => props.onAnnotationDelete('a1') },
          'delete-annotation',
        ),
        React.createElement(
          'button',
          { type: 'button', onClick: () => props.onDrawingAdd(makeDrawing(props.taskId)) },
          'add-drawing',
        ),
        React.createElement(
          'button',
          { type: 'button', onClick: () => props.onDrawingDelete('d1') },
          'delete-drawing',
        ),
      ),
  };
});

import { StudentReviewWorkspace } from '../StudentReviewWorkspace';
import { createInitialExamState } from '../../../services/examAdapterService';
import { examRepository } from '../../../services/examRepository';
import { gradingRepository } from '../../../services/gradingRepository';
import { gradingService } from '../../../services/gradingService';

const isoNow = () => new Date().toISOString();

function makeSubmission(overrides: Record<string, any> = {}) {
  return {
    id: 'sub-1',
    submissionId: 'sub-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    publishedVersionId: 'ver-1',
    studentId: 'stu-1',
    studentName: 'Alice',
    studentEmail: 'alice@example.com',
    cohortName: 'Cohort',
    submittedAt: isoNow(),
    timeSpentSeconds: 0,
    gradingStatus: 'submitted',
    assignedTeacherId: undefined,
    assignedTeacherName: undefined,
    isFlagged: false,
    flagReason: undefined,
    isOverdue: false,
    dueDate: undefined,
    sectionStatuses: {
      listening: 'pending',
      reading: 'auto_graded',
      writing: 'needs_review',
      speaking: 'pending',
    },
    createdAt: isoNow(),
    updatedAt: isoNow(),
    ...overrides,
  };
}

function makeChecklist(overrides: Record<string, boolean> = {}) {
  return {
    listeningReviewed: false,
    readingReviewed: false,
    writingTask1Reviewed: false,
    writingTask2Reviewed: false,
    speakingReviewed: false,
    overallFeedbackWritten: false,
    rubricComplete: false,
    annotationsComplete: false,
    ...overrides,
  };
}

function makeDraft(overrides: Record<string, any> = {}) {
  return {
    id: 'draft-1',
    submissionId: 'sub-1',
    studentId: 'stu-1',
    teacherId: 't-1',
    releaseStatus: 'draft',
    sectionDrafts: {},
    annotations: [],
    drawings: [],
    overallFeedback: undefined,
    studentVisibleNotes: undefined,
    internalNotes: undefined,
    teacherSummary: { strengths: [], improvementPriorities: [], recommendedPractice: [] },
    checklist: makeChecklist(),
    hasUnsavedChanges: false,
    lastAutoSaveAt: undefined,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    ...overrides,
  };
}

function makeWriting(taskId: 'task1' | 'task2') {
  return {
    id: `write-${taskId}`,
    submissionId: 'sub-1',
    taskId,
    taskLabel: taskId === 'task1' ? 'Task 1' : 'Task 2',
    prompt: taskId === 'task1' ? 'Prompt one.' : 'Prompt two.',
    studentText: taskId === 'task1' ? 'First response text here.' : 'Second response text here.',
    wordCount: 4,
    rubricAssessment: undefined,
    annotations: [],
    overallFeedback: undefined,
    studentVisibleNotes: undefined,
    gradingStatus: 'needs_review',
    submittedAt: isoNow(),
    gradedBy: undefined,
    gradedAt: undefined,
  };
}

function makeExamState() {
  const examState = createInitialExamState('Exam', 'Academic');
  (examState as any).reading.passages = [];
  (examState as any).writing.tasks = [
    { taskId: 'task1', prompt: 'Prompt one.' },
    { taskId: 'task2', prompt: 'Prompt two.' },
  ];
  return examState;
}

function seedWorkspace(
  options: {
    submission?: any;
    draft?: any;
    sections?: any[];
    sectionsError?: string;
    writings?: any[];
  } = {},
) {
  const examState = makeExamState();
  vi.mocked(examRepository.getVersionById).mockResolvedValue({
    id: 'ver-1',
    contentSnapshot: examState,
  } as any);
  vi.mocked(gradingRepository.getSubmissionById).mockResolvedValue(
    options.submission ?? makeSubmission(),
  );
  if (options.sectionsError) {
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockRejectedValue(
      new Error(options.sectionsError),
    );
  } else {
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue(
      options.sections ?? [],
    );
  }
  vi.mocked(gradingRepository.getWritingSubmissionsBySubmissionId).mockResolvedValue(
    options.writings ?? [makeWriting('task1'), makeWriting('task2')],
  );
  vi.mocked(gradingRepository.getReviewDraftBySubmission).mockResolvedValue(
    options.draft === undefined ? makeDraft() : options.draft,
  );
  vi.mocked(gradingService.saveReviewDraft).mockImplementation(async (draft: any) => ({
    success: true,
    data: { ...draft, hasUnsavedChanges: false },
  }));
}

function renderWorkspace(props: Record<string, any> = {}) {
  return render(
    <StudentReviewWorkspace
      submissionId="sub-1"
      onBack={() => {}}
      currentTeacherId="t-1"
      currentTeacherName="Teacher"
      {...props}
    />,
  );
}

const saveButton = () => screen.getByRole('button', { name: /save draft/i });

async function openWritingSection() {
  fireEvent.click(screen.getByRole('button', { name: /^writing$/i }));
  await screen.findByTestId('canvas-task1');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StudentReviewWorkspace core render', () => {
  test('renders header, section navigation, checklist and disabled save with minimal props', async () => {
    seedWorkspace();
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Grading Checklist' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Release Workflow' })).toBeInTheDocument();
    for (const section of ['listening', 'reading', 'writing', 'speaking'] as const) {
      expect(
        screen.getByRole('button', { name: new RegExp('^' + section + '$', 'i') }),
      ).toBeInTheDocument();
    }
    expect(saveButton()).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /mark grading complete/i }),
    ).toBeInTheDocument();
  });

  test('shows a loading skeleton while the submission is pending', async () => {
    seedWorkspace();
    vi.mocked(gradingRepository.getSubmissionById).mockImplementation(
      () => new Promise<any>(() => {}),
    );
    renderWorkspace();

    expect(await screen.findByText('Loading review workspace...')).toBeInTheDocument();
  });

  test('starts a review when no draft exists yet', async () => {
    seedWorkspace({ draft: null });
    vi.mocked(gradingService.startReview).mockResolvedValue({
      success: true,
      data: makeDraft(),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(gradingService.startReview).toHaveBeenCalledWith('sub-1', 't-1', 'Teacher');
    });
    expect(await screen.findByText('Grading Checklist')).toBeInTheDocument();
    expect(
      await screen.findByRole('checkbox', { name: /reading reviewed/i }),
    ).toBeInTheDocument();
  });

  test('wires back and student navigation handlers', async () => {
    seedWorkspace();
    const onBack = vi.fn();
    const onNextStudent = vi.fn();
    const onPreviousStudent = vi.fn();
    renderWorkspace({ onBack, onNextStudent, onPreviousStudent });

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: /next student/i }));
    fireEvent.click(screen.getByRole('button', { name: /previous student/i }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNextStudent).toHaveBeenCalledTimes(1);
    expect(onPreviousStudent).toHaveBeenCalledTimes(1);
  });

  test('disables student navigation without handlers', async () => {
    seedWorkspace();
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous student/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next student/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^previous$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });
});

describe('StudentReviewWorkspace section navigation', () => {
  test('switches to the writing canvas and between task tabs', async () => {
    seedWorkspace();
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    await openWritingSection();

    // Prompts also render in the hidden print root, so expect duplicates.
    expect((await screen.findAllByText('Prompt one.')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /task 2/i }));
    expect(await screen.findByTestId('canvas-task2')).toBeInTheDocument();
    expect((await screen.findAllByText('Prompt two.')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('canvas-task1')).not.toBeInTheDocument();
  });

  test('shows the speaking placeholder and listening header', async () => {
    seedWorkspace();
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^speaking$/i }));
    expect(await screen.findByText('Speaking Assessment')).toBeInTheDocument();
    expect(screen.getByText(/deferred until recording/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^listening$/i }));
    expect(await screen.findByRole('heading', { name: /^listening$/i })).toBeInTheDocument();
  });

  test('surfaces section load failure with a working retry', async () => {
    seedWorkspace({ sectionsError: 'sections boom' });
    renderWorkspace();

    expect(await screen.findByText('sections boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));

    await waitFor(() => {
      expect(gradingRepository.getSubmissionById).toHaveBeenCalledTimes(2);
    });
  });
});

describe('StudentReviewWorkspace annotation and review actions', () => {
  test('adds, updates and deletes annotations and drawings, deduping repeats', async () => {
    seedWorkspace();
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    await openWritingSection();
    const save = vi.mocked(gradingService.saveReviewDraft);

    fireEvent.click(screen.getByRole('button', { name: 'add-annotation' }));
    fireEvent.click(screen.getByRole('button', { name: 'add-drawing' }));
    fireEvent.click(screen.getByRole('button', { name: 'add-drawing' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const firstPayload = save.mock.calls[0]?.[0] as any;
    expect(firstPayload.annotations.map((a: any) => a.id)).toEqual(['a1']);
    expect(firstPayload.drawings.map((d: any) => d.id)).toEqual(['d1']);

    fireEvent.click(screen.getByRole('button', { name: 'update-annotation' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const secondPayload = save.mock.calls[1]?.[0] as any;
    expect(secondPayload.annotations[0].comment).toBe('updated comment');

    fireEvent.click(screen.getByRole('button', { name: 'delete-annotation' }));
    fireEvent.click(screen.getByRole('button', { name: 'delete-drawing' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    const thirdPayload = save.mock.calls[2]?.[0] as any;
    expect(thirdPayload.annotations).toEqual([]);
    expect(thirdPayload.drawings).toEqual([]);
  });

  test('edits writing rubric bands and notes, then persists them via save', async () => {
    seedWorkspace();
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    await openWritingSection();

    const bandInputs = await screen.findAllByPlaceholderText('0-9');
    expect(bandInputs).toHaveLength(4);
    fireEvent.change(bandInputs[0]!, { target: { value: '6.5' } });
    fireEvent.change(screen.getAllByPlaceholderText('Notes...')[0]!, {
      target: { value: 'TR note' },
    });

    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());

    const save = vi.mocked(gradingService.saveReviewDraft);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionDrafts: expect.objectContaining({
          writing: expect.objectContaining({
            task1: expect.objectContaining({
              taskResponseBand: 6.5,
              taskResponseNotes: 'TR note',
            }),
          }),
        }),
      }),
      't-1',
      'Teacher',
    );
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  test('edits feedback, internal notes, teacher summary and checklist, then saves', async () => {
    seedWorkspace();
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText('Summary feedback visible to student...'),
      { target: { value: 'Great effort overall' } },
    );
    fireEvent.change(
      screen.getByPlaceholderText('Private grader notes (not visible to student)...'),
      { target: { value: 'Check task 2 again' } },
    );
    fireEvent.change(screen.getByPlaceholderText('List strengths (one per line)'), {
      target: { value: 'clear structure\ngood vocab' },
    });
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /reading reviewed/i }),
    );

    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());

    const save = vi.mocked(gradingService.saveReviewDraft);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        overallFeedback: 'Great effort overall',
        internalNotes: 'Check task 2 again',
        teacherSummary: expect.objectContaining({
          strengths: ['clear structure', 'good vocab'],
        }),
        checklist: expect.objectContaining({ readingReviewed: true }),
      }),
      't-1',
      'Teacher',
    );
  });
});

describe('StudentReviewWorkspace save and release flows', () => {
  test('mark grading complete advances a draft to grading complete', async () => {
    seedWorkspace();
    vi.mocked(gradingService.markGradingComplete).mockResolvedValue({
      success: true,
      data: makeDraft({ releaseStatus: 'grading_complete' }),
    });
    renderWorkspace();

    fireEvent.click(
      await screen.findByRole('button', { name: /mark grading complete/i }),
    );

    await waitFor(() => {
      expect(gradingService.markGradingComplete).toHaveBeenCalledWith(
        'sub-1',
        't-1',
        'Teacher',
      );
    });
    expect(
      await screen.findByRole('button', { name: /mark ready to release/i }),
    ).toBeInTheDocument();
  });

  test('mark grading complete surfaces backend errors', async () => {
    seedWorkspace();
    vi.mocked(gradingService.markGradingComplete).mockResolvedValue({
      success: false,
      error: 'complete boom',
    });
    renderWorkspace();

    fireEvent.click(
      await screen.findByRole('button', { name: /mark grading complete/i }),
    );

    expect(await screen.findByText('complete boom')).toBeInTheDocument();
  });

  test('mark ready to release advances to ready to release', async () => {
    seedWorkspace({ draft: makeDraft({ releaseStatus: 'grading_complete' }) });
    vi.mocked(gradingService.markReadyToRelease).mockResolvedValue({
      success: true,
      data: makeDraft({ releaseStatus: 'ready_to_release' }),
    });
    renderWorkspace();

    fireEvent.click(
      await screen.findByRole('button', { name: /mark ready to release/i }),
    );

    await waitFor(() => {
      expect(gradingService.markReadyToRelease).toHaveBeenCalledWith(
        'sub-1',
        't-1',
        'Teacher',
      );
    });
    expect(
      await screen.findByRole('button', { name: /release now/i }),
    ).toBeInTheDocument();
  });

  test('release now reloads the workspace on success', async () => {
    seedWorkspace({ draft: makeDraft({ releaseStatus: 'ready_to_release' }) });
    vi.mocked(gradingService.releaseResult).mockResolvedValue({
      success: true,
      data: { id: 'result-1' },
    });
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: /release now/i }));

    await waitFor(() => {
      expect(gradingService.releaseResult).toHaveBeenCalledWith(
        'sub-1',
        't-1',
        'Teacher',
        false,
      );
      expect(gradingRepository.getSubmissionById).toHaveBeenCalledTimes(2);
    });
  });

  test('release now shows generic errors without an override dialog', async () => {
    seedWorkspace({ draft: makeDraft({ releaseStatus: 'ready_to_release' }) });
    vi.mocked(gradingService.releaseResult).mockResolvedValue({
      success: false,
      error: 'release kaput',
    });
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: /release now/i }));

    expect(await screen.findByText('release kaput')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('reopen returns a released result to an editable state', async () => {
    seedWorkspace({ draft: makeDraft({ releaseStatus: 'released' }) });
    vi.mocked(gradingService.reopenReview).mockResolvedValue({
      success: true,
      data: makeDraft({ releaseStatus: 'reopened' }),
    });
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: /reopen result/i }));

    await waitFor(() => {
      expect(gradingService.reopenReview).toHaveBeenCalledWith(
        'sub-1',
        't-1',
        'Teacher',
        'Manual reopen',
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /reopen result/i }),
      ).not.toBeInTheDocument();
    });
  });

  test('disables release actions for an unknown grader', async () => {
    seedWorkspace();
    renderWorkspace({ releaseActionsDisabled: true });

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    expect(await screen.findByText(/unknown grader/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /mark grading complete/i }),
    ).toBeDisabled();
  });
});
