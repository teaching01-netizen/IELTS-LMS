import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { BasicInfoTab } from '../BasicInfoTab';

describe('BasicInfoTab', () => {
  it('keeps ACT values and labels readable when the preset is read-only', () => {
    const config = createDefaultConfig('ACT', 'ACT Science');

    render(<BasicInfoTab config={config} onChange={vi.fn()} />);

    expect(screen.getByDisplayValue('ACT Science')).toHaveClass('text-slate-700');
    expect(screen.getByLabelText('Exam Type')).toHaveClass('text-slate-800');
    expect(screen.getByText('Exam Title')).toHaveClass('text-slate-700');
    expect(screen.getByText('Exam Summary')).toHaveClass('text-slate-700');
  });
});
