import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import type { ExamConfig } from '../../../../types';
import { TimingTab } from '../TimingTab';

function renderTab(config?: ExamConfig) {
  const resolved = config ?? createDefaultConfig('Academic', 'Academic');
  const onChange = vi.fn();
  const utils = render(<TimingTab config={resolved} onChange={onChange} />);
  return { config: resolved, onChange, ...utils };
}

function numberInputFor(labelText: string, index = 0): HTMLInputElement {
  const label = screen.getAllByText(labelText)[index];
  const input = label.parentElement?.querySelector('input[type=number]');
  if (!input) throw new Error('number input not found for label at index ' + index);
  return input as HTMLInputElement;
}

function policyCheckboxFor(headingText: string): HTMLInputElement {
  const heading = screen.getByText(headingText);
  const row = heading.closest('div')?.parentElement;
  const input = row?.querySelector('input[type=checkbox]');
  if (!input) throw new Error('checkbox not found for ' + headingText);
  return input as HTMLInputElement;
}

describe('TimingTab', () => {
  it('renders key timing controls and the section flow summary', () => {
    renderTab();

    expect(screen.getByText('Section Flow')).toBeInTheDocument();
    expect(screen.getByText('Runtime Policy')).toBeInTheDocument();
    expect(screen.getByText('Authentic IELTS Mode')).toBeInTheDocument();
    expect(screen.getAllByText('Listening').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reading').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Writing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Speaking').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Duration (min)')).toHaveLength(4);
    expect(screen.getAllByText('Gap After (min)')).toHaveLength(4);
    expect(screen.getByText('Total Planned Duration')).toBeInTheDocument();
    expect(screen.getAllByText('165 min').length).toBeGreaterThan(0);
    expect(screen.getByText('Allowed Extension Minutes')).toBeInTheDocument();
    expect(screen.getByText('Auto-advance on time up')).toBeInTheDocument();
    expect(screen.getByText('Warning Threshold')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add task/i })).toBeInTheDocument();
  });

  it('updates section duration via onChange', () => {
    const { onChange } = renderTab();
    fireEvent.change(numberInputFor('Duration (min)', 0), { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].sections.listening.duration).toBe(45);
  });

  it('updates gap after minutes via onChange', () => {
    const { onChange } = renderTab();
    fireEvent.change(numberInputFor('Gap After (min)', 1), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].sections.reading.gapAfterMinutes).toBe(5);
  });

  it('updates section order via onChange', () => {
    const { onChange } = renderTab();
    const orderLabel = screen.getAllByText('Order')[0];
    const input = orderLabel.parentElement?.querySelector('input[type=number]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].sections.listening.order).toBe(5);
  });

  it('toggles IELTS mode on', () => {
    const { onChange } = renderTab();
    const toggle = screen.getByText('OFF').closest('label')?.querySelector('input');
    if (!toggle) throw new Error('IELTS mode toggle not found');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].general.ieltsMode).toBe(true);
  });

  it('toggles allowed extension minutes (add then remove)', () => {
    const { onChange } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: '+15 min' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].delivery.allowedExtensionMinutes).toEqual([5, 10, 15]);
    fireEvent.click(screen.getByRole('button', { name: '+5 min' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].delivery.allowedExtensionMinutes).toEqual([10]);
  });

  it('updates runtime policy checkboxes and warning threshold', () => {
    const { onChange } = renderTab();
    fireEvent.click(policyCheckboxFor('Auto-advance on time up'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].progression.autoSubmit).toBe(false);
    fireEvent.click(policyCheckboxFor('Lock section after submit'));
    expect(onChange.mock.calls[1][0].progression.lockAfterSubmit).toBe(false);
    fireEvent.click(policyCheckboxFor('Allow cohort pause'));
    expect(onChange.mock.calls[2][0].progression.allowPause).toBe(true);
    fireEvent.click(policyCheckboxFor('Show proctoring warnings'));
    expect(onChange.mock.calls[3][0].progression.showWarnings).toBe(false);
    const thresholdRow = screen.getByText('Warning Threshold').closest('div')?.parentElement;
    const threshold = thresholdRow?.querySelector('input[type=number]') as HTMLInputElement;
    fireEvent.change(threshold, { target: { value: '5' } });
    expect(onChange.mock.calls[4][0].progression.warningThreshold).toBe(5);
  });

  it('hides the warning threshold when warnings are disabled', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    renderTab({ ...base, progression: { ...base.progression, showWarnings: false } });
    expect(screen.queryByText('Warning Threshold')).not.toBeInTheDocument();
  });

  it('adds a writing task', () => {
    const { onChange, config } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const tasks = onChange.mock.calls[0][0].sections.writing.tasks;
    expect(tasks).toHaveLength(config.sections.writing.tasks.length + 1);
    expect(tasks[tasks.length - 1]).toMatchObject({ id: 'task3', label: 'Task 3' });
  });

  it('removes a custom writing task and keeps default badges', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    const config: ExamConfig = {
      ...base,
      sections: {
        ...base.sections,
        writing: {
          ...base.sections.writing,
          tasks: [
            ...base.sections.writing.tasks,
            { id: 'task3', label: 'Task 3', taskType: 'task2-essay', minWords: 250, recommendedTime: 40 },
          ],
        },
      },
    };
    const { onChange } = renderTab(config);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const ids = onChange.mock.calls[0][0].sections.writing.tasks.map((t: { id: string }) => t.id);
    expect(ids).toEqual(['task1', 'task2']);
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0);
  });

  it('edits writing task label and task1 standards', () => {
    const { onChange } = renderTab();
    fireEvent.change(screen.getByDisplayValue('Task 1'), { target: { value: 'Task One' } });
    expect(onChange.mock.calls[0][0].sections.writing.tasks[0].label).toBe('Task One');
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '200' } });
    expect(onChange.mock.calls[1][0].standards.writingTasks.task1.minWords).toBe(200);
  });

  it('edits speaking part prep time', () => {
    const { onChange } = renderTab();
    const partLabel = screen.getByDisplayValue('Part 2: Individual Long Turn');
    const row = partLabel.closest('div.grid');
    const prep = row?.querySelectorAll('input[type=number]')[0] as HTMLInputElement;
    fireEvent.change(prep, { target: { value: '90' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].sections.speaking.parts[1].prepTime).toBe(90);
  });

  it('shows a validation message for zero duration', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    renderTab({ ...base, sections: { ...base.sections, listening: { ...base.sections.listening, duration: 0 } } });
    expect(screen.getByText('Validation')).toBeInTheDocument();
    expect(screen.getByText('Listening duration must be greater than 0.')).toBeInTheDocument();
  });

  it('shows a validation message for a negative gap', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    renderTab({ ...base, sections: { ...base.sections, listening: { ...base.sections.listening, gapAfterMinutes: -1 } } });
    expect(screen.getByText('Listening gap cannot be negative.')).toBeInTheDocument();
  });

  it('shows a validation message for duplicate section order', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    renderTab({ ...base, sections: { ...base.sections, reading: { ...base.sections.reading, order: 0 } } });
    expect(screen.getByText('Duplicate section order 0 detected.')).toBeInTheDocument();
  });

  it('shows a validation message when all sections are disabled', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    renderTab({
      ...base,
      sections: {
        ...base.sections,
        listening: { ...base.sections.listening, enabled: false },
        reading: { ...base.sections.reading, enabled: false },
        writing: { ...base.sections.writing, enabled: false },
        speaking: { ...base.sections.speaking, enabled: false },
      },
    });
    expect(screen.getByText('At least one section must be enabled.')).toBeInTheDocument();
  });

  it('disables timing inputs in IELTS mode', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    renderTab({ ...base, general: { ...base.general, ieltsMode: true } });
    expect(screen.getByText('ON')).toBeInTheDocument();
    expect(screen.getByText('Disabled (IELTS mode)')).toBeInTheDocument();
    expect(numberInputFor('Duration (min)', 0).disabled).toBe(true);
  });

  it('keeps disabled IELTS timing values and labels readable', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    renderTab({ ...base, general: { ...base.general, ieltsMode: true } });

    const durationLabel = screen.getAllByText('Duration (min)')[0];
    const durationInput = numberInputFor('Duration (min)', 0);

    expect(durationLabel).toHaveClass('text-gray-700');
    expect(durationInput).toHaveClass('text-gray-900', 'disabled:text-gray-900', 'disabled:opacity-100');
    expect(screen.getAllByText('Projected End')[0]).toHaveClass('text-gray-700');
  });

  it('renders ACT science timing mode with only the science section', () => {
    renderTab(createDefaultConfig('ACT', 'ACT Science'));
    expect(screen.getByText('ACT Science Timing')).toBeInTheDocument();
    expect(screen.getAllByText('Science')).toHaveLength(2);
    expect(screen.queryByText('Authentic IELTS Mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Reading')).not.toBeInTheDocument();
  });

  it('shows an empty state when no extension minutes are allowed', () => {
    const base = createDefaultConfig('Academic', 'Academic');
    renderTab({ ...base, delivery: { ...base.delivery, allowedExtensionMinutes: [] } });
    expect(screen.getByText('No extensions allowed.')).toBeInTheDocument();
  });
});
