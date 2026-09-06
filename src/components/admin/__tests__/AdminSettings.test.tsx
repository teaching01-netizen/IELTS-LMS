import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminSettings } from '../AdminSettings';
import { ALL_QUESTION_TYPES, createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamConfig } from '../../../types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(overrides?: Partial<ExamConfig>) {
  const config: ExamConfig = {
    ...createDefaultConfig('Academic', 'Academic'),
    ...overrides,
  };
  const onChange = vi.fn();
  const view = render(<AdminSettings config={config} onChange={onChange} />);
  return { config, onChange, ...view };
}

function lastConfig(onChange: ReturnType<typeof vi.fn>): ExamConfig {
  return onChange.mock.calls.at(-1)?.[0] as ExamConfig;
}

describe('AdminSettings header and default tab', () => {
  it('renders the header and the default scoring tab', () => {
    setup();
    expect(screen.getByText('Global Exam Defaults')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset baseline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save profile/i })).toBeInTheDocument();
    expect(screen.getByText('Scoring Standards')).toBeInTheDocument();
    expect(screen.getByText('Listening Conversion')).toBeInTheDocument();
    expect(screen.getByText('Academic Reading')).toBeInTheDocument();
    expect(screen.getByText('Rubric Weighting')).toBeInTheDocument();
    expect(screen.getByText(/active profile/i)).toBeInTheDocument();
  });

  it('emits the unchanged config when Save Profile is clicked', () => {
    const { config, onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(config);
  });

  it('resets to the seeded baseline when confirm accepts', () => {
    const { onChange } = setup();
    vi.stubGlobal('confirm', vi.fn(() => true));
    fireEvent.click(screen.getByRole('button', { name: /reset baseline/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastConfig(onChange)).toEqual(createDefaultConfig('Academic', 'Academic'));
  });

  it('does nothing on Reset Baseline when confirm cancels', () => {
    const { onChange } = setup();
    vi.stubGlobal('confirm', vi.fn(() => false));
    fireEvent.click(screen.getByRole('button', { name: /reset baseline/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('AdminSettings tab navigation', () => {
  it.each([
    ['General', 'General Default Info'],
    ['Modules', 'Module & Content Defaults'],
    ['Time & Progression', 'Module Timers & Rules'],
    ['Security', 'Security & Proctoring Defaults'],
  ] as const)('shows %s panel when its tab is clicked', (tab, heading) => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: tab }));
    expect(screen.getByText(heading)).toBeInTheDocument();
  });
});

describe('AdminSettings scoring tab', () => {
  it('updates the overall rounding rule', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'floor' } });
    expect(lastConfig(onChange).scoring.overallRounding).toBe('floor');
  });

  it('adds a band-table row for listening', () => {
    const { config, onChange, container } = setup();
    // Remove the seeded 0-key first is unnecessary: default table has no 0 key.
    const addButtons = screen.getAllByRole('button', { name: /\+ add row/i });
    expect(addButtons).toHaveLength(2);
    fireEvent.click(addButtons[0]);
    expect(lastConfig(onChange).sections.listening.bandScoreTable[0]).toBe(1.0);
    expect(config.sections.listening.bandScoreTable[0]).toBeUndefined();
    expect(container).toBeTruthy();
  });

  it('edits a listening band value', () => {
    const { onChange, container } = setup();
    // Listening band inputs use step=0.5 and blue styling; first row is raw 39 -> 9.0.
    const bandInputs = container.querySelectorAll('input[step="0.5"]');
    expect(bandInputs.length).toBeGreaterThan(0);
    fireEvent.change(bandInputs[0], { target: { value: '8.5' } });
    expect(lastConfig(onChange).sections.listening.bandScoreTable[39]).toBe(8.5);
  });

  it('deletes a listening band-table row', () => {
    const { onChange, container } = setup();
    const deleteButtons = container.querySelectorAll('button.opacity-0');
    expect(deleteButtons.length).toBeGreaterThan(0);
    fireEvent.click(deleteButtons[0]);
    // First row (highest raw score) is removed.
    expect(lastConfig(onChange).sections.listening.bandScoreTable[39]).toBeUndefined();
  });

  it('adjusts a writing rubric weight via slider', () => {
    const { onChange, container } = setup();
    const sliders = container.querySelectorAll('input[type="range"]');
    // 4 writing weights + 4 speaking weights.
    expect(sliders.length).toBe(8);
    fireEvent.change(sliders[0], { target: { value: '30' } });
    expect(lastConfig(onChange).sections.writing.rubricWeights.taskResponse).toBe(30);
  });

  it('adjusts a speaking rubric weight via slider', () => {
    const { onChange, container } = setup();
    const sliders = container.querySelectorAll('input[type="range"]');
    fireEvent.change(sliders[4], { target: { value: '40' } });
    expect(lastConfig(onChange).sections.speaking.rubricWeights.fluency).toBe(40);
  });
});

