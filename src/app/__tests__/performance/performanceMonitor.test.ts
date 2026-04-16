/**
 * Performance tests for critical utilities
 * Ensures performance metrics stay within acceptable bounds
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { performanceMonitor } from '../../monitoring/performanceMonitor';

describe('Performance Monitor Tests', () => {
  beforeEach(() => {
    performanceMonitor.clearMetrics();
  });

  it('should measure function execution time', async () => {
    const fn = async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'result';
    };

    const result = await performanceMonitor.measure('test-operation', fn);

    expect(result).toBe('result');
    const metrics = performanceMonitor.getMetricsByName('test-operation');
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.duration).toBeGreaterThan(0);
  });

  it('should calculate average duration correctly', async () => {
    const fn = async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return 'result';
    };

    await performanceMonitor.measure('test-operation', fn);
    await performanceMonitor.measure('test-operation', fn);
    await performanceMonitor.measure('test-operation', fn);

    const average = performanceMonitor.getAverageDuration('test-operation');
    expect(average).toBeGreaterThan(0);
    expect(average).toBeLessThan(100); // Should complete in reasonable time
  });

  it('should calculate P95 duration correctly', async () => {
    const fn = async (duration: number) => {
      await new Promise(resolve => setTimeout(resolve, duration));
      return 'result';
    };

    await performanceMonitor.measure('test-operation', () => fn(10));
    await performanceMonitor.measure('test-operation', () => fn(20));
    await performanceMonitor.measure('test-operation', () => fn(30));
    await performanceMonitor.measure('test-operation', () => fn(40));
    await performanceMonitor.measure('test-operation', () => fn(50));

    const p95 = performanceMonitor.getP95Duration('test-operation');
    expect(p95).toBeGreaterThan(40);
  });

  it('should limit metrics to max size', async () => {
    const fn = async () => 'result';

    // Record more than maxMetrics (100)
    for (let i = 0; i < 150; i++) {
      await performanceMonitor.measure('test-operation', fn);
    }

    const metrics = performanceMonitor.getMetrics();
    expect(metrics.length).toBeLessThanOrEqual(100);
  });

  it('should clear metrics', async () => {
    const fn = async () => 'result';
    await performanceMonitor.measure('test-operation', fn);

    expect(performanceMonitor.getMetrics()).toHaveLength(1);

    performanceMonitor.clearMetrics();
    expect(performanceMonitor.getMetrics()).toHaveLength(0);
  });

  it('should export metrics as JSON', async () => {
    const fn = async () => 'result';
    await performanceMonitor.measure('test-operation', fn, { key: 'value' });

    const exported = performanceMonitor.exportMetrics();
    const parsed = JSON.parse(exported) as Array<{
      name: string;
      metadata?: Record<string, unknown>;
    }>;

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.name).toBe('test-operation');
    expect(parsed[0]!.metadata).toEqual({ key: 'value' });
  });
});
