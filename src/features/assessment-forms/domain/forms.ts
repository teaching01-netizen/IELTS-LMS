import { ApiError } from "@/src/shared/api-client/errors";
import type {
  AnswerValue,
  ExamForms,
  FormAnswers,
  FormField,
  FieldScope,
  PublicRegistrationForm,
} from "../contracts/forms";

/**
 * Client-side form rules. They mirror the Go definition package for immediate
 * feedback only; the server validates every save and submission.
 */

export type SittingSection = "reading-writing" | "math";

/** Whether a field applies to a sitting; null sections = full SAT. */
export function fieldApplies(
  scope: FieldScope | undefined,
  sections: readonly SittingSection[] | null
): boolean {
  if (scope === undefined || scope === "all") return true;
  if (sections === null) return true;
  return sections.includes(scope);
}

export function applicableFields(
  fields: readonly FormField[],
  sections: readonly SittingSection[] | null
): FormField[] {
  return fields.filter((field) => fieldApplies(field.scope, sections));
}

/** Raw input strings keyed by field ID (what controls hold). */
export type RawAnswers = Record<string, string>;

export function rawFromAnswers(answers: FormAnswers | null | undefined): RawAnswers {
  const out: RawAnswers = {};
  for (const [key, value] of Object.entries(answers ?? {})) out[key] = String(value);
  return out;
}

function formatBound(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function validateValue(field: FormField, raw: string): { value?: AnswerValue; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return field.required ? { error: "This question is required." } : {};
  switch (field.type) {
    case "text":
      if ([...trimmed].length > field.maxLength)
        return { error: `Use at most ${field.maxLength} characters.` };
      return { value: trimmed };
    case "number": {
      // Accept plain decimal digits only: no silent conversion of calendars,
      // locales or two-digit years.
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { error: "Enter a number." };
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return { error: "Enter a number." };
      if (field.integer && !Number.isInteger(n)) return { error: "Enter a whole number." };
      if (field.min !== undefined && n < field.min)
        return { error: `Enter ${formatBound(field.min)} or more.` };
      if (field.max !== undefined && n > field.max)
        return { error: `Enter ${formatBound(field.max)} or less.` };
      return { value: n };
    }
    case "single_choice":
      if (!field.options.some((option) => option.id === trimmed))
        return { error: "Select one of the listed options." };
      return { value: trimmed };
  }
}

/** Typed answers for the applicable fields, or field-keyed errors. */
export function buildAnswers(
  fields: readonly FormField[],
  raw: RawAnswers
): { answers: FormAnswers; errors: Record<string, string> } {
  const answers: FormAnswers = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const result = validateValue(field, raw[field.id] ?? "");
    if (result.error) errors[field.id] = result.error;
    else if (result.value !== undefined) answers[field.id] = result.value;
  }
  return { answers, errors };
}

/**
 * After a form version change keep only answers whose field still exists with
 * the same type (and, for choices, a still-listed option). The student must
 * review before resubmitting.
 */
export function retainCompatibleAnswers(
  previous: readonly FormField[],
  next: readonly FormField[],
  raw: RawAnswers
): RawAnswers {
  const out: RawAnswers = {};
  for (const field of next) {
    const before = previous.find((candidate) => candidate.id === field.id);
    const value = raw[field.id];
    if (!before || before.type !== field.type || value === undefined) continue;
    if (field.type === "single_choice" && !field.options.some((option) => option.id === value))
      continue;
    out[field.id] = value;
  }
  return out;
}

