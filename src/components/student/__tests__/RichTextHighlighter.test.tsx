import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { RichTextHighlighter } from '../RichTextHighlighter';
import { StudentUIProvider, useStudentUI } from '../providers/StudentUIProvider';

function SelectionTintHarness() {
  const { state, actions } = useStudentUI();
  return (
    <>
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled
        highlightColor={state.accessibilitySettings.highlightColor}
      />
      <button type="button" onClick={() => actions.setHighlightColor('green')}>
        Paint green
      </button>
      <button type="button" onClick={() => actions.resetHighlightTool()}>
        Reset tool
      </button>
    </>
  );
}

function SelectionTintSwitchHarness() {
  const { state, actions } = useStudentUI();
  return (
    <>
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled
        highlightColor={state.accessibilitySettings.highlightColor}
      />
      <button type="button" onClick={() => actions.setHighlightColor('green')}>
        Green
      </button>
      <button type="button" onClick={() => actions.setHighlightColor('blue')}>
        Blue
      </button>
    </>
  );
}

function ProviderColorOverrideHarness() {
  const { actions } = useStudentUI();
  return (
    <>
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled
        highlightColor="purple"
      />
      <button type="button" onClick={() => actions.setHighlightColor('green')}>
        Paint green
      </button>
    </>
  );
}

describe('RichTextHighlighter user-select ownership', () => {
  // The passage stays selectable, but NOT because this component says so: the
  // declaration lives in the stylesheet, which is the only place that can also
  // turn selection off for a locked exam on a touch device (index.css). An
  // inline `user-select` here would outrank that rule on this element and leave
  // the two contradicting each other. See StudentQuestionCalloutCss.test.ts for
  // the stylesheet half.
  it.each([true, false])('declares no inline user-select when enabled=%s', (enabled) => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled={enabled}
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.userSelect).toBe('');
    expect(wrapper.style.getPropertyValue('-webkit-user-select')).toBe('');
  });

  it('declares no inline touch-action, so the stylesheet decides who owns the drag', () => {
    // Pannable by default is what `auto` already means, and the default is the
    // stylesheet's to keep: an inline value would outrank the exam-scoped rule
    // that takes the drag for the app while a highlight tool is armed
    // (`touch-action: none`, see index.css), which is exactly how a real browser
    // came to steal the gesture and cancel the selection mid-drag.
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled={false}
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    // Read off the attribute rather than `style.touchAction`: jsdom does not
    // model that property, so it reports `undefined` for an unset declaration.
    expect(wrapper.getAttribute('style') ?? '').not.toContain('touch-action');
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

describe('highlight tool selection tint', () => {
  function surfaceOf(container: HTMLElement): HTMLElement {
    const surface = container.querySelector('[data-student-highlightable="true"]');
    expect(surface).not.toBeNull();
    return surface as HTMLElement;
  }

  it('previews the resolved highlight color as the selection tint while highlight mode is active', () => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled
        highlightToolMode="highlight"
        highlightColor="green"
      />,
    );

    const surface = surfaceOf(container);
    expect(surface).toHaveAttribute('data-student-highlight-selection', 'true');
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#b9d6c3');
  });

  it('turns the selection tint on and off through the real provider actions', () => {
    const { container } = render(
      <StudentUIProvider>
        <SelectionTintHarness />
      </StudentUIProvider>,
    );

    const surface = surfaceOf(container);
    expect(surface).not.toHaveAttribute('data-student-highlight-selection');

    fireEvent.click(screen.getByRole('button', { name: 'Paint green' }));
    expect(surface).toHaveAttribute('data-student-highlight-selection', 'true');
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#b9d6c3');

    fireEvent.click(screen.getByRole('button', { name: 'Reset tool' }));
    expect(surface).not.toHaveAttribute('data-student-highlight-selection');
  });
});

describe('highlight tool selection tint adversarials', () => {
  function surfaceOf(container: HTMLElement): HTMLElement {
    const surface = container.querySelector('[data-student-highlightable="true"]');
    expect(surface).not.toBeNull();
    return surface as HTMLElement;
  }

  it('shows no tint while the tool is off even when a color is set', () => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled
        highlightToolMode="off"
        highlightColor="green"
      />,
    );

    expect(surfaceOf(container)).not.toHaveAttribute('data-student-highlight-selection');
  });

  it('shows no tint in erase mode because erase selections do not paint', () => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled
        highlightToolMode="erase"
        highlightColor="green"
      />,
    );

    expect(surfaceOf(container)).not.toHaveAttribute('data-student-highlight-selection');
  });

  it('shows no tint on a disabled surface where a selection cannot create a highlight', () => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled={false}
        highlightToolMode="highlight"
        highlightColor="green"
      />,
    );

    expect(surfaceOf(container)).not.toHaveAttribute('data-student-highlight-selection');
  });

  it('falls back to the default color the surface would actually paint', () => {
    const { container } = render(
      <RichTextHighlighter
        content="<p>Hello world</p>"
        contentType="html"
        enabled
        highlightToolMode="highlight"
      />,
    );

    const surface = surfaceOf(container);
    expect(surface).toHaveAttribute('data-student-highlight-selection', 'true');
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#e8cd95');
  });

  it('updates the tint color when the student switches colors mid-session', () => {
    const { container } = render(
      <StudentUIProvider>
        <SelectionTintSwitchHarness />
      </StudentUIProvider>,
    );

    const surface = surfaceOf(container);
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#b9d6c3');
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#b3d3f1');
  });

  it('prefers the surface color prop over the provider color so preview matches paint', () => {
    const { container } = render(
      <StudentUIProvider>
        <ProviderColorOverrideHarness />
      </StudentUIProvider>,
    );

    const surface = surfaceOf(container);
    fireEvent.click(screen.getByRole('button', { name: 'Paint green' }));
    expect(surface).toHaveAttribute('data-student-highlight-selection', 'true');
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#d5c7e2');
  });
});
