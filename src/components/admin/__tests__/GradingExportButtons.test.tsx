import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GradingExportButtons } from '../GradingExportButtons';

describe('GradingExportButtons', () => {
  test('renders the export menu and invokes the matching export callback', () => {
    const onExportReading = vi.fn();
    const onExportReadingManual = vi.fn();
    const onExportListening = vi.fn();
    const onExportListeningManual = vi.fn();
    const onPrintWriting = vi.fn();
    const onOpenExportBuilder = vi.fn();

    render(
      <GradingExportButtons
        exportingSection={null}
        onExportReading={onExportReading}
        onExportReadingManual={onExportReadingManual}
        onExportListening={onExportListening}
        onExportListeningManual={onExportListeningManual}
        onPrintWriting={onPrintWriting}
        onOpenExportBuilder={onOpenExportBuilder}
      />,
    );

    // The menu is collapsed by default.
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /reading answers & scores/i })).not.toBeInTheDocument();

    const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    openMenu();
    expect(screen.getByRole('menuitem', { name: /reading answers & scores/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /print all writing/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /reading answers & scores/i }));
    expect(onExportReading).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /reading manual check sheet/i }));
    expect(onExportReadingManual).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /listening answers & scores/i }));
    expect(onExportListening).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /listening manual check sheet/i }));
    expect(onExportListeningManual).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /print all writing/i }));
    expect(onPrintWriting).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /export builder · pdf zip/i }));
    expect(onOpenExportBuilder).toHaveBeenCalledTimes(1);
  });
});
