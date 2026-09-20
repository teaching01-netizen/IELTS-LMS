import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserNetworkMonitor } from '../BrowserNetworkMonitor';
import {
  createBrowserVisibilityMonitor,
  sharedBrowserVisibilityMonitor,
} from '../BrowserVisibilityMonitor';

function withVisibilityState(state: 'visible' | 'hidden', run: () => void) {
  const original = document.visibilityState;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
  try {
    run();
  } finally {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: original,
    });
  }
}

describe('browser platform monitors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('translates browser network events into platform events', () => {
    const events: string[] = [];
    const unsubscribe = createBrowserNetworkMonitor().subscribe((event) => {
      events.push(event.type);
    });

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    unsubscribe();

    expect(events).toEqual(['NETWORK_OFFLINE', 'NETWORK_ONLINE']);
  });

  it('translates visibility changes without deciding whether the exam is blocked', () => {
    const events: string[] = [];
    const unsubscribe = createBrowserVisibilityMonitor().subscribe((event) => {
      events.push(event.type);
    });

    withVisibilityState('hidden', () => document.dispatchEvent(new Event('visibilitychange')));
    withVisibilityState('visible', () => document.dispatchEvent(new Event('visibilitychange')));
    unsubscribe();

    expect(events).toEqual(['VISIBILITY_HIDDEN', 'VISIBILITY_VISIBLE']);
  });

  it('stamps every normalized event with an ISO timestamp', () => {
    const timestamps: string[] = [];
    const unsubscribe = createBrowserVisibilityMonitor().subscribe((event) => {
      timestamps.push(event.timestamp);
    });

    withVisibilityState('hidden', () => document.dispatchEvent(new Event('visibilitychange')));
    unsubscribe();

    expect(timestamps).toHaveLength(1);
    expect(Number.isFinite(Date.parse(timestamps[0] ?? ''))).toBe(true);
  });

  it('keeps exactly one document listener for every provider and detaches with the last one', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const monitor = sharedBrowserVisibilityMonitor();
    const first: string[] = [];
    const second: string[] = [];

    const unsubscribeFirst = monitor.subscribe((event) => first.push(event.type));
    const unsubscribeSecond = monitor.subscribe((event) => second.push(event.type));

    const attachCount = addSpy.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    expect(attachCount).toBe(1);

    withVisibilityState('hidden', () => document.dispatchEvent(new Event('visibilitychange')));
    expect(first).toEqual(['VISIBILITY_HIDDEN']);
    expect(second).toEqual(['VISIBILITY_HIDDEN']);

    unsubscribeFirst();
    const detachBeforeLast = removeSpy.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    expect(detachBeforeLast).toBe(0);

    withVisibilityState('visible', () => document.dispatchEvent(new Event('visibilitychange')));
    expect(first).toEqual(['VISIBILITY_HIDDEN']);
    expect(second).toEqual(['VISIBILITY_HIDDEN', 'VISIBILITY_VISIBLE']);

    unsubscribeSecond();
    const detachAfterLast = removeSpy.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    expect(detachAfterLast).toBe(1);
  });
});
