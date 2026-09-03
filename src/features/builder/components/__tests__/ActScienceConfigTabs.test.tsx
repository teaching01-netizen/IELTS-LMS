import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { BasicInfoTab } from '../BasicInfoTab';
import { ExamConfigTabs } from '../ExamConfigTabs';
import { ModulesTab } from '../ModulesTab';
import { TimingTab } from '../TimingTab';

describe('ACT Science configuration tabs', () => {
  it('hides IELTS-only Standards for ACT while keeping it for IELTS', () => {
    const onTabChange = vi.fn();

    const { rerender } = render(
      <ExamConfigTabs activeTab="basic" onTabChange={onTabChange} examType="ACT" />,
    );
    expect(screen.queryByRole('button', { name: /standards/i })).not.toBeInTheDocument();

    rerender(
      <ExamConfigTabs activeTab="basic" onTabChange={onTabChange} examType="Academic" />,
    );
    expect(screen.getByRole('button', { name: /standards/i })).toBeInTheDocument();
  });

  it('exposes ACT as a type and keeps the Science section enabled', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(<BasicInfoTab config={config} onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'ACT' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Exam Type' }), {
      target: { value: 'ACT' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        general: expect.objectContaining({ type: 'ACT', preset: 'ACT Science' }),
        sections: expect.objectContaining({
          science: expect.objectContaining({ enabled: true }),
        }),
      }),
    );
  });

  it('uses the ACT summary when switching an untouched default config to ACT', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(<BasicInfoTab config={config} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Exam Type' }), {
      target: { value: 'ACT' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        general: expect.objectContaining({
          summary: 'Standard ACT Exam',
        }),
      }),
    );
  });

  it('preserves a custom summary when switching an exam to ACT', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.general.summary = 'Custom Science Summary';
    const onChange = vi.fn();

    render(<BasicInfoTab config={config} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Exam Type' }), {
      target: { value: 'ACT' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        general: expect.objectContaining({
          summary: 'Custom Science Summary',
        }),
      }),
    );
  });

  it('uses the ACT exam summary as the default for ACT Science', () => {
    const config = createDefaultConfig('ACT', 'ACT Science');

    expect(config.general.summary).toBe('Standard ACT Exam');
  });

  it('shows only ACT Science module settings with a 40-question default', () => {
    const config = createDefaultConfig('ACT', 'ACT Science');
    const onChange = vi.fn();

    render(<ModulesTab config={config} onChange={onChange} />);
    expect(screen.getByDisplayValue('Science')).toBeInTheDocument();
    expect(screen.getByDisplayValue('40')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Listening')).not.toBeInTheDocument();
  });

  it('shows one continuous 40-minute Science section and allows duration changes', () => {
    const config = createDefaultConfig('ACT', 'ACT Science');
    const onChange = vi.fn();

    render(<TimingTab config={config} onChange={onChange} />);
    expect(screen.getByText('ACT Science Timing')).toBeInTheDocument();
    expect(screen.getByText('Total Planned Duration')).toBeInTheDocument();
    expect(screen.getAllByText('40 min').length).toBeGreaterThan(0);

    const durationInput = screen.getByLabelText('Duration (min)');
    fireEvent.change(durationInput, { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: expect.objectContaining({
          science: expect.objectContaining({ duration: 45 }),
        }),
      }),
    );
  });
});
