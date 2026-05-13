import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { HighlightableSurface } from '../HighlightableSurface';

describe('HighlightableSurface DOM stability', () => {
  it('does not replace inner text nodes when only toolbar visibility changes', () => {
    const html = '<p>Hello <strong>world</strong></p>';

    const { container, rerender } = render(
      <HighlightableSurface as="div" html={html} showToolbar={false} />,
    );

    const surface = container.querySelector('[data-student-highlightable="true"]') as HTMLElement;
    expect(surface).not.toBeNull();

    const beforeTextNode = surface.querySelector('p')?.firstChild;
    expect(beforeTextNode).not.toBeNull();

    rerender(
      <HighlightableSurface
        as="div"
        html={html}
        showToolbar
        toolbarPosition={{ left: 10, top: 10 }}
        canEraseSelection={false}
        onApplyColor={() => {}}
        onEraseSelection={() => {}}
      />,
    );

    const afterSurface = container.querySelector('[data-student-highlightable="true"]') as HTMLElement;
    const afterTextNode = afterSurface.querySelector('p')?.firstChild;
    expect(afterTextNode).toBe(beforeTextNode);
  });
});

