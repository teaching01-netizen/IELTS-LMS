/**
 * Tests for error types
 */

import { describe, it, expect } from 'vitest';
import {
  AppError,
  NetworkError,
  ValidationError,
  AuthError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  isAppError,
  getErrorMessage,
  getErrorCode,
} from '../errorTypes';

describe('Error Types', () => {
  describe('AppError', () => {
    it('should create an AppError with correct properties', () => {
      const error = new AppError('Test error', 'TEST_ERROR', 500, { key: 'value' });
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({ key: 'value' });
      expect(error.name).toBe('AppError');
    });
  });

  describe('NetworkError', () => {
    it('should create a NetworkError with correct properties', () => {
      const originalError = new Error('Network failed');
      const error = new NetworkError('Network error occurred', originalError);
      
      expect(error.message).toBe('Network error occurred');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.statusCode).toBe(503);
      expect(error.originalError).toBe(originalError);
    });
  });

  describe('ValidationError', () => {
    it('should create a ValidationError with field and value', () => {
      const error = new ValidationError('Invalid email', 'email', 'invalid');
      
      expect(error.message).toBe('Invalid email');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.field).toBe('email');
      expect(error.value).toBe('invalid');
    });
  });

  describe('AuthError', () => {
    it('should create an AuthError with correct properties', () => {
      const error = new AuthError('Unauthorized');
      
      expect(error.message).toBe('Unauthorized');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.statusCode).toBe(401);
    });
  });

  describe('NotFoundError', () => {
    it('should create a NotFoundError with custom resource', () => {
      const error = new NotFoundError('User');
      
      expect(error.message).toBe('User not found');
      expect(error.code).toBe('NOT_FOUND_ERROR');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('ConflictError', () => {
    it('should create a ConflictError with correct properties', () => {
      const error = new ConflictError('Resource already exists');
      
      expect(error.message).toBe('Resource already exists');
      expect(error.code).toBe('CONFLICT_ERROR');
      expect(error.statusCode).toBe(409);
    });
  });

  describe('RateLimitError', () => {
    it('should create a RateLimitError with retry after', () => {
      const error = new RateLimitError('Too many requests', 60);
      
      expect(error.message).toBe('Too many requests');
      expect(error.code).toBe('RATE_LIMIT_ERROR');
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should create a ServiceUnavailableError with correct properties', () => {
      const error = new ServiceUnavailableError('Maintenance mode');
      
      expect(error.message).toBe('Maintenance mode');
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      const error = new AppError('Test', 'TEST', 500);
      expect(isAppError(error)).toBe(true);
    });

    it('should return true for custom error instances', () => {
      const error = new NetworkError('Test');
      expect(isAppError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Test');
      expect(isAppError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
      expect(isAppError('string')).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('should return message from AppError', () => {
      const error = new AppError('Test error', 'TEST');
      expect(getErrorMessage(error)).toBe('Test error');
    });

    it('should return message from regular Error', () => {
      const error = new Error('Test error');
      expect(getErrorMessage(error)).toBe('Test error');
    });

    it('should return string as-is', () => {
      expect(getErrorMessage('Test error')).toBe('Test error');
    });

    it('should return default message for unknown error', () => {
      expect(getErrorMessage(null)).toBe('An unexpected error occurred');
      expect(getErrorMessage(undefined)).toBe('An unexpected error occurred');
      expect(getErrorMessage(123)).toBe('An unexpected error occurred');
    });
  });

  describe('getErrorCode', () => {
    it('should return code from AppError', () => {
      const error = new AppError('Test', 'TEST_ERROR', 500);
      expect(getErrorCode(error)).toBe('TEST_ERROR');
    });

    it('should return name from regular Error', () => {
      const error = new Error('Test');
      expect(getErrorCode(error)).toBe('Error');
    });

    it('should return UNKNOWN_ERROR for unknown error', () => {
      expect(getErrorCode(null)).toBe('UNKNOWN_ERROR');
      expect(getErrorCode('string')).toBe('UNKNOWN_ERROR');
    });
  });
});
