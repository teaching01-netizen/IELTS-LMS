import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { AccessibilitySettings } from '../AccessibilitySettings';
import type { StudentPlaybackRate } from '../accessibilityPreferences';

// jsdom doesn't implement HTMLDialogElement — polyfill showModal/close for tests
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

function renderDialog(overrides: Partial<Parameters<typeof AccessibilitySettings>[0]> = {}) {
  const props: Parameters<typeof AccessibilitySettings>[0] = {
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
  render(<AccessibilitySettings {...props} />);
  return props;
}

describe('AccessibilitySettings', () => {
  it('renders the reading-comfort, display, and listening sections', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: /accessibility/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Small/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Medium/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Large/ })).toBeInTheDocument();
    expect(screen.getByText(/passage layout/i)).toBeInTheDocument();
    expect(screen.getByTestId('passage-layout-option-0')).toBeInTheDocument();
    expect(screen.getByTestId('passage-layout-option-1')).toBeInTheDocument();
    expect(screen.getByTestId('passage-layout-option-2')).toBeInTheDocument();
    expect(screen.getByText(/high contrast mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByText(/playback speed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /0\.75/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1\.25/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument();
    expect(screen.getByText(/applies to your next exam/i)).toBeInTheDocument();
  });

  it('keeps highlight tool controls out of the modal', () => {
    renderDialog();

    expect(screen.queryByRole('button', { name: /enable highlight mode/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select yellow highlight color/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select blue highlight color/i })).not.toBeInTheDocument();
  });

  it('marks the active font size and passage layout with aria-pressed', () => {
    renderDialog({ fontSize: 'large', passageReadabilityLevel: 2 });

    expect(screen.getByTestId('font-size-option-large')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('font-size-option-normal')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('passage-layout-option-2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('passage-layout-option-0')).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders passage layout previews with the level geometry', () => {
    renderDialog({ passageReadabilityLevel: 2 });

    const extraLargePreview = screen.getByTestId('passage-layout-preview-2');
    expect(extraLargePreview).toHaveAttribute('style', expect.stringContaining('line-height: 1.62'));
    expect(extraLargePreview).toHaveAttribute('style', expect.stringContaining('max-width: 60ch'));
    const compactPreview = screen.getByTestId('passage-layout-preview-0');
    expect(compactPreview).toHaveAttribute('style', expect.stringContaining('line-height: 1.4'));
    expect(compactPreview).toHaveAttribute('style', expect.stringContaining('max-width: 74ch'));
  });

  it('zooms via the stepper and reports the current percentage', () => {
    const { onZoomChange } = renderDialog({ zoom: 1.2 });

    expect(screen.getByTestId('zoom-value')).toHaveTextContent('120%');
    expect(screen.getByTestId('zoom-reset')).toBeInTheDocument();

    screen.getByTestId('zoom-increase').click();
    expect(onZoomChange).toHaveBeenCalledWith(1.3);
    screen.getByTestId('zoom-decrease').click();
    expect(onZoomChange).toHaveBeenCalledWith(1.1);
    screen.getByTestId('zoom-reset').click();
    expect(onZoomChange).toHaveBeenCalledWith(1);
  });

  it('disables zoom buttons at the bounds', () => {
    renderDialog({ zoom: 0.85 });

    expect(screen.getByTestId('zoom-decrease')).toBeDisabled();
    expect(screen.getByTestId('zoom-increase')).not.toBeDisabled();
    expect(screen.getByTestId('zoom-reset')).toBeInTheDocument();
  });

  it('hides the zoom reset link at 100%', () => {
    renderDialog({ zoom: 1 });

    expect(screen.getByTestId('zoom-decrease')).not.toBeDisabled();
    expect(screen.getByTestId('zoom-increase')).not.toBeDisabled();
    expect(screen.queryByTestId('zoom-reset')).not.toBeInTheDocument();
  });

  it('reports playback rate changes with the active rate pressed', () => {
    const { onPlaybackRateChange } = renderDialog({ playbackRate: 1.25 });

    expect(screen.getByTestId('playback-rate-1.25')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('playback-rate-1')).toHaveAttribute('aria-pressed', 'false');

    screen.getByTestId('playback-rate-0.75').click();
    expect(onPlaybackRateChange).toHaveBeenCalledWith(0.75 as StudentPlaybackRate);
  });

  it('calls reset defaults from the quiet footer action', () => {
    const { onResetDefaults } = renderDialog();

    screen.getByTestId('reset-preferences').click();
    expect(onResetDefaults).toHaveBeenCalledTimes(1);
  });
});
