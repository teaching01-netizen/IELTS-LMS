import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExamSettingsDrawer } from '../ExamSettingsDrawer';
import { DEFAULT_LISTENING_BAND_TABLE, createDefaultConfig } from '../../../constants/examDefaults';
import { ExamEntity, ExamVersion, PublishReadiness } from '../../../types/domain';

function makeExam(overrides: Partial<ExamEntity> = {}): ExamEntity {
  return {
    id: 'exam-1',
    slug: 'academic-exam-1',
    title: 'Academic Exam 1',
    type: 'Academic',
    status: 'draft',
    visibility: 'private',
    owner: 'Admin User',
    createdAt: '2026-04-15T08:00:00.000Z',
    updatedAt: '2026-04-16T08:00:00.000Z',
    currentDraftVersionId: 'draft-1',
    currentPublishedVersionId: null,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeReadiness(overrides: Partial<PublishReadiness> = {}): PublishReadiness {
  return {
    canPublish: true,
    errors: [],
    warnings: [],
    missingFields: [],
    questionCounts: { reading: 40, listening: 40, total: 80 },
    ...overrides,
  };
}

function makeExamVersion(overrides: Partial<ExamVersion> = {}): ExamVersion {
  return {
    id: 'version-3',
    examId: 'exam-1',
    versionNumber: 3,
    parentVersionId: 'version-2',
    contentSnapshot: {} as unknown as ExamVersion['contentSnapshot'],
    configSnapshot: createDefaultConfig('Academic', 'Academic'),
    createdBy: 'Admin User',
    createdAt: '2026-04-16T08:00:00.000Z',
    isDraft: true,
    isPublished: false,
    ...overrides,
  };
}

describe('ExamSettingsDrawer timing validation', () => {
  it('shows section flow validation errors for invalid timing config', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.sections.listening.order = 0;
    config.sections.reading.order = 0;
    config.sections.listening.duration = 0;
    config.sections.reading.gapAfterMinutes = -1;

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Timing'));

    expect(screen.getByText('Section Flow')).toBeTruthy();
    expect(screen.getByText('Listening duration must be greater than 0.')).toBeTruthy();
    expect(screen.getByText('Reading gap cannot be negative.')).toBeTruthy();
    expect(screen.getByText('Duplicate section order 0 detected.')).toBeTruthy();
    expect(screen.getByText('Actual clock times are derived from session start.')).toBeTruthy();
  });
});

describe('ExamSettingsDrawer standards tab', () => {
  it('updates standards and keeps writing section tasks synced', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Standards'));
    fireEvent.change(screen.getByLabelText('Task 1 minimum words'), {
      target: { value: '180' },
    });

    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.standards.writingTasks.task1.minWords).toBe(180);
    expect(nextConfig.sections.writing.tasks[0].minWords).toBe(180);
  });

  it('resets custom band tables to official IELTS defaults', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.standards.bandScoreTables.listening = { 39: 8 };
    config.sections.listening.bandScoreTable = { 39: 8 };
    const onChange = vi.fn();

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Standards'));
    fireEvent.click(screen.getByText('Reset to Official IELTS Standards'));

    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.standards.bandScoreTables.listening).toEqual(DEFAULT_LISTENING_BAND_TABLE);
    expect(nextConfig.sections.listening.bandScoreTable).toEqual(DEFAULT_LISTENING_BAND_TABLE);
  });

  it('adds an extra writing task from the sections tab', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Sections'));
    fireEvent.click(screen.getByText('Add Task'));

    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.sections.writing.tasks).toHaveLength(3);
    expect(nextConfig.sections.writing.tasks[2]).toMatchObject({
      id: 'task3',
      label: 'Task 3',
      minWords: config.standards.writingTasks.task2.minWords,
      recommendedTime: config.standards.writingTasks.task2.recommendedTime,
    });
  });
});

