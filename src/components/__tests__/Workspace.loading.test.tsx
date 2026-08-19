import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Workspace } from '../Workspace';
import { createInitialExamState } from '../../services/examAdapterService';

describe('Workspace loading behavior', () => {
  it('renders the reading builder immediately without a fake loading skeleton', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';

    render(<Workspace state={state} setState={() => {}} />);

    expect(screen.queryByText(/loading modules/i)).toBeNull();
    expect(screen.queryByText(/loading exam/i)).toBeNull();
    expect(document.querySelector('[contenteditable="true"]')).toBeTruthy();
  });

  it('self-heals a dangling activePassageId without updating state during render', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';
    state.activePassageId = 'missing-passage-id';

    function Harness() {
      const [examState, setExamState] = useState(state);
      return <Workspace state={examState} setState={setExamState} />;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(document.querySelector('[contenteditable="true"]')).toBeTruthy();
    });

    const renderPhaseWarnings = errorSpy.mock.calls.filter((call) =>
      String(call[0]).includes('Cannot update a component while rendering'),
    );
    expect(renderPhaseWarnings).toHaveLength(0);

    errorSpy.mockRestore();
  });

  it('does not loop when the active passage id matches an existing passage', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';

    render(<Workspace state={state} setState={() => {}} />);

    await waitFor(() => {
      expect(document.querySelector('[contenteditable="true"]')).toBeTruthy();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});