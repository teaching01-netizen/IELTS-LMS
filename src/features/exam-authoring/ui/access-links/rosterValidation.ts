import type { AccessLinkMemberInput } from "../../contracts/accessLinks";

/**
 * Progressive, per-row validation for pasted student rosters.
 *
 * Mirrors the parsing rules of parseAccessLinkMembers in ./accessLinkUi
 * but collects a RosterRowError per bad line instead of throwing on the
 * first failure, so authors can fix every row in one pass.
 *
 * Pure functions only - no React, no DOM, no side effects.
 */

/** A single roster line that failed validation. "row" is 1-based. */
export interface RosterRowError {
  row: number;
  message: string;
}

/** Result of validateRosterSource. */
export interface RosterParseResult {
  /** Valid members in source order (first occurrence wins for duplicates). */
  rows: AccessLinkMemberInput[];
  /** One entry per invalid non-blank line, in source order. */
  errors: RosterRowError[];
  /** Number of non-blank lines seen (valid + invalid). */
  totalRows: number;
}

/** Same email rule as parseAccessLinkMembers. */
const ROSTER_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Split one CSV line into trimmed columns, respecting double quotes.
 *
 * Quoted fields may contain commas; a doubled quote ("") decodes to a
 * single quote, matching parseAccessLinkMembers.
 *
 * @param line Single roster line (already trimmed by the caller).
 * @returns Trimmed column values.
 * @throws Error when the line contains an unclosed quote.
 */
function parseRosterCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
      continue;
    }
    value += char;
  }
  if (quoted) throw new Error("A selected-student row contains an unclosed quote.");
  values.push(value.trim());
  return values;
}

/**
 * Validate a pasted roster without throwing.
 *
 * Splits "source" on /\r?\n/, skips blank lines while keeping original
 * 1-based row numbers (row = index + 1), and applies the same rules as
 * parseAccessLinkMembers: at most 3 quote-aware columns (code, name,
 * email), student code required, duplicate codes rejected
 * case-insensitively (first occurrence wins), and optional email matched
 * against /^[^@\s]+@[^@\s]+\.[^@\s]+$/ and lowercased.
 *
 * @param source Raw pasted roster text.
 * @returns Valid rows, per-row errors, and the non-blank line count.
 */
export function validateRosterSource(source: string): RosterParseResult {
  const lines = source.split(/\r?\n/);
  const rows: AccessLinkMemberInput[] = [];
  const errors: RosterRowError[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (!raw.trim()) continue;
    const row = index + 1;

    let columns: string[];
    try {
      columns = parseRosterCsvLine(raw.trim());
    } catch {
      errors.push({ row, message: "Row " + row + ": A selected-student row contains an unclosed quote." });
      continue;
    }

    const [studentCode = "", studentName = "", studentEmail = "", ...extra] = columns;
    if (extra.length > 0) {
      errors.push({ row, message: "Row " + row + " has more than three columns." });
      continue;
    }

    const normalizedCode = studentCode.trim();
    if (!normalizedCode) {
      errors.push({ row, message: "Row " + row + " needs a student code." });
      continue;
    }

    const key = normalizedCode.toLocaleLowerCase();
    if (seen.has(key)) {
      errors.push({ row, message: "Row " + row + ": Student code " + normalizedCode + " appears more than once." });
      continue;
    }
    seen.add(key);

    const email = studentEmail.trim();
    if (email && !ROSTER_EMAIL_PATTERN.test(email)) {
      errors.push({ row, message: "Row " + row + " has an invalid email address." });
      continue;
    }

    rows.push({
      studentCode: normalizedCode,
      ...(studentName.trim() ? { studentName: studentName.trim() } : {}),
      ...(email ? { studentEmail: email.toLocaleLowerCase() } : {}),
    });
  }

  return { rows, errors, totalRows: rows.length + errors.length };
}

/**
 * Sample roster text (two lines) for placeholders and copy-paste demos.
 *
 * @returns Two example "code, name, email" lines joined by a newline.
 */
export function rosterTemplate(): string {
  return "W123456, Jane Doe, jane@example.com\nW123457, John Doe, john@example.com";
}

/**
 * Summarize a RosterParseResult for inline status text.
 *
 * @param result Parse result from validateRosterSource.
 * @returns "" when there is nothing to report, e.g. "3 students ready"
 * when every row is valid, or e.g. "2 ready \u00B7 1 needs attention"
 * when some rows failed.
 */
export function describeRosterResult(result: RosterParseResult): string {
  if (result.totalRows === 0) return "";
  const ready = result.rows.length;
  const issues = result.errors.length;
  if (issues === 0) {
    return ready === 1 ? "1 student ready" : ready + " students ready";
  }
  const attention = issues === 1 ? "1 needs attention" : issues + " need attention";
  return ready + " ready \u00B7 " + attention;
}