describe('AdminSettings general tab', () => {
  it('edits the default summary', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    const summary = screen.getByPlaceholderText('Enter default exam summary...');
    fireEvent.change(summary, { target: { value: 'New default summary' } });
    expect(lastConfig(onChange).general.summary).toBe('New default summary');
  });

  it('edits the default candidate instructions', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    const instructions = screen.getByPlaceholderText(/instructions that will appear/i);
    fireEvent.change(instructions, { target: { value: 'New instructions' } });
    expect(lastConfig(onChange).general.instructions).toBe('New instructions');
  });
});

describe('AdminSettings modules tab', () => {
  it('renames a module label', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Modules' }));
    fireEvent.change(screen.getByDisplayValue('Listening'), { target: { value: 'Listening v2' } });
    expect(lastConfig(onChange).sections.listening.label).toBe('Listening v2');
  });

  it('toggles a module enabled flag off', () => {
    const { onChange, container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Modules' }));
    // Checkbox order follows listening, reading, writing, speaking.
    const toggles = container.querySelectorAll('input[type="checkbox"]');
    expect(toggles.length).toBe(4);
    fireEvent.click(toggles[0]);
    expect(lastConfig(onChange).sections.listening.enabled).toBe(false);
  });

  it('toggles an allowed question type for listening only', () => {
    const { config, onChange } = setup();
    expect(config.sections.listening.allowedQuestionTypes).toEqual(
      expect.arrayContaining(ALL_QUESTION_TYPES),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Modules' }));
    // TFNG appears for both listening and reading; the first is listening's.
    const tfngButtons = screen.getAllByRole('button', { name: 'TFNG' });
    expect(tfngButtons.length).toBe(2);
    fireEvent.click(tfngButtons[0]);
    const next = lastConfig(onChange);
    expect(next.sections.listening.allowedQuestionTypes).not.toContain('TFNG');
    expect(next.sections.reading.allowedQuestionTypes).toContain('TFNG');
  });

  it('edits the reading passage count', () => {
    const { onChange, container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Modules' }));
    // Count inputs follow listening, reading, writing, speaking module order.
    const counts = container.querySelectorAll('input[type="number"]');
    fireEvent.change(counts[1], { target: { value: '5' } });
    expect(lastConfig(onChange).sections.reading.passageCount).toBe(5);
  });
});

describe('AdminSettings time tab', () => {
  it('edits a module duration', () => {
    const { onChange, container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Time & Progression' }));
    // First four number inputs are the module durations.
    const numbers = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numbers[0], { target: { value: '45' } });
    expect(lastConfig(onChange).sections.listening.duration).toBe(45);
  });

  it('toggles progression rules', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Time & Progression' }));
    fireEvent.click(screen.getByLabelText(/auto-advance on time up/i));
    expect(lastConfig(onChange).progression.autoSubmit).toBe(false);
    fireEvent.click(screen.getByLabelText(/lock after submission/i));
    expect(lastConfig(onChange).progression.lockAfterSubmit).toBe(false);
  });

  it('edits the warning threshold while warnings are shown', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Time & Progression' }));
    const heading = screen.getByText('Warning Threshold');
    const input = heading.closest('div.flex')?.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '5' } });
    expect(lastConfig(onChange).progression.warningThreshold).toBe(5);
  });

  it('hides the warning threshold when warnings are disabled', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.progression.showWarnings = false;
    const onChange = vi.fn();
    render(<AdminSettings config={config} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Time & Progression' }));
    expect(screen.queryByText('Warning Threshold')).toBeNull();
  });

  it('edits a writing task recommended time', () => {
    const { onChange, container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Time & Progression' }));
    // Order: listening, reading, writing durations, then task1 time/words, task2 time/words.
    const numbers = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numbers[3], { target: { value: '25' } });
    expect(lastConfig(onChange).sections.writing.tasks[0].recommendedTime).toBe(25);
  });

  it('edits a speaking part speaking time', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Time & Progression' }));
    const speakingTimes = screen.getAllByDisplayValue('300');
    expect(speakingTimes.length).toBeGreaterThan(0);
    fireEvent.change(speakingTimes[0], { target: { value: '240' } });
    expect(lastConfig(onChange).sections.speaking.parts[0].speakingTime).toBe(240);
  });
});

describe('AdminSettings security tab', () => {
  it('changes the tab switch rule', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'terminate' } });
    expect(lastConfig(onChange).security.tabSwitchRule).toBe('terminate');
  });

  it('toggles the webcam proctoring flag', () => {
    const { onChange, container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    // Flag order: webcam, audio, screen.
    const flags = container.querySelectorAll('input[type="checkbox"]');
    expect(flags.length).toBe(3);
    fireEvent.click(flags[0]);
    expect(lastConfig(onChange).security.proctoringFlags.webcam).toBe(false);
    expect(lastConfig(onChange).security.proctoringFlags.audio).toBe(true);
  });
});