/** Server field errors from a 422 envelope (details.fields), if any. */
export function serverFieldErrors(error: unknown): Record<string, string> | null {
  if (!(error instanceof ApiError)) return null;
  const fields = error.details?.["fields"];
  if (!fields || typeof fields !== "object") return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function errorReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const reason = error.details?.["reason"];
  return typeof reason === "string" ? reason : null;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A fresh stable ID; never recycled for another meaning. */
export function newFieldId(prefix: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("")}`;
}

export interface UrlCheck {
  ok: boolean;
  message?: string;
  host?: string;
}

/** Feedback-only URL check mirroring the server rules. */
export function checkEmbedUrl(
  raw: string,
  appHost: string | null = globalThis.location?.host ?? null
): UrlCheck {
  const value = raw.trim();
  if (value === "") return { ok: false, message: "Enter the form URL." };
  if (value.length > 2048)
    return { ok: false, message: "The URL must be at most 2,048 characters." };
  if (/[\s<>"]/.test(value))
    return { ok: false, message: "Enter a URL, not HTML or text with spaces." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: "Enter an absolute https:// URL." };
  }
  if (url.protocol !== "https:") return { ok: false, message: "The URL must use https://." };
  if (url.username || url.password)
    return { ok: false, message: "The URL cannot contain a username or password." };
  if (url.port && url.port !== "443")
    return { ok: false, message: "The URL must use the standard HTTPS port." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const privateIp =
    /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      host
    ) || host.startsWith("[");
  const localName =
    !host.includes(".") ||
    /(^|\.)(localhost|local|internal|lan|intranet|corp)$/.test(host) ||
    host.endsWith(".home.arpa");
  if (privateIp || localName) return { ok: false, message: "The URL needs a public hostname." };
  if (appHost && host === appHost.toLowerCase().split(":")[0]) {
    return { ok: false, message: "The form URL cannot point to this SAT system." };
  }
  return { ok: true, host };
}

export function hostOf(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

/** Deep structural equality for canonical forms JSON. */
export function sameForms(
  a: ExamForms | null | undefined,
  b: ExamForms | null | undefined
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Client mirror of the readiness rule: enabled Eva needs its branch content. */
export function evaReadinessIssue(forms: ExamForms): string | null {
  const eva = forms.evaSim;
  if (!eva.enabled) return null;
  if (eva.mode === "native" && (eva.fields?.length ?? 0) === 0)
    return "Add at least one Eva SIM question or disable Eva SIM.";
  if (eva.mode === "embed" && !(eva.url ?? "").trim())
    return "Enter the Eva SIM form URL or disable Eva SIM.";
  return null;
}

/** Shape guard for the public registration projection on entry metadata. */
export function parsePublicRegistrationForm(raw: unknown): PublicRegistrationForm | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<PublicRegistrationForm>;
  if (
    typeof value.versionId !== "string" ||
    !Array.isArray(value.fields) ||
    value.fields.length === 0
  )
    return null;
  return {
    versionId: value.versionId,
    schemaVersion: Number(value.schemaVersion ?? 1),
    fields: value.fields,
  };
}

/** A field converted to another type, keeping only the shared properties. */
export function withFieldType(field: FormField, type: FormField["type"]): FormField {
  const base = {
    id: field.id,
    label: field.label,
    help: field.help,
    required: field.required,
    scope: field.scope,
  };
  switch (type) {
    case "text":
      return { ...base, type, maxLength: 255 };
    case "number":
      return { ...base, type, integer: true };
    case "single_choice":
      return { ...base, type, options: [{ id: newFieldId("opt"), label: "Option 1" }] };
  }
}

export function fieldTypeLabel(type: FormField["type"]): string {
  return type === "text" ? "Text" : type === "number" ? "Number" : "Single choice";
}

export function scopeLabel(scope: FieldScope | undefined): string {
  return scope === undefined || scope === "all"
    ? "All sections"
    : scope === "math"
      ? "Math"
      : "Reading & Writing";
}

/** Issues for one section ("registration" | "evaSim"), path-trimmed. */
export function sectionIssues(
  issues: readonly { path: string; message: string }[],
  section: string
) {
  return issues.filter((issue) => issue.path === section || issue.path.startsWith(`${section}.`));
}

/** Explicit draft upgrade. Stable question and option IDs survive the move. */
export function upgradeToSectionForms(source: ExamForms): Extract<ExamForms, { schemaVersion: 2 }> {
  const copy = structuredClone(source);
  if (copy.schemaVersion === 2) return copy;
  const common: FormField[] = [];
  const sectionEntry = {
    "reading-writing": { fields: [] as FormField[] },
    math: { fields: [] as FormField[] },
  };
  for (const field of copy.registration.fields) {
    const scope = field.scope;
    delete field.scope;
    if (scope === "math" || scope === "reading-writing") sectionEntry[scope].fields.push(field);
    else common.push(field);
  }
  for (const field of copy.evaSim.fields ?? []) delete field.scope;
  return { ...copy, schemaVersion: 2, registration: { fields: common }, sectionEntry };
}
