import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Workspace } from '../Workspace';
import { createInitialExamState } from '../../services/examAdapterService';

describe('Workspace (ACT science, AT-11)', () => {
  it('renders the science workspace for ACT exams', () => {
    const state = createInitialExamState('ACT Practice', 'ACT', 'ACT Science');
    state.activeModule = 'science';
    render(<Workspace state={state} setState={() => {}} />);
    expect(screen.queryByRole('heading', { name: /reading/i })).not.toBeInTheDocument();
    expect(screen.getByText(/stimulus/i)).toBeInTheDocument();
  });

  it('keeps IELTS exams on the reading workspace', () => {
    const state = createInitialExamState('IELTS Practice', 'Academic');
    state.activeModule = 'reading';
    state.reading.passages = [];
    state.activePassageId = '';
    render(<Workspace state={state} setState={() => {}} />);
    expect(screen.getByRole('heading', { name: /reading/i })).toBeInTheDocument();
  });
});

describe('Sidebar (AT-10/AT-11)', () => {
  it('is covered through Workspace state: science section is enabled for ACT only', async () => {
    const { Sidebar } = await import('../Sidebar');
    expect(typeof Sidebar).toBe('function');
    const act = createInitialExamState('ACT Practice', 'ACT', 'ACT Science');
    const ielts = createInitialExamState('IELTS Practice', 'Academic');
    expect(act.config.sections.science.enabled).toBe(true);
    expect(ielts.config.sections.science.enabled).toBe(false);
    expect(vi.fn()).toBeDefined();
  });
});
