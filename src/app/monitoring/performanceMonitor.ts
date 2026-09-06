/**
 * Performance Monitoring Utilities
 * Tracks and reports application performance metrics
 */

import React from 'react';
import { logWarn } from '../error/errorLogger';

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private maxMetrics = 100;

  /**
   * Measure the execution time of a function
   */
  async measure<T>(
    name: string,
    fn: () => Promise<T> | T,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = performance.now();
    
    try {
      const result = await fn();
      const duration = performance.now() - start;
      
      this.recordMetric(name, duration, metadata);
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordMetric(name, duration, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Record a performance metric
   */
  recordMetric(name: string, duration: number, metadata?: Record<string, unknown>): void {
    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
    };

    if (metadata) {
      metric.metadata = metadata;
    }

    this.metrics.push(metric);

    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log slow operations
    if (duration > 1000) {
      logWarn(`Slow operation detected: ${name}`, {
        duration: duration.toFixed(2),
        metadata,
      });
    }
  }

  /**
   * Get all metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Get metrics by name
   */
  getMetricsByName(name: string): PerformanceMetric[] {
    return this.metrics.filter(m => m.name === name);
  }

  /**
   * Get average duration for a metric name
   */
  getAverageDuration(name: string): number {
    const metrics = this.getMetricsByName(name);
    if (metrics.length === 0) return 0;
    
    const total = metrics.reduce((sum, m) => sum + m.duration, 0);
    return total / metrics.length;
  }

  /**
   * Get P95 duration for a metric name
   */
  getP95Duration(name: string): number {
    const metrics = this.getMetricsByName(name)
      .map(m => m.duration)
      .sort((a, b) => a - b);
    
    if (metrics.length === 0) return 0;
    
    const index = Math.min(Math.floor(metrics.length * 0.95), metrics.length - 1);
    return metrics[index] ?? 0;
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): string {
    return JSON.stringify(this.metrics, null, 2);
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * Hook for measuring component render performance
 */
export function usePerformanceMonitor(componentName: string, options?: { sampleRate?: number | undefined }) {
  const renderCount = React.useRef(0);
  const renderTimes = React.useRef<number[]>([]);
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  React.useEffect(() => {
    // Unsampled renders skip timing work entirely.
    const sampleRate = optionsRef.current?.sampleRate ?? 1;
    if (sampleRate < 1 && Math.random() > sampleRate) {
      return;
    }
    renderCount.current += 1;
    const mountDuration = performance.now();

    return () => {
      // Duration of the commit lifetime (mount -> unmount/update cleanup).
      const duration = performance.now() - mountDuration;
      renderTimes.current.push(duration);
      // Bound retained samples so long-lived components cannot grow memory.
      if (renderTimes.current.length > 100) {
        renderTimes.current.shift();
      }

      if (duration > 16) { // Log renders over 16ms (one frame at 60fps)
        logWarn(`Slow render in ${componentName}`, {
          duration: duration.toFixed(2),
          renderCount: renderCount.current,
        });
      }
    };
  // componentName is the only input that changes the logged label.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentName]);

  return {
    renderCount: renderCount.current,
    averageRenderTime:
      renderTimes.current.length > 0
        ? renderTimes.current.reduce((a, b) => a + b, 0) / renderTimes.current.length
        : 0,
  };
}

/**
 * HOC to measure component performance
 */
export function withPerformanceMonitor<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  componentName: string
): React.ComponentType<P> {
  function PerformanceMonitoredComponent(props: P) {
    usePerformanceMonitor(componentName);
    return React.createElement(WrappedComponent, props);
  }
  PerformanceMonitoredComponent.displayName = `withPerformanceMonitor(${WrappedComponent.displayName ?? WrappedComponent.name ?? 'Component'})`;
  return PerformanceMonitoredComponent;
}

/**
 * Measure API request performance
 */
export async function measureApiRequest<T>(
  endpoint: string,
  fn: () => Promise<T>
): Promise<T> {
  return performanceMonitor.measure(`API: ${endpoint}`, fn, {
    type: 'api_request',
    endpoint,
  });
}

/**
 * Measure database operation performance
 */
export async function measureDbOperation<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  return performanceMonitor.measure(`DB: ${operation}`, fn, {
    type: 'db_operation',
    operation,
  });
}

/**
 * Create a performance marker for browser DevTools
 */
export function markPerformance(name: string): void {
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(name);
  }
}

/**
 * Measure between two performance marks
 */
export function measurePerformance(name: string, startMark: string, endMark: string): void {
  if (typeof performance !== 'undefined' && performance.measure) {
    try {
      performance.measure(name, startMark, endMark);
    } catch (error) {
      // Marks might not exist, ignore
    }
  }
}
