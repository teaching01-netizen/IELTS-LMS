import { AlertCircle } from "lucide-react";
import type { FormField } from "../contracts/forms";
import type { RawAnswers } from "../domain/forms";

/* The one candidate-facing renderer for configured questions (UX-10): entry
 * registration, the Settings preview and native Eva all use it. Student skin
 * tokens only; labels sit above controls, errors are described and marked
 * invalid so focusFirstInvalidField can reach them. */

const CONTROL =
  "mt-2 block min-h-12 w-full rounded-lg border bg-[var(--sat-surface)] px-3.5 text-[length:var(--sat-type-input)] leading-6 text-[var(--sat-text)] font-normal hover:border-[var(--sat-divider-strong)] focus:border-[var(--sat-focus)] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--sat-focus)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]";

export function placeholderForChoice(label: string): string {
  return `Select ${label.trim().toLowerCase()}`;
}

export interface FormFieldsProps {
  fields: readonly FormField[];
  values: RawAnswers;
  errors?: Record<string, string> | undefined;
  onChange: (fieldId: string, value: string) => void;
  disabled?: boolean | undefined;
  /** DOM id prefix so two renderers on one page never collide. */
  idPrefix: string;
}

export function FormFields({ fields, values, errors = {}, onChange, disabled, idPrefix }: FormFieldsProps) {
  const anyRequired = fields.some((field) => field.required);
  return (
    <div className="space-y-5">
      {anyRequired ? (
        <p className="text-[13px] leading-5 text-[var(--sat-text-secondary)]">
          Questions marked <span aria-hidden="true">*</span>
          <span className="sr-only">required</span> are required.
        </p>
      ) : null}
      {fields.map((field) => (
        <FormFieldControl
          key={field.id}
          id={`${idPrefix}-${field.id}`}
          field={field}
          value={values[field.id] ?? ""}
          error={errors[field.id]}
          onChange={(value) => onChange(field.id, value)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function FormFieldControl({
  id,
  field,
  value,
  error,
  onChange,
  disabled,
}: {
  id: string;
  field: FormField;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
}) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [error ? errorId : null, field.help ? helpId : null].filter(Boolean).join(" ") || undefined;
  const border = error ? "border-[var(--sat-danger)]" : "border-[var(--sat-answer-border)]";
  const common = {
    id,
    disabled,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };
  return (
    <div>
      <label htmlFor={id} className="block text-[14px] font-semibold text-[var(--sat-text)] [overflow-wrap:anywhere]">
        {field.label}
        {field.required ? (
          <span aria-hidden="true" className="ml-0.5 text-[var(--sat-danger)]">
            *
          </span>
        ) : (
          <span className="ml-1.5 font-normal text-[var(--sat-text-secondary)]">(optional)</span>
        )}
      </label>
      {field.type === "single_choice" ? (
        <select
          {...common}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${CONTROL} ${border}`}
        >
          <option value="">{placeholderForChoice(field.label)}</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type="text"
          inputMode={field.type === "number" ? (field.integer ? "numeric" : "decimal") : undefined}
          autoComplete="off"
          value={value}
          maxLength={field.type === "text" ? field.maxLength : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`${CONTROL} ${border} ${field.type === "number" ? "sat-tabular" : ""}`}
        />
      )}
      {error ? (
        <p id={errorId} className="mt-2 flex items-start gap-1.5 text-[13px] font-medium leading-5 text-[var(--sat-danger)]">
          <AlertCircle size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {field.help ? (
        <p id={helpId} className="mt-2 text-[13px] leading-5 text-[var(--sat-text-secondary)] [overflow-wrap:anywhere]">
          {field.help}
        </p>
      ) : null}
    </div>
  );
}

/** Read-only answer list for accepted responses (student closed state, staff detail). */
export function AnswerList({ fields, answers }: { fields: readonly FormField[]; answers: Record<string, string | number> | null | undefined }) {
  return (
    <dl className="space-y-3">
      {fields.map((field) => {
        const raw = answers?.[field.id];
        const shown =
          raw === undefined
            ? "Not answered"
            : field.type === "single_choice"
              ? (field.options.find((option) => option.id === raw)?.label ?? String(raw))
              : String(raw);
        return (
          <div key={field.id}>
            <dt className="text-[13px] font-semibold [overflow-wrap:anywhere]">{field.label}</dt>
            <dd className={`mt-0.5 text-[15px] [overflow-wrap:anywhere] ${raw === undefined ? "opacity-70" : ""}`}>{shown}</dd>
          </div>
        );
      })}
    </dl>
  );
}
