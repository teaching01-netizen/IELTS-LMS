/**
 * Performance Tracker
 * Monitors and logs application performance metrics
 * Tracks render times, API calls, and custom performance markers
 */

import React from 'react';
import { logger } from '../../utils/logger';

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface PerformanceMarker {
  name: string;
  startTime: number;
  metadata?: Record<string, unknown> | undefined;
}

class PerformanceTracker {
  private metrics: PerformanceMetric[] = [];
  private markers: Map<string, PerformanceMarker> = new Map();
  private enabled: boolean;

  constructor(enabled = import.meta.env.DEV) {
    this.enabled = enabled;
  }

  /**
   * Start a performance marker
   */
  startMarker(name: string, metadata?: Record<string, unknown>): string {
    if (!this.enabled) return name;
    
    const marker: PerformanceMarker = {
      name,
      startTime: performance.now(),
    };

    if (metadata) {
      marker.metadata = metadata;
    }
    
    const id = `${name}-${Date.now()}`;
    this.markers.set(id, marker);
    return id;
  }

  /**
   * End a performance marker and record the metric
   */
  endMarker(id: string, metadata?: Record<string, unknown>): PerformanceMetric | null {
    if (!this.enabled) return null;
    
    const marker = this.markers.get(id);
    if (!marker) return null;
    
    const duration = performance.now() - marker.startTime;
    const metric: PerformanceMetric = {
      name: marker.name,
      duration,
      timestamp: Date.now(),
    };

    const mergedMetadata = { ...marker.metadata, ...metadata };
    if (Object.keys(mergedMetadata).length > 0) {
      metric.metadata = mergedMetadata;
    }
    
    this.metrics.push(metric);
    this.markers.delete(id);
    
    // Log to console in development
    if (this.enabled) {
      logger.performance(metric.name, duration, metric.metadata);
    }
    
    return metric;
  }

  /**
   * Record a custom metric directly
   */
  recordMetric(name: string, duration: number, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;
    
    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
    };

    if (metadata) {
      metric.metadata = metadata;
    }
    
    this.metrics.push(metric);
    
    if (this.enabled) {
      logger.performance(metric.name, duration, metric.metadata);
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
   * Get statistics for a metric name
   */
  getMetricStats(name: string) {
    const metrics = this.getMetricsByName(name);
    if (metrics.length === 0) return null;
    
    const durations = metrics.map(m => m.duration);
    const sorted = [...durations].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? max;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? max;
    
    return {
      count: metrics.length,
      min,
      max,
      average: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      median,
      p95,
      p99,
    };
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Clear metrics by name
   */
  clearMetricsByName(name: string): void {
    this.metrics = this.metrics.filter(m => m.name !== name);
  }

  /**
   * Enable or disable tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

// Singleton instance
export const performanceTracker = new PerformanceTracker();

/**
 * React hook for performance tracking
 */
export function usePerformanceTracker() {
  return {
    startMarker: (name: string, metadata?: Record<string, unknown>) =>
      performanceTracker.startMarker(name, metadata),
    endMarker: (id: string, metadata?: Record<string, unknown>) =>
      performanceTracker.endMarker(id, metadata),
    recordMetric: (name: string, duration: number, metadata?: Record<string, unknown>) =>
      performanceTracker.recordMetric(name, duration, metadata),
    getMetrics: () => performanceTracker.getMetrics(),
    getMetricStats: (name: string) => performanceTracker.getMetricStats(name),
    clearMetrics: () => performanceTracker.clearMetrics(),
  };
}

/**
 * Higher-order component to track render performance
 */
export function withPerformanceTracking<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  componentName: string
) {
  return function WithPerformanceTracking(props: P) {
    const tracker = usePerformanceTracker();
    
    React.useEffect(() => {
      const markerId = tracker.startMarker(`render-${componentName}`);
      return () => {
        tracker.endMarker(markerId);
      };
    });
    
    return React.createElement(WrappedComponent, props);
  };
}
