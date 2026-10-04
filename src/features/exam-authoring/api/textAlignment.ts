// Paragraph and heading alignment, shared by the editor schema (and therefore
// the co-editing service) and the student renderer. Dependency-free so the
// student bundle does not pull in the editor to read one attribute.

/** Stored alignments; left is the default and is stored as `null`. */
export const TEXT_ALIGNMENTS = ["center", "right", "justify"] as const;
export type StoredTextAlignment = (typeof TEXT_ALIGNMENTS)[number];
export type TextAlignment = "left" | StoredTextAlignment;

/** Reads an untrusted value as a stored alignment (`null` = left). */
export function storedTextAlignment(value: unknown): StoredTextAlignment | null {
  return (TEXT_ALIGNMENTS as readonly unknown[]).includes(value) ? (value as StoredTextAlignment) : null;
}
