import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../services/examAdapterService';
import { createActScienceBlock, createActScienceQuestion } from '../../components/ActScienceQuestionBuilderPane';
import { formatExamStats, getExamStatsFromExam, getExamStatsFromState } from '../examStats';

describe('Phase 03 ACT reconciliation: examStats', () => {
  it('counts science questions in state and exam stats', () => {
    const state = createInitialExamState('ACT', 'ACT', 'ACT Science');
    const block = createActScienceBlock('block-stats');
    block.questions = [createActScienceQuestion('qs-1'), createActScienceQuestion('qs-2')];
    state.science.stimuli = [
      { id: 'stim-stats', title: 'Stats', content: 'Content', blocks: [block], images: [], wordCount: 1 },
    ];
    const stats = getExamStatsFromState(state);
    expect(stats.scienceQuestions).toBe(2);
    expect(stats.totalQuestions).toBe(2);
    const examStats = getExamStatsFromExam({
      id: 'exam-1',
      title: 'ACT',
      type: 'ACT',
      status: 'Draft',
      author: 'Admin',
      lastModified: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      content: state,
    });
    expect(examStats.scienceQuestions).toBe(2);
    expect(examStats.totalQuestions).toBe(2);
    expect(formatExamStats(stats)).toContain('Science');
  });

  it('leaves IELTS totals unchanged with zero science', () => {
    const state = createInitialExamState('IELTS', 'Academic', 'Academic');
    const stats = getExamStatsFromState(state);
    expect(stats.scienceQuestions).toBe(0);
    expect(stats.totalQuestions).toBe(stats.readingQuestions + stats.listeningQuestions);
  });
});
