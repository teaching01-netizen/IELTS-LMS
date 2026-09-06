import { z } from 'zod';

/**
 * Auth feature form schemas (feature-local).
 *
 * These mirror the auth pages' fields and live in the auth feature (not
 * src/app) so pages comply with the frontend layer rule: src/features files
 * must not import from src/app. Shared primitives are intentionally
 * duplicated here (they are two trivial lines) rather than imported from
 * the app-level validation module. See also `formSchemas` in
 * src/app/validation/schemas.ts, which keeps app-level copies for
 * non-feature consumers; keep the two in sync when changing messages.
 */

const emailSchema = z.string().email('Enter a valid email address');
const nonEmptyStringSchema = z.string().min(1, 'This field is required');

export const loginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export type LoginFormInput = z.infer<typeof loginFormSchema>;

export const activationFormSchema = z.object({
  token: nonEmptyStringSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
  displayName: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export type ActivationFormInput = z.infer<typeof activationFormSchema>;

export const passwordResetRequestFormSchema = z.object({
  email: emailSchema,
});

export type PasswordResetRequestFormInput = z.infer<typeof passwordResetRequestFormSchema>;

export const passwordResetCompleteFormSchema = z.object({
  token: nonEmptyStringSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export type PasswordResetCompleteFormInput = z.infer<typeof passwordResetCompleteFormSchema>;
