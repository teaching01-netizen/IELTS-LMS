import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccessibilitySettings } from '../AccessibilitySettings';

describe('AccessibilitySettings', () => {
  it('keeps zoom and highlight controls out of the modal', () => {
    render(
      <AccessibilitySettings
        isOpen
        onClose={vi.fn()}
        fontSize="normal"
        highContrast={false}
        onFontSizeChange={vi.fn()}
        onHighContrastToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: /accessibility/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /small/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /normal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /large/i })).toBeInTheDocument();
    expect(screen.getByText(/high contrast mode/i)).toBeInTheDocument();
    expect(screen.getByText(/increase color contrast for better readability/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zoom in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zoom out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable highlight mode/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disable highlight mode/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select yellow highlight color/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select amber highlight color/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select green highlight color/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select blue highlight color/i })).not.toBeInTheDocument();
  });
});