describe('ExamSettingsDrawer security tab', () => {
  it('describes translation protection as best-effort deterrence', () => {
    const config = createDefaultConfig('Academic', 'Academic');

    render(
      <ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Security'));
    expect(screen.getByText(/best-effort deterrence/i)).toBeInTheDocument();
  });

  it('allows toggling anti-screenshot guard', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Security'));
    fireEvent.click(screen.getByLabelText(/anti-screenshot guard/i));

    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.security.antiScreenshotGuardEnabled).toBe(false);
  });
});

describe('ExamSettingsDrawer publish tab', () => {
  it('merges readiness and actions into one release status section', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const exam: ExamEntity = {
      id: 'exam-1',
      slug: 'academic-exam-1',
      title: 'Academic Exam 1',
      type: 'Academic',
      status: 'draft',
      visibility: 'private',
      owner: 'Admin User',
      createdAt: '2026-04-15T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
      currentDraftVersionId: 'draft-1',
      currentPublishedVersionId: null,
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: 1,
    };
    const publishReadiness: PublishReadiness = {
      canPublish: false,
      errors: [
        { field: 'sections.reading', message: 'Reading section needs 3 more questions.', severity: 'error' },
      ],
      warnings: [
        { field: 'timing', message: 'Listening timing is shorter than the recommended duration.' },
      ],
      missingFields: ['sections.reading'],
      questionCounts: {
        reading: 37,
        listening: 40,
        total: 77,
      },
    };

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={exam}
        publishReadiness={publishReadiness}
        onPublish={vi.fn()}
        onSchedulePublish={vi.fn()}
        onSaveDraft={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Publish'));

    const blockersHeading = screen.getByText('What needs attention');
    const statusHeading = screen.getByText('Needs fixes before publish');

    expect(screen.getByText('Release Status')).toBeTruthy();
    expect(screen.getByText('Resolve publish blockers')).toBeTruthy();
    expect(screen.getByText('Fix 1 blocking issue before publishing.')).toBeTruthy();
    expect(
      blockersHeading.compareDocumentPosition(statusHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText('Publish Readiness')).toBeNull();
    expect(screen.getByText('Schedule & Notes')).toBeTruthy();
    expect(screen.getByText('Reference Details')).toBeTruthy();
  });
});

function findNestedDialog(matcher: RegExp): HTMLElement {
  const matches = screen
    .getAllByRole('dialog')
    .filter((dialog) => within(dialog).queryByText(matcher) !== null);
  const found = matches.at(-1);
  if (!found) throw new Error(`dialog matching ${matcher} not found`);
  return found;
}

describe('ExamSettingsDrawer shell', () => {
  it('renders nothing when closed', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const { container } = render(
      <ExamSettingsDrawer isOpen={false} onClose={() => {}} config={config} onChange={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Exam Settings')).toBeNull();
  });

  it('renders title, tabs and footer; close and save fire onClose', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onClose = vi.fn();
    render(<ExamSettingsDrawer isOpen onClose={onClose} config={config} onChange={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Exam Settings')).toBeInTheDocument();
    for (const tab of ['General', 'Sections', 'Standards', 'Timing', 'Scoring', 'Security', 'Publish']) {
      expect(screen.getByText(tab)).toBeInTheDocument();
    }
    expect(screen.getByText('Config Validated')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close exam settings'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save & Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onClose = vi.fn();
    render(<ExamSettingsDrawer isOpen onClose={onClose} config={config} onChange={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ExamSettingsDrawer general tab', () => {
  it('shows basic info fields and updates the exam title', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={onChange} />);

    expect(screen.getByText('Basic Information')).toBeInTheDocument();
    expect(screen.getByText('Exam Title')).toBeInTheDocument();
    expect(screen.getByText('Exam Summary')).toBeInTheDocument();
    expect(screen.getByText('Candidate Instructions')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. Academic Practice Test 5'), {
      target: { value: 'Mock Test 5' },
    });
    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.general.title).toBe('Mock Test 5');
  });

  it('updates the standard type from the general tab', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'General Training' } });
    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.general.type).toBe('General Training');
  });
});

