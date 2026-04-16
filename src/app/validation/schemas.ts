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
    type: z.enum(['Academic', 'General Training']),
    status: z.enum(['draft', 'in_review', 'approved', 'rejected', 'scheduled', 'published', 'archived', 'unpublished']),
    visibility: z.enum(['private', 'organization', 'public']),
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
    ]),
    fromState: z.enum(['draft', 'in_review', 'approved', 'rejected', 'scheduled', 'published', 'archived', 'unpublished']).optional(),
    toState: z.enum(['draft', 'in_review', 'approved', 'rejected', 'scheduled', 'published', 'archived', 'unpublished']).optional(),
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
    email: commonSchemas.email.optional(),
    scheduleId: commonSchemas.id,
    status: z.enum(['active', 'warned', 'paused', 'terminated', 'idle', 'connecting']),
    currentSection: z.enum(['listening', 'reading', 'writing', 'speaking']),
    timeRemaining: z.number().nonnegative(),
    violations: z.array(z.object({
      id: commonSchemas.id,
      type: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
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
    publishedVersionId: commonSchemas.id,
    cohortName: commonSchemas.nonEmptyString,
    institution: z.string().optional(),
    startTime: commonSchemas.isoDate,
    endTime: commonSchemas.isoDate,
    plannedDurationMinutes: z.number().positive(),
    deliveryMode: z.enum(['proctor_start']),
    status: z.enum(['scheduled', 'live', 'completed', 'cancelled']),
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
    gradingStatus: z.enum(['not_submitted', 'submitted', 'in_progress', 'grading_complete', 'ready_to_release', 'released', 'reopened']),
    assignedTeacherId: commonSchemas.id.optional(),
    assignedTeacherName: z.string().optional(),
    isFlagged: z.boolean(),
    isOverdue: z.boolean(),
    dueDate: commonSchemas.isoDate.optional(),
    sectionStatuses: z.object({
      listening: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']),
      reading: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']),
      writing: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']),
      speaking: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']),
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
    gradingStatus: z.enum(['pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened']),
    internalNotes: z.string().optional(),
  }),
};

/**
 * Form validation schemas
 */
export const formSchemas = {
  // Login form
  loginForm: z.object({
    email: commonSchemas.email,
    password: z.string().min(8, 'Password must be at least 8 characters'),
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
    institution: z.string().optional(),
    startTime: commonSchemas.isoDate,
    endTime: commonSchemas.isoDate,
    deliveryMode: z.enum(['proctor_start']),
    autoStart: z.boolean(),
    autoStop: z.boolean(),
  }),

  // Student registration form
  studentRegistration: z.object({
    name: commonSchemas.nonEmptyString.min(2, 'Name must be at least 2 characters'),
    email: commonSchemas.email,
    studentId: commonSchemas.nonEmptyString,
    cohortName: commonSchemas.nonEmptyString,
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
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  }),

  filtering: z.object({
    status: z.string().optional(),
    search: z.string().optional(),
    dateFrom: commonSchemas.isoDate.optional(),
    dateTo: commonSchemas.isoDate.optional(),
  }),
};
