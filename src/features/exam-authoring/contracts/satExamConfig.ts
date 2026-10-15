import { z } from "zod";
import type { SatClassroomPlan, SatClassroomShape, SatPublishScope } from "./assessment";

/** Section keys that carry exam-level configuration. */
export const SAT_CONFIG_SECTION_KEYS = ["reading-writing", "math"] as const;
export type SatConfigSectionKey = (typeof SAT_CONFIG_SECTION_KEYS)[number];

export const SAT_CONFIG_SECTION_LABELS: Record<SatConfigSectionKey, string> = {
  "reading-writing": "Reading & Writing",
  math: "Math",
};

export interface SatSectionConfig {
  module1Minutes: number;
  module2LowerMinutes: number;
  module2HigherMinutes: number;
  breakAfterMinutes: number;
  minimumCorrectForHigher: number;
}

/**
 * Exam-level configuration, saved once at creation and revisited in Settings.
 * Per-room choices (Module 2 routing, audience, window) are NOT part of it.
 */
export interface SatExamConfig {
  /** Fixed at creation; omitted scope includes both sections. */
  sectionScope?: SatPublishScope;
  sections: Record<SatConfigSectionKey, SatSectionConfig>;
  showClassroomScoreReport: boolean;
  classroomPlan?: SatClassroomPlan;
  scoreConverter?: unknown;
}

/** The section shapes staff can choose, plus the standard full adaptive path. */
export const SHAPE_LABELS: Record<SatClassroomShape | "full", string> = {
  full: "Full adaptive",
  m1_easy: "Module 1, then Easy Module 2",
  m1_hard: "Module 1, then Hard Module 2",
  m2_easy: "Easy Module 2 only",
  m2_hard: "Hard Module 2 only",
};

/** Module roles and timings used by each shape. Keep this aligned with Go Shape.Roles(). */
export const SHAPE_MODULE_ROLES: Record<SatClassroomShape | "full", readonly ("module1" | "lower" | "higher")[]> = {
  full: ["module1", "lower", "higher"],
  m1_easy: ["module1", "lower"],
  m1_hard: ["module1", "higher"],
  m2_easy: ["lower"],
  m2_hard: ["higher"],
};

/** Plain-language route and timing summary for SAT configuration forms. */
export function satSectionPath(shape: SatClassroomShape | "full", section: SatSectionConfig): string {
  const module1 = `Module 1 · ${section.module1Minutes} min`;
  const easy = `Easy Module 2 · ${section.module2LowerMinutes} min`;
  const hard = `Hard Module 2 · ${section.module2HigherMinutes} min`;
  switch (shape) {
    case "m1_easy": return `${module1} → ${easy}`;
    case "m1_hard": return `${module1} → ${hard}`;
    case "m2_easy": return easy;
    case "m2_hard": return hard;
    default: return `${module1} → ${easy} or ${hard}`;
  }
}

/** Bounds published by the server alongside the defaults; the client never hardcodes them. */
export interface SatConfigLimits {
  minModuleMinutes: number;
  maxModuleMinutes: number;
  maxBreakMinutes: number;
  operationalQuestions: Record<SatConfigSectionKey, number>;
}

export interface SatConfigDefaults {
  preset: "standard_sat";
  config: SatExamConfig;
  limits: SatConfigLimits;
  /** Effective server-side rollout gate for creating new SAT Classroom rooms. */
  classroomCreationEnabled: boolean;
}

export type SatConfigFieldErrors = Partial<Record<`${SatConfigSectionKey}.${keyof SatSectionConfig}`, string>>;

/**
 * The ONE validation schema for exam configuration, built from the server's
 * limits. Create exam and Settings both validate through it; the server stays
 * authoritative and re-checks the same bounds.
 */
export function satSectionSchema(limits: SatConfigLimits, section: SatConfigSectionKey) {
  const minutes = (label: string) =>
    z
      .number({ error: `${label} is required.` })
      .int(`${label} must be whole minutes.`)
      .min(limits.minModuleMinutes, `${label} must be at least ${limits.minModuleMinutes} minute.`)
      .max(limits.maxModuleMinutes, `${label} must be at most ${limits.maxModuleMinutes} minutes.`);
  const ceiling = limits.operationalQuestions[section];
  return z.object({
    module1Minutes: minutes("Module 1 duration"),
    module2LowerMinutes: minutes("Module 2 (lower) duration"),
    module2HigherMinutes: minutes("Module 2 (higher) duration"),
    breakAfterMinutes: z
      .number({ error: "Break is required." })
      .int("Break must be whole minutes.")
      .min(0, "Break cannot be negative.")
      .max(limits.maxBreakMinutes, `Break must be at most ${limits.maxBreakMinutes} minutes.`),
    minimumCorrectForHigher: z
      .number({ error: "Threshold is required." })
      .int("Threshold must be a whole number.")
      .min(1, "Threshold must be at least 1.")
      .max(ceiling, `Threshold cannot exceed ${ceiling} correct answers.`),
  });
}

/** Field-keyed errors for every invalid value, so a form can mark them all at once. */
export function validateSatExamConfig(config: SatExamConfig, limits: SatConfigLimits): SatConfigFieldErrors {
  const errors: SatConfigFieldErrors = {};
  for (const section of SAT_CONFIG_SECTION_KEYS) {
    const parsed = satSectionSchema(limits, section).safeParse(config.sections[section]);
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field !== "string") continue;
      const key = `${section}.${field}` as keyof SatConfigFieldErrors;
      errors[key] ??= issue.message;
    }
  }
  return errors;
}

/** True when the configuration differs from the server defaults (so a create must send it). */
export function satExamConfigDiffers(config: SatExamConfig, defaults: SatExamConfig): boolean {
  return (
    (config.sectionScope ?? "full") !== (defaults.sectionScope ?? "full") ||
    config.showClassroomScoreReport !== defaults.showClassroomScoreReport ||
    Object.keys(config.classroomPlan ?? {}).length > 0 ||
    (config.scoreConverter !== undefined && config.scoreConverter !== null) ||
    SAT_CONFIG_SECTION_KEYS.some((section) =>
      (Object.keys(config.sections[section]) as Array<keyof SatSectionConfig>).some(
        (field) => config.sections[section][field] !== defaults.sections[section][field],
      ),
    )
  );
}
