import { SatEntryNotice } from "@/src/features/student-delivery/api/satEntryPortal";
import type { useRegistrationAnswers } from "../hooks/useRegistrationAnswers";
import { FormFields } from "./FormFields";

/** The "Exam details" group inside the SAT check-in card (direct and access-link entry). */
export function SatRegistrationGroup({
  registration,
  idPrefix,
  disabled,
}: {
  registration: ReturnType<typeof useRegistrationAnswers>;
  idPrefix: string;
  disabled?: boolean | undefined;
}) {
  const fields = registration.form?.fields ?? [];
  if (fields.length === 0) return null;
  return (
    <fieldset className="space-y-4 border-t border-[var(--sat-divider-soft)] pt-5">
      <legend className="float-left w-full text-[15px] font-semibold text-[var(--sat-text)]">Exam details</legend>
      {registration.notice ? (
        <SatEntryNotice tone="warning">{registration.notice}</SatEntryNotice>
      ) : null}
      <FormFields
        fields={fields}
        values={registration.values}
        errors={registration.errors}
        onChange={registration.setValue}
        disabled={disabled}
        idPrefix={idPrefix}
      />
    </fieldset>
  );
}
