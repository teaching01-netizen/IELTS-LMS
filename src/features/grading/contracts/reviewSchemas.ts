import { z } from 'zod';
import { validateData } from '@shared/lib/validateApiResponse';
import type {
  ReviewDraft,
  SectionSubmission,
  StudentSubmission,
  WritingTaskSubmission,
} from '../../../types/grading';

/**
 * Runtime contract for the review workspace reads (traced to the grading
 * repository's mappers over `/v1/grading/submissions/:id/*`). The workspace
 * depends on identity — every resource must belong to the submission it was
 * requested for — and on the collection shapes it renders. Objects are loose
 * so additive fields pass through untouched.
 */

const submissionSchema = z.looseObject({
  id: z.string().min(1),
  submissionId: z.string().min(1),
  publishedVersionId: z.string(),
  studentName: z.string(),
  gradingStatus: z.string(),
});

const sectionSchema = z.looseObject({
  id: z.string().min(1),
  submissionId: z.string().min(1),
  section: z.enum(['listening', 'reading', 'writing', 'speaking', 'science']),
  gradingStatus: z.string(),
});

const writingTaskSchema = z.looseObject({
  id: z.string().min(1),
  submissionId: z.string().min(1),
  taskId: z.string().min(1),
});

const draftSchema = z.looseObject({
  id: z.string().min(1),
  submissionId: z.string().min(1),
  releaseStatus: z.string(),
  sectionDrafts: z.record(z.string(), z.unknown()),
  annotations: z.array(z.looseObject({ id: z.string(), taskId: z.string().optional() })),
  drawings: z.array(z.looseObject({ id: z.string() })),
  revision: z.number().optional(),
});

export class ReviewIdentityError extends Error {
  constructor(resource: string) {
    super(`The ${resource} response belongs to a different submission.`);
    this.name = 'ReviewIdentityError';
  }
}

function belongsTo(submissionId: string, candidate: { id: string; submissionId: string }): boolean {
  return candidate.submissionId === submissionId || candidate.id === submissionId;
}

export function parseReviewSubmission(submissionId: string, value: unknown): StudentSubmission | null {
  if (value === null) return null;
  const submission = validateData(submissionSchema, value, 'review submission');
  if (!belongsTo(submissionId, submission)) throw new ReviewIdentityError('submission');
  return submission as unknown as StudentSubmission;
}

export function parseReviewSections(submissionId: string, value: unknown): SectionSubmission[] {
  const sections = validateData(z.array(sectionSchema), value, 'review sections');
  if (sections.some((section) => section.submissionId !== submissionId)) throw new ReviewIdentityError('section answers');
  return sections as unknown as SectionSubmission[];
}

export function parseReviewWritingTasks(submissionId: string, value: unknown): WritingTaskSubmission[] {
  const tasks = validateData(z.array(writingTaskSchema), value, 'review writing tasks');
  if (tasks.some((task) => task.submissionId !== submissionId)) throw new ReviewIdentityError('writing');
  return tasks as unknown as WritingTaskSubmission[];
}

export function parseReviewDraft(submissionId: string, value: unknown): ReviewDraft | null {
  if (value === null) return null;
  const draft = validateData(draftSchema, value, 'review draft');
  if (draft.submissionId !== submissionId) throw new ReviewIdentityError('review draft');
  return draft as unknown as ReviewDraft;
}
