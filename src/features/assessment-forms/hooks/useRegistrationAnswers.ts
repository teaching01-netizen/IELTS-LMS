import { useCallback, useState } from "react";
import type { PublicRegistrationForm, RegistrationSubmission } from "../contracts/forms";
import { FORM_REASONS } from "../contracts/forms";
import { buildAnswers, errorReason, retainCompatibleAnswers, serverFieldErrors, type RawAnswers } from "../domain/forms";

export const REGISTRATION_CHANGED_MESSAGE = "The registration form changed. Review your details and continue.";

/**
 * Entry-time registration answers shared by direct and access-link entry.
 * Values survive retries and queue recovery; a version change keeps only
 * compatible answers and requires review before the next Continue.
 */
export function useRegistrationAnswers(form: PublicRegistrationForm | null) {
  const [values, setValues] = useState<RawAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  // The loaded definition, or the newer one adopted after a version conflict.
  const [prevForm, setPrevForm] = useState(form);
  const [current, setCurrent] = useState(form);
  if (form !== prevForm) {
    setPrevForm(form);
    setCurrent(form);
  }

  const setValue = useCallback((fieldId: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }, []);

  /** Client validation; null submission means errors are now rendered. */
  const prepare = useCallback((): { submission?: RegistrationSubmission; valid: boolean } => {
    if (!current || current.fields.length === 0) return { valid: true };
    const { answers, errors: found } = buildAnswers(current.fields, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return { valid: false };
    setNotice(null);
    return { valid: true, submission: { versionId: current.versionId, answers } };
  }, [current, values]);

  /**
   * Maps a failed entry. Returns true when the error was a form error the
   * card now explains. `reload` fetches the latest public definition.
   */
  const handleError = useCallback(
    async (error: unknown, reload: () => Promise<PublicRegistrationForm | null>): Promise<boolean> => {
      const fieldErrors = serverFieldErrors(error);
      if (fieldErrors && current && Object.keys(fieldErrors).some((key) => current.fields.some((f) => f.id === key))) {
        setErrors(fieldErrors);
        return true;
      }
      const reason = errorReason(error);
      if (reason !== FORM_REASONS.versionChanged && reason !== FORM_REASONS.registrationRequired) return false;
      let next: PublicRegistrationForm | null;
      try {
        next = await reload();
      } catch {
        return false;
      }
      setValues((prev) => retainCompatibleAnswers(current?.fields ?? [], next?.fields ?? [], prev));
      setErrors({});
      setCurrent(next);
      setNotice(REGISTRATION_CHANGED_MESSAGE);
      return true;
    },
    [current]
  );

  return { form: current, values, errors, notice, setValue, prepare, handleError };
}
