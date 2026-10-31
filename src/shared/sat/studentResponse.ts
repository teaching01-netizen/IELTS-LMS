/**
 * Digital SAT student-produced response (SPR) contract.
 *
 * This module is shared by authoring (answer keys) and student delivery
 * (entered answers) so the grid-in rule cannot drift between the two
 * surfaces. It mirrors the publish/grading rule in
 * backend/go/internal/assessscore/sat_spr.go.
 */

export const SAT_SPR_MAX_POSITIVE_CHARACTERS = 5;
export const SAT_SPR_MAX_NEGATIVE_CHARACTERS = 6;
/**
 * Safety bound for the controlled input. The legal SAT entry is 5 characters
 * (6 with a minus) and is enforced by validation, never by truncating the
 * student's text: truncating `-123456` to `-12345` would silently turn an
 * invalid paste into a different valid answer. This bound only keeps an
 * unbounded paste away from the response outbox (the transport rejects
 * strings over 64 KiB).
 */
export const SAT_SPR_MAX_INPUT_CHARACTERS = 64;
/** Answer keys may be longer than a student entry when a 5/6-character decimal
 * form exists (for example 100/333 is entered as .3003). */
export const SAT_SPR_MAX_ANSWER_KEY_CHARACTERS = 256;

export type SatStudentResponseErrorCode =
  | "empty"
  | "characters"
  | "length"
  | "format"
  | "denominator_zero"
  | "entry";

export type SatStudentResponseValidation =
  | { valid: true; value: string; numericValue: number }
  | { valid: false; value: string; code: SatStudentResponseErrorCode; message: string };

const ALLOWED_CHARACTER = /[0-9./-]/;
const STUDENT_ENTRY = /^-?(?:[0-9]+\/[0-9]+|[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/;

interface SatRational {
  /** Reduced numerator; carries the sign. */
  numerator: bigint;
  /** Reduced denominator; always positive. */
  denominator: bigint;
}

/** Minus-like glyphs that are visually indistinguishable from "-" in a grid-in
 * copied from a PDF or a word processor. Normalizing them is a display-layer
 * concern: the validator still judges the exact string it is given. */
const MINUS_LIKE = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFF0D]/g;
const FULLWIDTH_DIGIT = /[\uFF10-\uFF19]/g;
const INVISIBLE_SPACE = /[\u00A0\u2007\u2009\u202F]/g;

/**
 * Normalize glyphs a student can legitimately paste while keeping the answer
 * text itself intact. It never removes characters: filtering `1,000` to `1000`
 * or `1/2 + 1/3` to nonsense would silently change what the student meant.
 */
export function normalizeSatStudentResponseInput(input: string): string {
  return input
    .replace(MINUS_LIKE, "-")
    .replace(FULLWIDTH_DIGIT, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 0x30)
    )
    .replace(/\uFF0E/g, ".")
    .replace(/\uFF0F/g, "/")
    .replace(INVISIBLE_SPACE, " ");
}

/**
 * Normalize and apply the input safety bound. It never truncates an entry that
 * could still be a valid answer (anything over six characters is already
 * invalid), so the stored text remains the student's actual intent.
 */
export function capSatStudentResponseInput(input: string): string {
  const normalized = normalizeSatStudentResponseInput(input);
  return normalized.length > SAT_SPR_MAX_INPUT_CHARACTERS
    ? normalized.slice(0, SAT_SPR_MAX_INPUT_CHARACTERS)
    : normalized;
}

export function validateSatStudentResponse(input: string): SatStudentResponseValidation {
  return validateNumericResponse(input, false);
}

/**
 * Validate an answer key. In addition to the student syntax it enforces the
 * publish rule: the key must have at least one form a student can actually
 * enter within 5 characters (6 with a leading minus).
 */
export function validateSatAnswerKey(input: string): SatStudentResponseValidation {
  return validateNumericResponse(input, true);
}

