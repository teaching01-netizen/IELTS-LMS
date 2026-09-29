import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { ModulesTab } from '../ModulesTab';

describe('ModulesTab', () => {
  it('keeps ACT module labels and values readable', () => {
    const config = createDefaultConfig('ACT', 'ACT Science');

    render(<ModulesTab config={config} onChange={vi.fn()} />);

    expect(screen.getByText('Question Count')).toHaveClass('text-slate-600');
    expect(screen.getByText('Order')).toHaveClass('text-slate-600');
    expect(screen.getByText('Gap After (min)')).toHaveClass('text-slate-600');
    expect(screen.getByDisplayValue('40')).toHaveClass('text-slate-800');
  });
});
