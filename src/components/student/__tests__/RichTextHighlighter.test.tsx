import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { RichTextHighlighter } from '../RichTextHighlighter';

describe('RichTextHighlighter user-select', () => {
  it('sets userSelect:text when enabled=true', () => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.userSelect).toBe('text');
  });

  it('sets userSelect:text even when enabled=false so passage text remains selectable', () => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled={false}
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.userSelect).toBe('text');
  });

  it('sets touchAction:auto when enabled=false so touch text selection works in passage pane', () => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled={false}
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.touchAction).toBe('auto');
  });

  it('keeps the same wrapper node across rerenders when enabled=false', () => {
    const { container, rerender } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled={false}
      />,
    );

    const before = container.firstElementChild;
    expect(before).not.toBeNull();

    rerender(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled={false}
      />,
    );

    const after = container.firstElementChild;
    expect(after).toBe(before);
  });
});
