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
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#a7f3d0');
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
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#a7f3d0');

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
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#fde68a');
  });

  it('updates the tint color when the student switches colors mid-session', () => {
    const { container } = render(
      <StudentUIProvider>
        <SelectionTintSwitchHarness />
      </StudentUIProvider>,
    );

    const surface = surfaceOf(container);
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#a7f3d0');
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#bae6fd');
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
    expect(surface.style.getPropertyValue('--student-highlight-selection-color')).toBe('#ddd6fe');
  });
});
