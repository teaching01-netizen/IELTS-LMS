export const SAT_SPR_MAX_POSITIVE_CHARACTERS = 5;
export const SAT_SPR_MAX_NEGATIVE_CHARACTERS = 6;

export type SatStudentResponseErrorCode =
  "empty" | "characters" | "length" | "format" | "denominator_zero";

export type SatStudentResponseValidation =
  | { valid: true; value: string; numericValue: number }
  | { valid: false; value: string; code: SatStudentResponseErrorCode; message: string };

const ALLOWED_CHARACTER = /[0-9./-]/;

export function sanitizeSatStudentResponseInput(input: string): string {
  let result = "";
  for (const character of input) {
    if (!ALLOWED_CHARACTER.test(character)) continue;
    if (character === "-" && (result.length > 0 || result.includes("-"))) break;
    if (character === "." && (result.includes(".") || result.includes("/"))) break;
    if (character === "/" && (result.includes("/") || result.includes("."))) break;
    result += character;
    const limit = result.startsWith("-")
      ? SAT_SPR_MAX_NEGATIVE_CHARACTERS
      : SAT_SPR_MAX_POSITIVE_CHARACTERS;
    if (result.length >= limit) break;
  }
  return result;
}

export function validateSatStudentResponse(input: string): SatStudentResponseValidation {
  const value = input.trim();
  if (!value) return invalid(value, "empty", "Enter an accepted SAT response.");
  if (![...value].every((character) => ALLOWED_CHARACTER.test(character))) {
    return invalid(
      value,
      "characters",
      "Use only digits, a decimal point, a fraction bar, or a leading minus sign."
    );
  }
  const limit = value.startsWith("-")
    ? SAT_SPR_MAX_NEGATIVE_CHARACTERS
    : SAT_SPR_MAX_POSITIVE_CHARACTERS;
  if (value.length > limit) {
    return invalid(
      value,
      "length",
      `SAT responses allow at most ${limit} characters${value.startsWith("-") ? " including the minus sign" : ""}.`
    );
  }
  if ((value.match(/-/g) ?? []).length > 1 || (value.includes("-") && !value.startsWith("-"))) {
    return invalid(value, "format", "A minus sign can appear only once, at the beginning.");
  }
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  if (!unsigned) return invalid(value, "format", "Complete the numeric response.");
  if (unsigned.includes("/") && unsigned.includes(".")) {
    return invalid(value, "format", "Use either a fraction or a decimal, not both.");
  }
  if (unsigned.includes("/")) return validateFraction(value, unsigned);
  if (!/^\d+$/.test(unsigned) && !/^(?:\d+\.\d+|\.\d+)$/.test(unsigned)) {
    return invalid(
      value,
      "format",
      "Enter an integer, decimal, or fraction such as 12, .5, or 3/4."
    );
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? { valid: true, value, numericValue }
    : invalid(value, "format", "Enter a finite numeric response.");
}

function validateFraction(value: string, unsigned: string): SatStudentResponseValidation {
  const parts = unsigned.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts.every((part) => /^\d+$/.test(part))) {
    return invalid(value, "format", "Fractions must use numerator/denominator form, such as 3/4.");
  }
  const denominator = Number(parts[1]);
  if (denominator === 0)
    return invalid(value, "denominator_zero", "A fraction denominator cannot be zero.");
  const numerator = Number(parts[0]);
  const sign = value.startsWith("-") ? -1 : 1;
  return { valid: true, value, numericValue: sign * (numerator / denominator) };
}

function invalid(
  value: string,
  code: SatStudentResponseErrorCode,
  message: string
): SatStudentResponseValidation {
  return { valid: false, value, code, message };
}