describe('ExamSettingsDrawer tabs', () => {
  it('switches through every tab and shows its key section', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={vi.fn()} />);

    const cases: Array<[string, string]> = [
      ['Sections', 'Module Configuration'],
      ['Standards', 'Passage Word Count Validation'],
      ['Timing', 'Section Flow'],
      ['Scoring', 'Scoring Rules'],
      ['Security', 'Proctoring Control'],
      ['Publish', 'Release Status'],
    ];
    for (const [tab, heading] of cases) {
      fireEvent.click(screen.getByText(tab));
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText('General'));
    expect(screen.getByText('Basic Information')).toBeInTheDocument();
  });
});

describe('ExamSettingsDrawer sections tab extras', () => {
  it('renames a section label', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={onChange} />);

    fireEvent.click(screen.getByText('Sections'));
    fireEvent.change(screen.getByDisplayValue('Listening'), {
      target: { value: 'Listening Updated' },
    });
    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.sections.listening.label).toBe('Listening Updated');
  });

  it('toggles listening audio playback off', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={onChange} />);

    fireEvent.click(screen.getByText('Sections'));
    fireEvent.click(screen.getByLabelText('Enable listening audio playback'));
    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.sections.listening.audioPlaybackEnabled).toBe(false);
  });
});

describe('ExamSettingsDrawer standards validation', () => {
  it('surfaces word-count and rubric weight errors plus deviation warnings', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.standards.passageWordCount.optimalMin = 1000;
    config.standards.passageWordCount.optimalMax = 700;
    config.standards.rubricWeights.writing.taskResponse = 50;
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={vi.fn()} />);

    fireEvent.click(screen.getByText('Standards'));
    expect(screen.getByText('Optimal minimum must be less than optimal maximum.')).toBeInTheDocument();
    expect(screen.getByText('Rubric weights must sum to 100.')).toBeInTheDocument();
    expect(screen.getByText('Above threshold')).toBeInTheDocument();
  });

  it('surfaces band score table errors', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.standards.bandScoreTables.listening = { 0: 7.3 };
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={vi.fn()} />);

    fireEvent.click(screen.getByText('Standards'));
    expect(screen.getByText(/Band scores must be between 0 and 9/)).toBeInTheDocument();
  });
});

describe('ExamSettingsDrawer timing tab extras', () => {
  it('requires at least one enabled section and shows runtime policy', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.sections.listening.enabled = false;
    config.sections.reading.enabled = false;
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={vi.fn()} />);

    fireEvent.click(screen.getByText('Timing'));
    expect(screen.getByText('At least one section must be enabled.')).toBeInTheDocument();
    expect(screen.getByText('Total Planned Duration')).toBeInTheDocument();
    expect(screen.getByText('Runtime Policy')).toBeInTheDocument();
    expect(screen.getByText('Auto-advance on time up')).toBeInTheDocument();
  });
});

describe('ExamSettingsDrawer scoring tab', () => {
  it('shows the standards summary and updates rounding', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={onChange} />);

    fireEvent.click(screen.getByText('Scoring'));
    expect(screen.getByText('Scoring Rules')).toBeInTheDocument();
    expect(screen.getByText('Standards live in the Standards tab.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'floor' } });
    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.scoring.overallRounding).toBe('floor');
  });
});

describe('ExamSettingsDrawer security tab extras', () => {
  it('updates the tab switch rule', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();
    render(<ExamSettingsDrawer isOpen onClose={() => {}} config={config} onChange={onChange} />);

    fireEvent.click(screen.getByText('Security'));
    expect(screen.getByText('Tab Switch Rule')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'terminate' } });
    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.security.tabSwitchRule).toBe('terminate');
  });
});

