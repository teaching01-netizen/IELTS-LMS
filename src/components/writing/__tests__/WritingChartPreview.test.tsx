import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WritingChartData } from '../../../types';
import { WritingChartPreview } from '../WritingChartPreview';

const createChart = (type: WritingChartData['type'], values = [10, 20, 30]): WritingChartData => ({
  id: `${type}-chart`,
  title: `${type} chart`,
  type,
  labels: ['A', 'B', 'C'],
  values,
});

describe('WritingChartPreview', () => {
  it.each(['bar', 'line', 'pie', 'table'] as const)('renders the selected %s chart type', (type) => {
    const { container } = render(<WritingChartPreview chart={createChart(type)} />);

    expect(container.querySelector(`[data-writing-chart-type="${type}"]`)).toBeInTheDocument();
  });

  it('normalizes bar heights so large values stay inside the chart frame', () => {
    render(<WritingChartPreview chart={createChart('bar', [10, 5000])} />);

    expect(screen.getByLabelText('B: 5000')).toHaveStyle({ height: '144px' });
  });

  it('renders line charts with an svg path instead of bars', () => {
    const { container } = render(<WritingChartPreview chart={createChart('line')} />);

    expect(container.querySelector('svg path')).toBeInTheDocument();
    expect(container.querySelector('[data-writing-chart-type="bar"]')).not.toBeInTheDocument();
  });
});
