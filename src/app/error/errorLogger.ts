/**
 * Centralized error logging service
 * Provides structured logging with different log levels
 */

import { isAppError } from './errorTypes';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  code?: string;
  context?: Record<string, unknown> | undefined;
  stack?: string;
  userId?: string;
  sessionId?: string;
}

interface MonitoringWindow extends Window {
  Sentry?: {
    captureException: (entry: LogEntry) => void;
  };
}

class ErrorLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 100; // Keep last 100 logs in memory
  private userId: string | null = null;
  private sessionId: string | null = null;

  /**
   * Set user context for logging
   */
  setUserContext(userId: string, sessionId?: string): void {
    this.userId = userId;
    this.sessionId = sessionId || null;
  }

  /**
   * Clear user context
   */
  clearUserContext(): void {
    this.userId = null;
    this.sessionId = null;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an error
   */
  error(error: unknown, context?: Record<string, unknown>): void {
    let message: string;
    let code: string | undefined;
    let stack: string | undefined;

    if (isAppError(error)) {
      message = error.message;
      code = error.code;
      stack = error.stack;
    } else if (error instanceof Error) {
      message = error.message;
      code = error.name;
      stack = error.stack;
    } else if (typeof error === 'string') {
      message = error;
    } else {
      message = 'Unknown error occurred';
    }

    this.log(LogLevel.ERROR, message, { ...context, code, stack });
  }

  /**
   * Internal logging method
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
    };

    if (context) {
      entry.context = context;
    }

    if (this.userId) {
      entry.userId = this.userId;
    }

    if (this.sessionId) {
      entry.sessionId = this.sessionId;
    }

    if (typeof context?.['code'] === 'string') {
      entry.code = context['code'];
    }

    if (typeof context?.['stack'] === 'string') {
      entry.stack = context['stack'];
    }

    // Add to in-memory logs
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Output to console
    this.outputToConsole(entry);

    // In production, send to external monitoring service
    if (import.meta.env.PROD) {
      this.sendToMonitoring(entry);
    }
  }

  /**
   * Output to console with appropriate method
   */
  private outputToConsole(entry: LogEntry): void {
    const { level, timestamp, message, context, code, stack } = entry;
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}${code ? ` (${code})` : ''}`;

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logMessage, context || '');
        break;
      case LogLevel.INFO:
        console.info(logMessage, context || '');
        break;
      case LogLevel.WARN:
        console.warn(logMessage, context || '');
        break;
      case LogLevel.ERROR:
        console.error(logMessage, context || '', stack || '');
        break;
    }
  }

  /**
   * Send to external monitoring service (placeholder for Sentry, LogRocket, etc.)
   */
  private sendToMonitoring(entry: LogEntry): void {
    // TODO: Integrate with external monitoring service
    // Example: Sentry.captureException(entry)
    const sentry = typeof window !== 'undefined' ? (window as MonitoringWindow).Sentry : undefined;
    sentry?.captureException(entry);
  }

  /**
   * Get all logs from memory
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Clear all logs from memory
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Export logs as JSON string
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Singleton instance
export const errorLogger = new ErrorLogger();

/**
 * Convenience function to log errors
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  errorLogger.error(error, context);
}

/**
 * Convenience function to log warnings
 */
export function logWarn(message: string, context?: Record<string, unknown>): void {
  errorLogger.warn(message, context);
}

/**
 * Convenience function to log info
 */
export function logInfo(message: string, context?: Record<string, unknown>): void {
  errorLogger.info(message, context);
}

/**
 * Convenience function to log debug
 */
export function logDebug(message: string, context?: Record<string, unknown>): void {
  errorLogger.debug(message, context);
}