describe('ExamSettingsDrawer publish actions', () => {
  it('publishes with notes', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onPublish = vi.fn();
    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={makeExam()}
        publishReadiness={makeReadiness()}
        onPublish={onPublish}
      />
    );

    fireEvent.click(screen.getByText('Publish'));
    expect(screen.getByText('Ready to release')).toBeInTheDocument();
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Add notes about this publish/), {
      target: { value: 'Release v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish Now' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenCalledWith('Release v1');
  });

  it('saves a draft from editorial actions', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onSaveDraft = vi.fn();
    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={makeExam()}
        publishReadiness={makeReadiness()}
        onSaveDraft={onSaveDraft}
      />
    );

    fireEvent.click(screen.getByText('Publish'));
    expect(screen.getByText('Editorial Actions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('archives through the confirm modal', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onArchive = vi.fn();
    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={makeExam()}
        publishReadiness={makeReadiness()}
        onArchive={onArchive}
      />
    );

    fireEvent.click(screen.getByText('Publish'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive Exam' }));
    const modal = findNestedDialog(/no longer be visible in the library/);
    fireEvent.click(within(modal).getByRole('button', { name: 'Archive exam' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('unpublishes a live exam with an empty reason', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onUnpublish = vi.fn();
    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={makeExam({ status: 'published', publishedAt: '2026-04-17T08:00:00.000Z' })}
        publishReadiness={makeReadiness()}
        onUnpublish={onUnpublish}
      />
    );

    fireEvent.click(screen.getByText('Publish'));
    expect(screen.getByText('Manage live release')).toBeInTheDocument();
    expect(screen.getByText('Currently Published')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    const modal = findNestedDialog(/why this release is being unpublished/);
    fireEvent.click(within(modal).getByRole('button', { name: 'Unpublish' }));
    expect(onUnpublish).toHaveBeenCalledTimes(1);
    expect(onUnpublish).toHaveBeenCalledWith(undefined);
  });

  it('rejects an over-long unpublish reason', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onUnpublish = vi.fn();
    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={makeExam({ status: 'published', publishedAt: '2026-04-17T08:00:00.000Z' })}
        publishReadiness={makeReadiness()}
        onUnpublish={onUnpublish}
      />
    );

    fireEvent.click(screen.getByText('Publish'));
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    const modal = findNestedDialog(/why this release is being unpublished/);
    fireEvent.change(within(modal).getByLabelText('Reason (optional)'), {
      target: { value: 'x'.repeat(501) },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Unpublish' }));
    expect(within(modal).getByRole('alert')).toHaveTextContent('Reason must be 500 characters or fewer.');
    expect(onUnpublish).not.toHaveBeenCalled();
  });

  it('schedules a release for later', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onSchedulePublish = vi.fn();
    const { container } = render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={makeExam()}
        publishReadiness={makeReadiness()}
        onSchedulePublish={onSchedulePublish}
      />
    );

    fireEvent.click(screen.getByText('Publish'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Schedule for later' }));
    const dateInput = container.querySelector('input[type="datetime-local"]');
    if (!dateInput) throw new Error('schedule datetime input missing');
    fireEvent.change(dateInput, { target: { value: '2026-12-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule Release' }));
    expect(onSchedulePublish).toHaveBeenCalledTimes(1);
    expect(onSchedulePublish).toHaveBeenCalledWith('2026-12-01T10:00', '');
  });

  it('restores a draft version and shows reference details', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onRestoreVersion = vi.fn();
    const versions = [
      makeExamVersion({
        id: 'v2',
        versionNumber: 2,
        parentVersionId: 'v1',
        createdBy: 'Second Admin',
        isDraft: false,
        isPublished: true,
        publishNotes: 'First release',
      }),
      makeExamVersion({ id: 'v3', versionNumber: 3, parentVersionId: 'v2', createdBy: 'Second Admin' }),
    ];
    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={makeExam()}
        publishReadiness={makeReadiness()}
        versions={versions}
        onRestoreVersion={onRestoreVersion}
      />
    );

    fireEvent.click(screen.getByText('Publish'));
    expect(screen.getByText('Version History')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText(/First release/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Restore as draft'));
    expect(onRestoreVersion).toHaveBeenCalledTimes(1);
    expect(onRestoreVersion).toHaveBeenCalledWith('v3');
    expect(screen.getByText('Reference Details')).toBeInTheDocument();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
  });
});
