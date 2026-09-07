/**
 * Validation schemas for domain types
 * Provides runtime validation for common data structures
 */

import { z } from 'zod';
import { commonSchemas } from './validateApiResponse';

/**
 * Exam validation schemas
 */
export const examSchemas = {
  // Exam entity
  examEntity: z.object({
    id: commonSchemas.id,
    slug: commonSchemas.nonEmptyString,
    title: commonSchemas.nonEmptyString,
    type: z.enum(['Academic', 'General Training']).catch('Academic'),
    status: z.enum(['draft', 'in_review', 'approved', 'rejected', 'scheduled', 'published', 'archived', 'unpublished']).catch('draft'),
    visibility: z.enum(['private', 'organization', 'public']).catch('private'),
    owner: commonSchemas.nonEmptyString,
    createdAt: commonSchemas.isoDate,
    updatedAt: commonSchemas.isoDate,
    publishedAt: commonSchemas.isoDate.optional(),
    archivedAt: commonSchemas.isoDate.optional(),
    currentDraftVersionId: commonSchemas.id.nullable(),
    currentPublishedVersionId: commonSchemas.id.nullable(),
    canEdit: z.boolean(),
    canPublish: z.boolean(),
    canDelete: z.boolean(),
    totalQuestions: z.number().nonnegative().optional(),
    totalReadingQuestions: z.number().nonnegative().optional(),
    totalListeningQuestions: z.number().nonnegative().optional(),
    schemaVersion: z.number().positive(),
  }),

  // Exam version
  examVersion: z.object({
    id: commonSchemas.id,
    examId: commonSchemas.id,
    versionNumber: z.number().positive(),
    parentVersionId: commonSchemas.id.nullable(),
    createdBy: commonSchemas.nonEmptyString,
    createdAt: commonSchemas.isoDate,
    publishNotes: z.string().optional(),
    isDraft: z.boolean(),
    isPublished: z.boolean(),
  }),

  // Exam event
  examEvent: z.object({
    id: commonSchemas.id,
    examId: commonSchemas.id,
    versionId: commonSchemas.id.optional(),
    actor: commonSchemas.nonEmptyString,
    action: z.enum([
      'created',
      'draft_saved',
      'submitted_for_review',
      'approved',
      'rejected',
      'published',
      'unpublished',
      'scheduled',
      'archived',
      'restored',
      'cloned',
      'version_created',
      'version_restored',
      'permissions_updated',
    ]).catch('created'),
    fromState: z.enum(['draft', 'in_review', 'approved', 'rejected', 'scheduled', 'published', 'archived', 'unpublished']).optional().catch(undefined),
    toState: z.enum(['draft', 'in_review', 'approved', 'rejected', 'scheduled', 'published', 'archived', 'unpublished']).optional().catch(undefined),
    timestamp: commonSchemas.isoDate,
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
};

/**
 * Student/Session validation schemas
 */
export const sessionSchemas = {
  studentSession: z.object({
    id: commonSchemas.id,
    studentId: commonSchemas.id,
    name: commonSchemas.nonEmptyString,
    email: commonSchemas.email,
    scheduleId: commonSchemas.id,
    status: z.enum(['active', 'warned', 'paused', 'terminated', 'idle', 'connecting']).catch('active'),
    currentSection: z.enum(['listening', 'reading', 'writing', 'speaking']).catch('reading'),
    timeRemaining: z.number().nonnegative(),
    violations: z.array(z.object({
      id: commonSchemas.id,
      type: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']).catch('medium'),
      timestamp: commonSchemas.isoDate,
      description: z.string(),
    })),
    warnings: z.number().nonnegative(),
    lastActivity: commonSchemas.isoDate,
    examId: commonSchemas.id,
    examName: commonSchemas.nonEmptyString,
  }),

  examSchedule: z.object({
    id: commonSchemas.id,
    examId: commonSchemas.id,
    examTitle: commonSchemas.nonEmptyString,
    proctorDisplayName: commonSchemas.nonEmptyString.max(255),
    gradingDisplayName: commonSchemas.nonEmptyString.max(255),
    publishedVersionId: commonSchemas.id,
    cohortName: commonSchemas.nonEmptyString,
    institution: z.string().optional(),
    startTime: commonSchemas.isoDate,
    endTime: commonSchemas.isoDate,
    plannedDurationMinutes: z.number().positive(),
    deliveryMode: z.enum(['proctor_start']).catch('proctor_start'),
    status: z.enum(['scheduled', 'live', 'completed', 'cancelled']).catch('scheduled'),
    createdAt: commonSchemas.isoDate,
    createdBy: commonSchemas.nonEmptyString,
    updatedAt: commonSchemas.isoDate,
  }),
};

/**
 * Grading validation schemas
 */
export const gradingSchemas = {
  studentSubmission: z.object({
    id: commonSchemas.id,
    submissionId: commonSchemas.id,
    scheduleId: commonSchemas.id,
    examId: commonSchemas.id,
    publishedVersionId: commonSchemas.id,
    studentId: commonSchemas.id,
    studentName: commonSchemas.nonEmptyString,
    studentEmail: commonSchemas.email.optional(),
    cohortName: commonSchemas.nonEmptyString,
    submittedAt: commonSchemas.isoDate,
    timeSpentSeconds: z.number().nonnegative(),
    gradingStatus: z.enum(['not_submitted', 'submitted', 'in_progress', 'grading_complete', 'ready_to_release', 'released', 'reopened']).catch('submitted'),
    assignedTeacherId: commonSchemas.id.optional(),
    assignedTeacherName: z.string().optional(),
    isFlagged: z.boolean(),
    isOverdue: z.boolean(),
    dueDate: commonSchemas.isoDate.optional(),
    sectionStatuses: z.object({
      listening: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']).catch('pending'),
      reading: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']).catch('pending'),
      writing: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']).catch('pending'),
      speaking: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']).catch('pending'),
    }),
    createdAt: commonSchemas.isoDate,
    updatedAt: commonSchemas.isoDate,
  }),

  rubricAssessment: z.object({
    taskResponseBand: z.number().min(0).max(9),
    taskResponseNotes: z.string().optional(),
    coherenceBand: z.number().min(0).max(9),
    coherenceNotes: z.string().optional(),
    lexicalBand: z.number().min(0).max(9),
    lexicalNotes: z.string().optional(),
    grammarBand: z.number().min(0).max(9),
    grammarNotes: z.string().optional(),
    overallBand: z.number().min(0).max(9),
    wordCount: z.number().nonnegative(),
    gradingStatus: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']).catch('pending'),
    internalNotes: z.string().optional(),
  }),
};

/**
 * Form validation schemas
 */
export const formSchemas = {
  // Login form — mirrors LoginPage fields (email + password).
  loginForm: z.object({
    email: commonSchemas.email,
    password: z.string().min(1, 'Password is required'),
  }),

  // Account activation form — mirrors ActivateAccountPage (token + password
  // + confirm password).
  activationForm: z.object({
    token: commonSchemas.nonEmptyString,
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    displayName: z.string().optional(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),

  // Password reset request form — mirrors PasswordResetRequestPage.
  passwordResetRequestForm: z.object({
    email: commonSchemas.email,
  }),

  // Password reset completion form — mirrors PasswordResetCompletePage.
  passwordResetCompleteForm: z.object({
    token: commonSchemas.nonEmptyString,
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  }).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),

  // Exam creation form
  examCreation: z.object({
    title: commonSchemas.nonEmptyString,
    type: z.enum(['Academic', 'General Training']),
    summary: z.string().min(10, 'Summary must be at least 10 characters'),
    instructions: z.string().min(10, 'Instructions must be at least 10 characters'),
  }),

  // Schedule creation form
  scheduleCreation: z.object({
    examId: commonSchemas.id,
    cohortName: commonSchemas.nonEmptyString,
    proctorDisplayName: commonSchemas.nonEmptyString.max(255),
    gradingDisplayName: commonSchemas.nonEmptyString.max(255),
    institution: z.string().optional(),
    startTime: commonSchemas.isoDate,
    endTime: commonSchemas.isoDate,
    deliveryMode: z.enum(['proctor_start']),
    autoStart: z.boolean(),
    autoStop: z.boolean(),
  }),

  // Student registration form — mirrors StudentEntryRoute check-in fields
  // (access code + email + student name + nickname + IELTS course).
  // Entry is free by default: any non-empty code is accepted (W-codes are
  // uppercased for backward compatibility, everything else is trimmed).
  studentRegistration: z.object({
    wcode: z
      .string()
      .trim()
      .min(1, 'Access code is required')
      .transform((value) => (/^W\d{6}$/i.test(value) ? value.toUpperCase() : value)),
    email: commonSchemas.email,
    studentName: commonSchemas.nonEmptyString.min(2, 'Name must be at least 2 characters'),
    nickname: commonSchemas.nonEmptyString.max(50, 'Nickname must be 50 characters or less'),
    ieltsCourse: commonSchemas.nonEmptyString,
  }),
};

/**
 * Query parameter validation schemas
 */
export const querySchemas = {
  pagination: z.object({
    page: z.coerce.number().positive().default(1),
    pageSize: z.coerce.number().positive().max(100).default(20),
  }),

  sorting: z.object({
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).catch('asc').default('asc'),
  }),

  filtering: z.object({
    status: z.string().optional(),
    search: z.string().optional(),
    dateFrom: commonSchemas.isoDate.optional(),
    dateTo: commonSchemas.isoDate.optional(),
  }),
};
