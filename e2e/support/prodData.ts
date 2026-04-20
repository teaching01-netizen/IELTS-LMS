import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const wcodeSchema = z
  .string()
  .regex(/^W\d{6}$/, 'wcode must be format W followed by 6 digits');

const studentSchema = z.object({
  wcode: wcodeSchema,
  email: z.string().email(),
  fullName: z.string().min(1),
});

const staffSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
});

const prodScenarioSchema = z
  .object({
    shardCount: z.number().int().min(1).default(6),
    arrivalRampSeconds: z.number().int().min(0).default(300),
    checkedInStartThreshold: z.number().int().min(0).default(95),
    offlineToggleStudentCount: z.number().int().min(0).default(5),
    invalidCheckInCount: z.number().int().min(0).default(2),
    violations: z
      .object({
        tabSwitchCount: z.number().int().min(0).default(4),
        clipboardBlockedCount: z.number().int().min(0).default(4),
        contextMenuBlockedCount: z.number().int().min(0).default(4),
      })
      .default({ tabSwitchCount: 4, clipboardBlockedCount: 4, contextMenuBlockedCount: 4 }),
    interventions: z
      .object({
        warnCount: z.number().int().min(0).default(10),
        pauseResumeCount: z.number().int().min(0).default(6),
        terminateCount: z.number().int().min(0).default(2),
      })
      .default({ warnCount: 10, pauseResumeCount: 6, terminateCount: 2 }),
  })
  .default({
    shardCount: 6,
    arrivalRampSeconds: 300,
    checkedInStartThreshold: 95,
    offlineToggleStudentCount: 5,
    invalidCheckInCount: 2,
    violations: { tabSwitchCount: 4, clipboardBlockedCount: 4, contextMenuBlockedCount: 4 },
    interventions: { warnCount: 10, pauseResumeCount: 6, terminateCount: 2 },
  });

const prodTargetSchema = z.object({
  baseURL: z.string().url(),
  scheduleId: z.string().min(1),
  examId: z.string().min(1),
  editor: staffSchema,
  proctors: z.array(staffSchema).length(10),
  students: z.array(studentSchema).length(100),
  scenario: prodScenarioSchema,
});

export type ProdTarget = z.infer<typeof prodTargetSchema>;

const prodCredSchema = z.object({
  editor: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  proctors: z
    .array(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
    )
    .length(10),
});

export type ProdCreds = z.infer<typeof prodCredSchema>;

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

const prodRuntimeSchema = z
  .object({
    baseURL: z.string().url().optional(),
    scheduleId: z.string().min(1).optional(),
    examId: z.string().min(1).optional(),
    createdAt: z.string().optional(),
  })
  .strict();

export type ProdRuntimeOverride = z.infer<typeof prodRuntimeSchema>;

export function resolveProdTargetPath(): string {
  const override = process.env['E2E_PROD_TARGET_PATH'];
  if (override) return path.resolve(process.cwd(), override);
  return path.resolve(process.cwd(), 'e2e/prod-data/prod-target.json');
}

export function resolveProdCredsPath(): string {
  const override = process.env['E2E_PROD_CREDS_PATH'];
  if (override) return path.resolve(process.cwd(), override);
  return path.resolve(process.cwd(), 'e2e/prod-data/prod-creds.json');
}

export function resolveProdRuntimePath(): string {
  const override = process.env['E2E_PROD_RUNTIME_PATH'];
  if (override) return path.resolve(process.cwd(), override);
  return path.resolve(process.cwd(), 'e2e/.generated/prod-runtime.json');
}

export function readProdTarget(): ProdTarget {
  const filePath = resolveProdTargetPath();
  return prodTargetSchema.parse(readJsonFile(filePath));
}

export function readProdCreds(): ProdCreds {
  const filePath = resolveProdCredsPath();
  return prodCredSchema.parse(readJsonFile(filePath));
}

export function readProdRuntimeOverride(): ProdRuntimeOverride | null {
  const runtimePath = resolveProdRuntimePath();
  if (!fs.existsSync(runtimePath)) {
    return null;
  }

  try {
    return prodRuntimeSchema.parse(readJsonFile(runtimePath));
  } catch (error) {
    throw new Error(
      `Invalid prod runtime override file at ${runtimePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readEffectiveProdTarget(): ProdTarget {
  const target = readProdTarget();
  const runtime = readProdRuntimeOverride();
  const bootstrapping = process.env['E2E_PROD_BOOTSTRAP'] === 'true';
  // In bootstrap mode, shard 0 is allowed to start from placeholder ids, since it will
  // create a fresh exam + schedule and write a runtime override file.
  if (!runtime && bootstrapping) {
    return target;
  }
  const effective: ProdTarget = runtime
    ? {
        ...target,
        baseURL: runtime.baseURL ?? target.baseURL,
        scheduleId: runtime.scheduleId ?? target.scheduleId,
        examId: runtime.examId ?? target.examId,
      }
    : target;

  const looksLikePlaceholder = (value: string) => /REPLACE_ME/i.test(value);
  if (looksLikePlaceholder(effective.scheduleId) || looksLikePlaceholder(effective.examId)) {
    throw new Error(
      [
        'prod-target.json still contains placeholder ids.',
        `scheduleId=${effective.scheduleId}`,
        `examId=${effective.examId}`,
        '',
        'Fix by either:',
        '- Updating e2e/prod-data/prod-target.json with real scheduleId + examId, or',
        '- Running shard 0 with E2E_PROD_BOOTSTRAP=true E2E_PROD_ALLOW_BOOTSTRAP=true to auto-create them.',
      ].join('\n'),
    );
  }

  return effective;
}
