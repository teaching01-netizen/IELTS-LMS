/**
 * Runtime validation utilities for API responses
 * Uses Zod for schema validation to ensure type safety at runtime
 */

import { z, ZodSchema, ZodError } from 'zod';
import { ValidationError as AppValidationError } from '../error/errorTypes';
import { logError } from '../error/errorLogger';

export interface ValidatedApiResponse<T> {
  success: boolean;
  data?: T | undefined;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown> | undefined;
  } | undefined;
  metadata?: {
    timestamp?: string | undefined;
    requestId?: string | undefined;
  } | undefined;
}

/**
 * Validates data against a Zod schema
 * Throws ValidationError if validation fails
 */
export function validateData<T>(schema: ZodSchema<T>, data: unknown, context?: string): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessage = formatZodError(error);
      logError(new AppValidationError(errorMessage, context), {
        validationErrors: error.issues,
        context,
      });
      throw new AppValidationError(errorMessage, context);
    }
    throw error;
  }
}

/**
 * Safely validates data against a Zod schema
 * Returns null if validation fails instead of throwing
 */
export function safeValidateData<T>(
  schema: ZodSchema<T>,
  data: unknown,
  context?: string
): T | null {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessage = formatZodError(error);
      logError(new AppValidationError(errorMessage, context), {
        validationErrors: error.issues,
        context,
      });
    }
    return null;
  }
}

/**
 * Formats Zod error into a readable message
 */
function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    const message = issue.message;
    return path ? `${path}: ${message}` : message;
  });
  return issues.join(', ');
}

/**
 * Creates a validator function for a given schema
 */
export function createValidator<T>(schema: ZodSchema<T>, context?: string) {
  return (data: unknown): T => validateData(schema, data, context);
}

/**
 * Creates a safe validator function for a given schema
 */
export function createSafeValidator<T>(schema: ZodSchema<T>, context?: string) {
  return (data: unknown): T | null => safeValidateData(schema, data, context);
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
  // String validations
  nonEmptyString: z.string().min(1, 'String cannot be empty'),
  email: z.string().email('Invalid email address'),
  url: z.string().url('Invalid URL'),
  
  // ID validations
  uuid: z.string().uuid('Invalid UUID'),
  id: z.string().min(1, 'ID cannot be empty'),
  
  // Numeric validations
  positiveNumber: z.number().positive('Number must be positive'),
  nonNegativeNumber: z.number().nonnegative('Number cannot be negative'),
  
  // Date validations
  isoDate: z.string().datetime('Invalid ISO date string'),
  
  // Boolean
  boolean: z.boolean(),
  
  // Arrays
  nonEmptyArray: <T>(itemSchema: ZodSchema<T>) => z.array(itemSchema).min(1, 'Array cannot be empty'),
};

/**
 * API response wrapper schema
 */
export const apiResponseSchema = <T>(dataSchema: ZodSchema<T>) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    metadata: z
      .object({
        timestamp: z.string().optional(),
        requestId: z.string().optional(),
      })
      .optional(),
  });

/**
 * Paginated response schema
 */
export const paginatedResponseSchema = <T>(dataSchema: ZodSchema<T>) =>
  z.object({
    data: z.array(dataSchema),
    total: z.number().nonnegative(),
    page: z.number().positive(),
    pageSize: z.number().positive(),
    hasMore: z.boolean(),
  });

/**
 * Validates an API response
 */
export function validateApiResponse<T>(
  schema: ZodSchema<T>,
  response: unknown,
  context?: string
): ValidatedApiResponse<T> {
  return validateData(apiResponseSchema(schema), response, context || 'API Response');
}

/**
 * Safely validates an API response
 */
export function safeValidateApiResponse<T>(
  schema: ZodSchema<T>,
  response: unknown,
  context?: string
): ValidatedApiResponse<T> | null {
  return safeValidateData(apiResponseSchema(schema), response, context || 'API Response');
}

/**
 * Partial validation - only validates specified fields
 */
export function validatePartial<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  data: unknown,
  context?: string
): Partial<z.infer<z.ZodObject<T>>> {
  try {
    return schema.partial().parse(data) as Partial<z.infer<z.ZodObject<T>>>;
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessage = formatZodError(error);
      logError(new AppValidationError(errorMessage, context), {
        validationErrors: error.issues,
        context,
      });
      throw new AppValidationError(errorMessage, context);
    }
    throw error;
  }
}

/**
 * Transform and validate in one step
 */
export function transformAndValidate<T, I>(
  schema: ZodSchema<T>,
  data: I,
  transformer: (input: I) => unknown,
  context?: string
): T {
  try {
    const transformed = transformer(data);
    return schema.parse(transformed);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessage = formatZodError(error);
      logError(new AppValidationError(errorMessage, context), {
        validationErrors: error.issues,
        context,
      });
      throw new AppValidationError(errorMessage, context);
    }
    throw error;
  }
}
