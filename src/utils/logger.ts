/**
 * Logging utility for the application
 * Provides structured logging with different levels and development-only output
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LOG_LEVEL: LogLevel = 
  (import.meta.env['VITE_LOG_LEVEL'] as LogLevel) || 
  (import.meta.env.DEV ? 'debug' : 'error');

class Logger {
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[CURRENT_LOG_LEVEL];
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  // Performance logging - always logs in development, can be controlled in production
  performance(metricName: string, duration: number, metadata?: Record<string, unknown>): void {
    if (import.meta.env.DEV || this.shouldLog('debug')) {
      console.log(`[PERFORMANCE] ${metricName}: ${duration.toFixed(2)}ms`, metadata || '');
    }
  }
}

export const logger = new Logger();
