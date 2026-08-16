import { describe, expect, it } from 'vitest';
import { createBrowserNetworkMonitor } from '../BrowserNetworkMonitor';
import { createBrowserVisibilityMonitor } from '../BrowserVisibilityMonitor';

describe('browser platform monitors', () => {
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
    const originalVisibilityState = document.visibilityState;

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState,
    });
    unsubscribe();

    expect(events).toEqual(['VISIBILITY_HIDDEN', 'VISIBILITY_VISIBLE']);
  });
});
