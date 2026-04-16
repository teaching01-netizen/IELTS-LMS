/**
 * Tests for API response validation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validateData,
  safeValidateData,
  commonSchemas,
  apiResponseSchema,
  paginatedResponseSchema,
  validateApiResponse,
  safeValidateApiResponse,
} from '../validateApiResponse';
import { z } from 'zod';

describe('API Response Validation', () => {
  describe('validateData', () => {
    it('should validate data against schema successfully', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const data = { name: 'John', age: 30 };
      const result = validateData(schema, data);

      expect(result).toEqual(data);
    });

    it('should throw ValidationError for invalid data', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const data = { name: 'John', age: 'invalid' };

      expect(() => validateData(schema, data)).toThrow();
    });
  });

  describe('safeValidateData', () => {
    it('should return validated data for valid input', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const data = { name: 'John', age: 30 };
      const result = safeValidateData(schema, data);

      expect(result).toEqual(data);
    });

    it('should return null for invalid data', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const data = { name: 'John', age: 'invalid' };
      const result = safeValidateData(schema, data);

      expect(result).toBeNull();
    });
  });

  describe('commonSchemas', () => {
    it('should validate non-empty string', () => {
      expect(() => commonSchemas.nonEmptyString.parse('test')).not.toThrow();
      expect(() => commonSchemas.nonEmptyString.parse('')).toThrow();
    });

    it('should validate email', () => {
      expect(() => commonSchemas.email.parse('test@example.com')).not.toThrow();
      expect(() => commonSchemas.email.parse('invalid')).toThrow();
    });

    it('should validate UUID', () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(() => commonSchemas.uuid.parse(validUuid)).not.toThrow();
      expect(() => commonSchemas.uuid.parse('invalid')).toThrow();
    });

    it('should validate positive number', () => {
      expect(() => commonSchemas.positiveNumber.parse(5)).not.toThrow();
      expect(() => commonSchemas.positiveNumber.parse(-1)).toThrow();
      expect(() => commonSchemas.positiveNumber.parse(0)).toThrow();
    });

    it('should validate non-negative number', () => {
      expect(() => commonSchemas.nonNegativeNumber.parse(5)).not.toThrow();
      expect(() => commonSchemas.nonNegativeNumber.parse(0)).not.toThrow();
      expect(() => commonSchemas.nonNegativeNumber.parse(-1)).toThrow();
    });

    it('should validate ISO date', () => {
      const validDate = new Date().toISOString();
      expect(() => commonSchemas.isoDate.parse(validDate)).not.toThrow();
      expect(() => commonSchemas.isoDate.parse('invalid')).toThrow();
    });
  });

  describe('apiResponseSchema', () => {
    it('should validate successful API response', () => {
      const schema = z.object({ id: z.string() });
      const responseSchema = apiResponseSchema(schema);

      const response = {
        success: true,
        data: { id: '123' },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
      };

      expect(() => responseSchema.parse(response)).not.toThrow();
    });

    it('should validate error API response', () => {
      const schema = z.object({ id: z.string() });
      const responseSchema = apiResponseSchema(schema);

      const response = {
        success: false,
        error: {
          code: 'ERROR_CODE',
          message: 'Error message',
          details: { key: 'value' },
        },
      };

      expect(() => responseSchema.parse(response)).not.toThrow();
    });
  });

  describe('paginatedResponseSchema', () => {
    it('should validate paginated response', () => {
      const schema = z.object({ id: z.string() });
      const responseSchema = paginatedResponseSchema(schema);

      const response = {
        data: [{ id: '1' }, { id: '2' }],
        total: 2,
        page: 1,
        pageSize: 10,
        hasMore: false,
      };

      expect(() => responseSchema.parse(response)).not.toThrow();
    });
  });

  describe('validateApiResponse', () => {
    it('should validate API response with context', () => {
      const schema = z.object({ id: z.string() });
      const response = {
        success: true,
        data: { id: '123' },
      };

      const result = validateApiResponse(schema, response, 'Test API');
      expect(result).toEqual(response);
    });
  });

  describe('safeValidateApiResponse', () => {
    it('should return validated data for valid response', () => {
      const schema = z.object({ id: z.string() });
      const response = {
        success: true,
        data: { id: '123' },
      };

      const result = safeValidateApiResponse(schema, response, 'Test API');
      expect(result).toEqual(response);
    });

    it('should return null for invalid response', () => {
      const schema = z.object({ id: z.string() });
      const response = {
        success: true,
        data: { id: 123 }, // Invalid type
      };

      const result = safeValidateApiResponse(schema, response, 'Test API');
      expect(result).toBeNull();
    });
  });
});
