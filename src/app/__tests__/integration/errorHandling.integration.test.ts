/**
 * Integration tests for error handling
 * Tests the interaction between error types, error logger, and error boundary
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LogLevel, errorLogger } from '../../error/errorLogger';
import { AppError, ValidationError } from '../../error/errorTypes';

describe('Error Handling Integration', () => {
  beforeEach(() => {
    errorLogger.clearLogs();
  });

  it('should log error with context', () => {
    const error = new AppError('Test error', 'TEST_ERROR', 500, { key: 'value' });
    errorLogger.error(error, { context: 'test-context' });

    const logs = errorLogger.getLogs();
    const firstLog = logs[0]!;
    expect(logs).toHaveLength(1);
    expect(firstLog.level).toBe(LogLevel.ERROR);
    expect(firstLog.context?.['context']).toBe('test-context');
  });

  it('should log error with code from AppError', () => {
    const error = new AppError('Test error', 'TEST_ERROR', 500);
    errorLogger.error(error);

    const logs = errorLogger.getLogs();
    expect(logs[0]!.code).toBe('TEST_ERROR');
  });

  it('should handle error chain through error types to logger', () => {
    const validationError = new ValidationError('Invalid field', 'email', 'invalid');
    errorLogger.error(validationError, { action: 'form-submit' });

    const logs = errorLogger.getLogs();
    expect(logs[0]!.code).toBe('VALIDATION_ERROR');
    expect(logs[0]!.context?.['action']).toBe('form-submit');
  });

  it('should filter logs by level', () => {
    errorLogger.info('Info message');
    errorLogger.warn('Warning message');
    errorLogger.error(new Error('Error message'));

    const errorLogs = errorLogger.getLogsByLevel(LogLevel.ERROR);
    const warnLogs = errorLogger.getLogsByLevel(LogLevel.WARN);
    const infoLogs = errorLogger.getLogsByLevel(LogLevel.INFO);

    expect(errorLogs).toHaveLength(1);
    expect(warnLogs).toHaveLength(1);
    expect(infoLogs).toHaveLength(1);
  });

  it('should export logs as JSON', () => {
    errorLogger.error(new Error('Test error'));
    const exported = errorLogger.exportLogs();

    expect(() => JSON.parse(exported)).not.toThrow();
    const parsed = JSON.parse(exported);
    expect(parsed).toHaveLength(1);
  });
});
