import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
  STUDENT_PASSAGE_READABILITY_MAX,
  STUDENT_PASSAGE_READABILITY_MIN,
} from '../../accessibilityScale';
import { StudentUIProvider, useStudentUI } from '../StudentUIProvider';

describe('StudentUIProvider readability controls', () => {
  it('defaults to comfort readability level and clamps increment/decrement', () => {
    let context: ReturnType<typeof useStudentUI> | null = null;

    function Probe() {
      context = useStudentUI();
      return null;
    }

    render(
      <StudentUIProvider>
        <Probe />
      </StudentUIProvider>,
    );

    expect(context).not.toBeNull();
    expect(context!.state.accessibilitySettings.passageReadabilityLevel).toBe(
      DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
    );

    act(() => {
      for (let step = 0; step < 10; step += 1) {
        context!.actions.increasePassageReadability();
      }
    });

    expect(context!.state.accessibilitySettings.passageReadabilityLevel).toBe(
      STUDENT_PASSAGE_READABILITY_MAX,
    );

    act(() => {
      for (let step = 0; step < 10; step += 1) {
        context!.actions.decreasePassageReadability();
      }
    });

    expect(context!.state.accessibilitySettings.passageReadabilityLevel).toBe(
      STUDENT_PASSAGE_READABILITY_MIN,
    );

    act(() => {
      context!.actions.resetPassageReadability();
    });

    expect(context!.state.accessibilitySettings.passageReadabilityLevel).toBe(
      DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
    );
  });

  it('keeps context identities stable when the provider rerenders without state changes', () => {
    let context: ReturnType<typeof useStudentUI> | null = null;

    function Probe() {
      context = useStudentUI();
      return null;
    }

    const rendered = render(
      <StudentUIProvider>
        <Probe />
      </StudentUIProvider>,
    );
    const firstContext = context!;

    rendered.rerender(
      <StudentUIProvider>
        <Probe />
      </StudentUIProvider>,
    );

    expect(context).toBe(firstContext);
    expect(context!.state).toBe(firstContext.state);
    expect(context!.actions).toBe(firstContext.actions);
  });
});

describe('StudentUIProvider time extension state', () => {
  it('normalizes nullish time extension reasons to an empty string', () => {
    let context: ReturnType<typeof useStudentUI> | null = null;

    function Probe() {
      context = useStudentUI();
      return null;
    }

    render(
      <StudentUIProvider>
        <Probe />
      </StudentUIProvider>,
    );

    act(() => {
      context!.actions.setTimeExtensionReason(null as unknown as string);
    });

    expect(context!.state.timeExtensionReason).toBe('');
  });
});

describe('StudentUIProvider removed help modal contract', () => {
  it('does not expose help modal state or actions', () => {
    let context: ReturnType<typeof useStudentUI> | null = null;

    function Probe() {
      context = useStudentUI();
      return null;
    }

    render(
      <StudentUIProvider>
        <Probe />
      </StudentUIProvider>,
    );

    expect(context).not.toBeNull();
    expect('showHelp' in context!.state).toBe(false);
    expect('setShowHelp' in context!.actions).toBe(false);
  });
});

describe('StudentUIProvider highlight tool state', () => {
  it('defaults off with yellow selected and preserves the last color when toggled', () => {
    let context: ReturnType<typeof useStudentUI> | null = null;

    function Probe() {
      context = useStudentUI();
      return null;
    }

    render(
      <StudentUIProvider>
        <Probe />
      </StudentUIProvider>,
    );

    expect(context!.state.accessibilitySettings.highlightToolMode).toBe('off');
    expect(context!.state.accessibilitySettings.highlightColor).toBe('yellow');

    act(() => context!.actions.setHighlightColor('blue'));
    expect(context!.state.accessibilitySettings.highlightToolMode).toBe('highlight');
    expect(context!.state.accessibilitySettings.highlightColor).toBe('blue');

    act(() => context!.actions.toggleHighlightMode());
    expect(context!.state.accessibilitySettings.highlightToolMode).toBe('off');

    act(() => context!.actions.toggleHighlightMode());
    expect(context!.state.accessibilitySettings.highlightToolMode).toBe('highlight');
    expect(context!.state.accessibilitySettings.highlightColor).toBe('blue');

    act(() => context!.actions.setHighlightToolMode('erase'));
    expect(context!.state.accessibilitySettings.highlightToolMode).toBe('erase');

    act(() => context!.actions.resetHighlightTool());
    expect(context!.state.accessibilitySettings.highlightToolMode).toBe('off');
    expect(context!.state.accessibilitySettings.highlightColor).toBe('blue');
  });
});

