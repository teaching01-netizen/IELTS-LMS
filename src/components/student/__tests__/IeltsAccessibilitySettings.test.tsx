import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IeltsAccessibilitySettings } from '../IeltsAccessibilitySettings';
import { STUDENT_ZOOM_MAX, STUDENT_ZOOM_STEP } from '../AccessibilitySettings';

// jsdom doesn't implement HTMLDialogElement — polyfill showModal/close as the ACT dialog test does
beforeAll(() => {
  HTMLDialogElement.prototype.showModal =
    HTMLDialogElement.prototype.showModal ||
    function (this: HTMLDialogElement) {
      (this as any).open = true;
    };
  HTMLDialogElement.prototype.close =
    HTMLDialogElement.prototype.close ||
    function (this: HTMLDialogElement) {
      (this as any).open = false;
    };
});

function renderSheet(overrides: Partial<Parameters<typeof IeltsAccessibilitySettings>[0]> = {}) {
  const props: Parameters<typeof IeltsAccessibilitySettings>[0] = {
    isOpen: true,
    onClose: vi.fn(),
    fontSize: 'normal',
    highContrast: false,
    zoom: 1,
    passageReadabilityLevel: 1,
    playbackRate: 1,
    onFontSizeChange: vi.fn(),
    onHighContrastToggle: vi.fn(),
    onZoomChange: vi.fn(),
    onPassageReadabilityChange: vi.fn(),
    onPlaybackRateChange: vi.fn(),
    onResetDefaults: vi.fn(),
    ...overrides,
  };
  render(<IeltsAccessibilitySettings {...props} />);
  return props;
}

describe('IeltsAccessibilitySettings', () => {
  it('renders as a sheet outside the exam shell so the shell zoom cannot size it', () => {
    renderSheet();

    const dialog = screen.getByRole('heading', { name: 'Accessibility' }).closest('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog?.parentElement).toBe(document.body);
  });

  it('makes Done the dismiss action', () => {
    const { onClose } = renderSheet();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports text size, passage layout, and zoom changes', () => {
    const { onFontSizeChange, onPassageReadabilityChange, onZoomChange } = renderSheet();

    fireEvent.click(screen.getByTestId('font-size-option-large'));
    fireEvent.click(screen.getByTestId('passage-layout-option-2'));
    fireEvent.click(screen.getByTestId('zoom-increase'));

    expect(onFontSizeChange).toHaveBeenCalledWith('large');
    expect(onPassageReadabilityChange).toHaveBeenCalledWith(2);
    expect(onZoomChange).toHaveBeenCalledWith(Math.round(Math.min(STUDENT_ZOOM_MAX, 1 + STUDENT_ZOOM_STEP) * 100) / 100);
  });

  it('scrolls its body instead of squeezing it', () => {
    // `flex-1` (flex-basis 0%) collapsed the body to 48px in WebKit; `grow` keeps
    // the content height so the body scrolls inside the sheet.
    renderSheet();

    const body = document.querySelector('dialog .overflow-y-auto');
    expect(body).toHaveClass('grow', 'min-h-0', 'overflow-y-auto');
    expect(body).not.toHaveClass('flex-1');
  });
});