function validateNumericResponse(
  input: string,
  canonical: boolean
): SatStudentResponseValidation {
  const value = input.trim();
  if (!value) return invalid(value, "empty", "Enter an accepted SAT response.");
  if (![...value].every((character) => ALLOWED_CHARACTER.test(character))) {
    return invalid(
      value,
      "characters",
      "Use only digits, a decimal point, a fraction bar, or a leading minus sign."
    );
  }
  const limit = canonical
    ? SAT_SPR_MAX_ANSWER_KEY_CHARACTERS
    : value.startsWith("-")
      ? SAT_SPR_MAX_NEGATIVE_CHARACTERS
      : SAT_SPR_MAX_POSITIVE_CHARACTERS;
  if (value.length > limit) {
    return invalid(
      value,
      "length",
      `${canonical ? "Answer keys" : "SAT responses"} allow at most ${limit} characters${value.startsWith("-") ? " including the minus sign" : ""}.`
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
  if (unsigned.includes("/")) return validateFraction(value, unsigned, canonical);
  if (!/^\d+$/.test(unsigned) && !/^(?:\d+\.\d+|\.\d+)$/.test(unsigned)) {
    return invalid(
      value,
      "format",
      "Enter an integer, decimal, or fraction such as 12, .5, or 3/4."
    );
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return invalid(value, "format", "Enter a finite numeric response.");
  }
  return validResponse(value, numericValue, canonical);
}

function validateFraction(
  value: string,
  unsigned: string,
  canonical: boolean
): SatStudentResponseValidation {
  const parts = unsigned.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts.every((part) => /^\d+$/.test(part))) {
    return invalid(value, "format", "Fractions must use numerator/denominator form, such as 3/4.");
  }
  const denominator = Number(parts[1]);
  if (denominator === 0)
    return invalid(value, "denominator_zero", "A fraction denominator cannot be zero.");
  const numerator = Number(parts[0]);
  const sign = value.startsWith("-") ? -1 : 1;
  return validResponse(value, sign * (numerator / denominator), canonical);
}

function validResponse(
  value: string,
  numericValue: number,
  canonical: boolean
): SatStudentResponseValidation {
  if (canonical && !satAnswerKeyHasEntryForm(value)) {
    return invalid(
      value,
      "entry",
      "The answer key needs a form a student can enter: at most 5 characters (6 with a leading minus)."
    );
  }
  return { valid: true, value, numericValue };
}

function invalid(
  value: string,
  code: SatStudentResponseErrorCode,
  message: string
): SatStudentResponseValidation {
  return { valid: false, value, code, message };
}

// ---------------------------------------------------------------------------
// Answer-key entry-form rule (mirrors assessscore.ValidateSATSPRKey)
// ---------------------------------------------------------------------------

function satAnswerKeyHasEntryForm(value: string): boolean {
  const key = parseSatRational(value);
  if (!key) return false;
  if (fitsStudentEntry(ratString(key))) return true;
  if (exactSatDecimalFits(key)) return true;
  return satSprDecimalForms(key).length > 0;
}

function fitsStudentEntry(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  const limit = text.startsWith("-")
    ? SAT_SPR_MAX_NEGATIVE_CHARACTERS
    : SAT_SPR_MAX_POSITIVE_CHARACTERS;
  return text.length <= limit && STUDENT_ENTRY.test(text);
}

function parseSatRational(value: string): SatRational | null {
  const text = value.trim();
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  if (!body) return null;

  if (body.includes("/")) {
    const parts = body.split("/");
    if (parts.length !== 2) return null;
    const [numeratorText, denominatorText] = parts;
    if (
      numeratorText === undefined ||
      denominatorText === undefined ||
      !numeratorText ||
      !denominatorText ||
      !/^\d+$/.test(numeratorText) ||
      !/^\d+$/.test(denominatorText)
    ) {
      return null;
    }
    const denominator = BigInt(denominatorText);
    if (denominator === 0n) return null;
    return reduceRational(negative ? -BigInt(numeratorText) : BigInt(numeratorText), denominator);
  }

  if (body.includes(".")) {
    const parts = body.split(".");
    if (parts.length !== 2) return null;
    const [wholeText, fractionText] = parts;
    if (
      wholeText === undefined ||
      fractionText === undefined ||
      !fractionText ||
      !/^\d+$/.test(fractionText) ||
      (wholeText !== "" && !/^\d+$/.test(wholeText))
    ) {
      return null;
    }
    const digits = (wholeText === "" ? "0" : wholeText) + fractionText;
    const denominator = 10n ** BigInt(fractionText.length);
    return reduceRational(negative ? -BigInt(digits) : BigInt(digits), denominator);
  }

  if (!/^\d+$/.test(body)) return null;
  return reduceRational(negative ? -BigInt(body) : BigInt(body), 1n);
}

function reduceRational(numerator: bigint, denominator: bigint): SatRational {
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === 0n ? 1n : a;
}

function ratString(value: SatRational): string {
  return value.denominator === 1n
    ? value.numerator.toString()
    : `${value.numerator}/${value.denominator}`;
}

function rationalSign(value: SatRational): number {
  if (value.numerator < 0n) return -1;
  if (value.numerator > 0n) return 1;
  return 0;
}

/** Exact decimal forms with at most four places (Go: exactSATDecimalFits). */
function exactSatDecimalFits(key: SatRational): boolean {
  for (let places = 0; places <= 4; places += 1) {
    const scaled = key.numerator * powerOfTen(places);
    if (scaled % key.denominator !== 0n) continue;
    const text = trimTrailingDecimalZeros(decimalText(scaled / key.denominator, places));
    if (fitsStudentEntry(text) || fitsStudentEntry(withoutLeadingZero(text))) return true;
  }
  return false;
}

/**
 * Discrete decimal forms a student may enter for the key (Go:
 * satSPRDecimalForms). Integer digits share the same five-character budget, so
 * a large integer leaves no room for decimals and yields no forms.
 */
function satSprDecimalForms(key: SatRational): string[] {
  if (key.numerator === 0n) return [];
  const negative = key.numerator < 0n;
  const magnitude = negative ? -key.numerator : key.numerator;
  const integer = magnitude / key.denominator;
  let places = 4 - integer.toString().length;
  if (places < 0) places = 0;
  const precisions = integer === 0n ? [3, 4] : [places];
  const forms: string[] = [];

  for (const precision of precisions) {
    const scale = powerOfTen(precision);
    const truncated = (magnitude * scale) / key.denominator;
    const exactText = trimTrailingDecimalZeros(
      decimalText(negative ? -truncated : truncated, precision)
    );
    const roundedText = trimTrailingDecimalZeros(
      decimalText(roundedScaled(magnitude, key.denominator, scale, negative), precision)
    );
    for (const candidate of [exactText, roundedText]) {
      for (const text of [candidate, withoutLeadingZero(candidate)]) {
        if (!fitsStudentEntry(text)) continue;
        const parsed = parseSatRational(text);
        if (parsed && rationalSign(parsed) === rationalSign(key)) forms.push(text);
      }
    }
  }
  return forms;
}

function roundedScaled(
  magnitude: bigint,
  denominator: bigint,
  scale: bigint,
  negative: boolean
): bigint {
  const scaled = magnitude * scale;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function powerOfTen(places: number): bigint {
  return 10n ** BigInt(places);
}

function decimalText(value: bigint, places: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(places + 1, "0");
  const split = digits.length - places;
  const whole = digits.slice(0, split) || "0";
  const fraction = places > 0 ? "." + digits.slice(split) : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

function trimTrailingDecimalZeros(value: string): string {
  if (!value.includes(".")) return value;
  let text = value;
  while (text.endsWith("0")) text = text.slice(0, -1);
  if (text.endsWith(".")) text = text.slice(0, -1);
  return text;
}

function withoutLeadingZero(value: string): string {
  if (value.startsWith("0.")) return value.slice(1);
  if (value.startsWith("-0.")) return "-" + value.slice(2);
  return value;
}
