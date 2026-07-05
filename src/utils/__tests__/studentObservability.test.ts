import { describe, expect, it, vi, afterEach } from 'vitest';
import { withStudentObservabilityDimensions, emitStudentObservabilityMetric } from '../studentObservability';

describe('withStudentObservabilityDimensions', () => {
  it('normalizes string fields to null when empty', () => {
    const result = withStudentObservabilityDimensions({
      attemptId: '',
      scheduleId: '  ',
      endpoint: '',
    });
    expect(result.attemptId).toBeNull();
    expect(result.scheduleId).toBeNull();
    expect(result.endpoint).toBeNull();
  });

  it('preserves non-empty string fields', () => {
    const result = withStudentObservabilityDimensions({
      attemptId: 'att-1',
      scheduleId: 'sched-1',
      endpoint: '/v1/student/sessions',
    });
    expect(result.attemptId).toBe('att-1');
    expect(result.scheduleId).toBe('sched-1');
    expect(result.endpoint).toBe('/v1/student/sessions');
  });

  it('normalizes number fields to null when not finite', () => {
    const result = withStudentObservabilityDimensions({
      pendingMutationCount: NaN,
      pendingMutationAgeMs: Infinity,
      statusCode: NaN,
    });
    expect(result.pendingMutationCount).toBeNull();
    expect(result.pendingMutationAgeMs).toBeNull();
    expect(result.statusCode).toBeNull();
  });

  it('preserves finite number fields', () => {
    const result = withStudentObservabilityDimensions({
      pendingMutationCount: 42,
      pendingMutationAgeMs: 1500,
      statusCode: 200,
    });
    expect(result.pendingMutationCount).toBe(42);
    expect(result.pendingMutationAgeMs).toBe(1500);
    expect(result.statusCode).toBe(200);
  });

  it('sets version from environment or falls back to unknown', () => {
    const result = withStudentObservabilityDimensions({});
    expect(typeof result.version).toBe('string');
    expect(result.version).not.toBe('');
  });

  it('includes custom fields', () => {
    const result = withStudentObservabilityDimensions({
      customField: 'custom-value',
      anotherField: 123,
    });
    expect((result as any).customField).toBe('custom-value');
    expect((result as any).anotherField).toBe(123);
  });

  it('normalizes null fields to null', () => {
    const result = withStudentObservabilityDimensions({
      attemptId: null,
      scheduleId: undefined,
    });
    expect(result.attemptId).toBeNull();
    expect(result.scheduleId).toBeNull();
  });
});

describe('emitStudentObservabilityMetric', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches custom event with metric name and fields', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    emitStudentObservabilityMetric('test_metric', { attemptId: 'att-1' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('student-observability-metric');
    expect(event.detail.name).toBe('test_metric');
    expect(event.detail.attemptId).toBe('att-1');
  });

  it('does not throw when window is undefined', () => {
    const originalWindow = globalThis.window;
    try {
      (globalThis as any).window = undefined;
      expect(() => emitStudentObservabilityMetric('test')).not.toThrow();
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});
