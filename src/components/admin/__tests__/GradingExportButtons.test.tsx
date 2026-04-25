import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GradingExportButtons } from '../GradingExportButtons';

describe('GradingExportButtons', () => {
  test('renders and invokes the matching export callback', () => {
    const onExportReading = vi.fn();
    const onExportListening = vi.fn();
    const onExportWriting = vi.fn();

    render(
      <GradingExportButtons
        exportingSection={null}
        onExportReading={onExportReading}
        onExportListening={onExportListening}
        onExportWriting={onExportWriting}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /reading csv/i }));
    fireEvent.click(screen.getByRole('button', { name: /listening csv/i }));
    fireEvent.click(screen.getByRole('button', { name: /writing csv/i }));

    expect(onExportReading).toHaveBeenCalledTimes(1);
    expect(onExportListening).toHaveBeenCalledTimes(1);
    expect(onExportWriting).toHaveBeenCalledTimes(1);
  });
});
