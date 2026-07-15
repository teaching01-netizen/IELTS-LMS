import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { HighlightableSurface } from '../HighlightableSurface';

describe('HighlightableSurface DOM stability', () => {
  it('does not replace inner text nodes when rerendered with unchanged HTML', () => {
    const html = '<p>Hello <strong>world</strong></p>';

    const { container, rerender } = render(
      <HighlightableSurface as="div" html={html} />,
    );

    const surface = container.querySelector('[data-student-highlightable="true"]') as HTMLElement;
    expect(surface).not.toBeNull();

    const beforeTextNode = surface.querySelector('p')?.firstChild;
    expect(beforeTextNode).not.toBeNull();

    rerender(
      <HighlightableSurface as="div" html={html} />,
    );

    const afterSurface = container.querySelector('[data-student-highlightable="true"]') as HTMLElement;
    const afterTextNode = afterSurface.querySelector('p')?.firstChild;
    expect(afterTextNode).toBe(beforeTextNode);
  });
});
