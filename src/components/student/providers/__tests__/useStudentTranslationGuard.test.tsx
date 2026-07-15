import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudentTranslationGuard } from '../useStudentTranslationGuard';

describe('useStudentTranslationGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute('translate');
    document.documentElement.className = '';
    document.getElementById('student-notranslate-meta')?.remove();
    document.querySelectorAll('.translated-fixture').forEach((node) => node.remove());
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute('translate');
    document.documentElement.className = '';
    document.getElementById('student-notranslate-meta')?.remove();
    document.getElementById('goog-gt-tt')?.remove();
  });

  it('reports one violation per continuous known-marker episode', async () => {
    const report = vi.fn();
    renderHook(() => useStudentTranslationGuard(true, report));
    const googleMarker = document.createElement('div');
    googleMarker.id = 'goog-gt-tt';

    await act(async () => {
      document.body.appendChild(googleMarker);
      await vi.advanceTimersByTimeAsync(12_000);
      document.body.appendChild(document.createElement('span'));
      await Promise.resolve();
    });
    expect(report).toHaveBeenCalledTimes(1);

    await act(async () => {
      googleMarker.remove();
      await vi.advanceTimersByTimeAsync(2_000);
      document.body.appendChild(googleMarker);
      await Promise.resolve();
    });
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('keeps the guard installation stable when the callback identity changes', () => {
    const firstReport = vi.fn();
    const { rerender } = renderHook(
      ({ report }) => useStudentTranslationGuard(true, report),
      { initialProps: { report: firstReport } },
    );
    const marker = document.getElementById('student-notranslate-meta');

    rerender({ report: vi.fn() });

    expect(document.getElementById('student-notranslate-meta')).toBe(marker);
    expect(document.documentElement).toHaveAttribute('translate', 'no');
    expect(document.documentElement).toHaveClass('notranslate', 'student-translation-guard-active');
  });

  it('does not alter the DOM while inactive', () => {
    document.documentElement.setAttribute('translate', 'yes');
    document.documentElement.className = 'host-class notranslate';
    const collision = document.createElement('div');
    collision.id = 'student-notranslate-meta';
    collision.dataset.owner = 'host';
    document.body.appendChild(collision);

    const { unmount } = renderHook(() => useStudentTranslationGuard(false, vi.fn()));
    unmount();

    expect(document.documentElement).toHaveAttribute('translate', 'yes');
    expect(document.documentElement.className).toBe('host-class notranslate');
    expect(document.getElementById('student-notranslate-meta')).toBe(collision);
    collision.remove();
  });

  it('preserves unrelated classes added while active and restores only owned class membership', () => {
    document.documentElement.className = 'host-before notranslate';
    const { unmount } = renderHook(() => useStudentTranslationGuard(true, vi.fn()));

    document.documentElement.classList.add('host-added-during-exam');
    unmount();

    expect(document.documentElement).toHaveClass(
      'host-before',
      'host-added-during-exam',
      'notranslate',
    );
    expect(document.documentElement).not.toHaveClass('student-translation-guard-active');
  });

  it.each(['genuine meta', 'wrong-tag collision'])(
    'restores prior root and marker state after active cleanup with a %s',
    (kind) => {
      document.documentElement.setAttribute('translate', 'yes');
      document.documentElement.className = 'host-class notranslate';
      const original =
        kind === 'genuine meta' ? document.createElement('meta') : document.createElement('div');
      original.id = 'student-notranslate-meta';
      original.setAttribute('data-owner', 'host');
      if (original instanceof HTMLMetaElement) {
        original.name = 'host-name';
        original.content = 'host-content';
        document.head.appendChild(original);
      } else {
        document.body.appendChild(original);
      }

      const { unmount } = renderHook(() => useStudentTranslationGuard(true, vi.fn()));
      expect(document.head.querySelector('#student-notranslate-meta')).toBeInstanceOf(HTMLMetaElement);
      unmount();

      expect(document.documentElement).toHaveAttribute('translate', 'yes');
      expect(document.documentElement.className).toBe('host-class notranslate');
      expect(document.getElementById('student-notranslate-meta')).toBe(original);
      expect(original.getAttribute('data-owner')).toBe('host');
      if (original instanceof HTMLMetaElement) {
        expect(original).toMatchObject({ name: 'host-name', content: 'host-content' });
        expect(original.parentElement).toBe(document.head);
      } else {
        expect(original.parentElement).toBe(document.body);
      }
      original.remove();
    },
  );
});
