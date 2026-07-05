import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  StudentHighlightSelectionManagerProvider,
  useHighlightSelectionManager,
} from '../highlightSelectionManager';

function createTestHarness() {
  let managerValue: ReturnType<typeof useHighlightSelectionManager> | null = null;

  function Probe() {
    managerValue = useHighlightSelectionManager();
    return null;
  }

  const result = render(
    <StudentHighlightSelectionManagerProvider>
      <Probe />
    </StudentHighlightSelectionManagerProvider>,
  );

  return {
    get value() { return managerValue!; },
    ...result,
  };
}

describe('StudentHighlightSelectionManagerProvider', () => {
  it('provides null activeSurfaceId initially', () => {
    const harness = createTestHarness();
    expect(harness.value.activeSurfaceId).toBeNull();
  });

  it('claimSurface sets activeSurfaceId', () => {
    const harness = createTestHarness();

    act(() => {
      harness.value.claimSurface('surface-1');
    });

    expect(harness.value.activeSurfaceId).toBe('surface-1');
  });

  it('claimSurface replaces previous surface', () => {
    const harness = createTestHarness();

    act(() => {
      harness.value.claimSurface('surface-1');
    });
    act(() => {
      harness.value.claimSurface('surface-2');
    });

    expect(harness.value.activeSurfaceId).toBe('surface-2');
  });

  it('releaseSurface clears activeSurfaceId when releasing the active surface', () => {
    const harness = createTestHarness();

    act(() => {
      harness.value.claimSurface('surface-1');
    });
    act(() => {
      harness.value.releaseSurface('surface-1');
    });

    expect(harness.value.activeSurfaceId).toBeNull();
  });

  it('releaseSurface does nothing when releasing a different surface', () => {
    const harness = createTestHarness();

    act(() => {
      harness.value.claimSurface('surface-1');
    });
    act(() => {
      harness.value.releaseSurface('surface-2');
    });

    expect(harness.value.activeSurfaceId).toBe('surface-1');
  });

  it('claimSurface with same surfaceId is idempotent', () => {
    const harness = createTestHarness();

    act(() => {
      harness.value.claimSurface('surface-1');
    });
    act(() => {
      harness.value.claimSurface('surface-1');
    });

    expect(harness.value.activeSurfaceId).toBe('surface-1');
  });

  it('releaseSurface on null activeSurfaceId is a no-op', () => {
    const harness = createTestHarness();

    expect(harness.value.activeSurfaceId).toBeNull();

    act(() => {
      harness.value.releaseSurface('surface-1');
    });

    expect(harness.value.activeSurfaceId).toBeNull();
  });

  it('returns stable function references across re-renders', () => {
    const harness = createTestHarness();

    const firstClaim = harness.value.claimSurface;
    const firstRelease = harness.value.releaseSurface;

    act(() => {
      harness.value.claimSurface('surface-1');
    });

    expect(harness.value.claimSurface).toBe(firstClaim);
    expect(harness.value.releaseSurface).toBe(firstRelease);
  });
});