describe('StudentUIProvider persisted accessibility preferences', () => {
  const storageKey = 'student-accessibility:test:probe';

  function Probe({ onContext }: { onContext: (context: ReturnType<typeof useStudentUI>) => void }) {
    onContext(useStudentUI());
    return null;
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads persisted preferences as the initial state', () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        fontSize: 'large',
        highContrast: true,
        zoom: 1.3,
        passageReadabilityLevel: 2,
        playbackRate: 1.25,
      }),
    );

    let context: ReturnType<typeof useStudentUI> | null = null;
    render(
      <StudentUIProvider storageKey={storageKey}>
        <Probe onContext={(value) => { context = value; }} />
      </StudentUIProvider>,
    );

    const settings = context!.state.accessibilitySettings;
    expect(settings.fontSize).toBe('large');
    expect(settings.highContrast).toBe(true);
    expect(settings.zoom).toBe(1.3);
    expect(settings.passageReadabilityLevel).toBe(2);
    expect(settings.playbackRate).toBe(1.25);
  });

  it('falls back to defaults when stored data is corrupt', () => {
    window.localStorage.setItem(storageKey, '{not json');

    let context: ReturnType<typeof useStudentUI> | null = null;
    render(
      <StudentUIProvider storageKey={storageKey}>
        <Probe onContext={(value) => { context = value; }} />
      </StudentUIProvider>,
    );

    const settings = context!.state.accessibilitySettings;
    expect(settings.fontSize).toBe('normal');
    expect(settings.highContrast).toBe(false);
    expect(settings.zoom).toBe(1);
    expect(settings.passageReadabilityLevel).toBe(DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL);
    expect(settings.playbackRate).toBe(1);
  });

  it('persists preference changes to localStorage', () => {
    let context: ReturnType<typeof useStudentUI> | null = null;
    render(
      <StudentUIProvider storageKey={storageKey}>
        <Probe onContext={(value) => { context = value; }} />
      </StudentUIProvider>,
    );

    act(() => context!.actions.setFontSize('large'));
    act(() => context!.actions.setPlaybackRate(1.5));
    act(() => context!.actions.setPassageReadabilityLevel(0));

    const stored = JSON.parse(window.localStorage.getItem(storageKey)!) as Record<string, unknown>;
    expect(stored.fontSize).toBe('large');
    expect(stored.playbackRate).toBe(1.5);
    expect(stored.passageReadabilityLevel).toBe(0);
  });

  it('resetAccessibilitySettings restores defaults and persists them', () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ fontSize: 'large', highContrast: true, zoom: 1.4, passageReadabilityLevel: 2, playbackRate: 1.5 }),
    );

    let context: ReturnType<typeof useStudentUI> | null = null;
    render(
      <StudentUIProvider storageKey={storageKey}>
        <Probe onContext={(value) => { context = value; }} />
      </StudentUIProvider>,
    );

    act(() => context!.actions.resetAccessibilitySettings());

    const settings = context!.state.accessibilitySettings;
    expect(settings.fontSize).toBe('normal');
    expect(settings.highContrast).toBe(false);
    expect(settings.zoom).toBe(1);
    expect(settings.playbackRate).toBe(1);

    const stored = JSON.parse(window.localStorage.getItem(storageKey)!) as Record<string, unknown>;
    expect(stored.fontSize).toBe('normal');
    expect(stored.highContrast).toBe(false);
    expect(stored.zoom).toBe(1);
    expect(stored.playbackRate).toBe(1);
  });

  it('never touches storage when no storageKey is provided', () => {
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    const removeItemSpy = vi.spyOn(window.localStorage, 'removeItem');

    let context: ReturnType<typeof useStudentUI> | null = null;
    render(
      <StudentUIProvider>
        <Probe onContext={(value) => { context = value; }} />
      </StudentUIProvider>,
    );

    act(() => context!.actions.setFontSize('small'));

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });

  it('normalizes zoom values to two decimals', () => {
    let context: ReturnType<typeof useStudentUI> | null = null;
    render(
      <StudentUIProvider storageKey={storageKey}>
        <Probe onContext={(value) => { context = value; }} />
      </StudentUIProvider>,
    );

    act(() => context!.actions.setZoom(1.0999999999999999));
    expect(context!.state.accessibilitySettings.zoom).toBe(1.1);

    act(() => context!.actions.setZoom(0.849));
    expect(context!.state.accessibilitySettings.zoom).toBe(0.85);
  });
});
