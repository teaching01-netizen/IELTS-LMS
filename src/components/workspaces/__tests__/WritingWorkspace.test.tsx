import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import { WritingWorkspace } from '../WritingWorkspace';

describe('WritingWorkspace', () => {
  it('stores a Google Drive chart image URL instead of using file upload', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const setState = vi.fn();
    const driveUrl = 'https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing';

    const { container } = render(<WritingWorkspace state={state} setState={setState} />);

    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();

    const chartImageUrlInput = screen.getByLabelText(/chart image url/i);
    fireEvent.change(chartImageUrlInput, { target: { value: driveUrl } });

    const nextState = setState.mock.calls.at(-1)?.[0];
    expect(nextState.writing.tasks?.[0]?.chart?.imageSrc).toBe(driveUrl);
  });
});
