/**
 * Phase 01 — canonical ingestion AST (ImportDocument v1).
 *
 * The closed union every adapter targets. Pure types only: this module has
 * zero runtime imports so the core stays free of frameworks and host APIs.
 * Later phases may only ADD diagnostic codes, never widen this union without
 * a migration plus validator update.
 */

export type TextMark =
  | "bold"
  | "italic"
  | "underline"
  | "superscript"
  | "subscript"
  | "code";

export type ImportSourceKind =
  | "text"
  | "html"
  | "spreadsheet"
  | "image"
  | "pdf-text"
  | "pdf-file";

export type ImportConfidence = 0 | 1 | 2;

export interface ImportMetadata {
  source: ImportSourceKind;
  confidence: ImportConfidence;
  transformations: string[];
  originTag?: string | undefined;
}

export type InlineNode =
  | { kind: "text"; text: string; marks: TextMark[]; meta: ImportMetadata }
  | { kind: "inlineMath"; latex: string; meta: ImportMetadata }
  | { kind: "blockMath"; latex: string; meta: ImportMetadata };

export interface TableCell {
  children: InlineNode[];
}

export type ImportNode =
  | { kind: "paragraph"; children: InlineNode[]; meta: ImportMetadata }
  | { kind: "heading"; level: 2 | 3; children: InlineNode[]; meta: ImportMetadata }
  | { kind: "bulletList"; items: ImportNode[][]; ordered: false; meta: ImportMetadata }
  | { kind: "orderedList"; items: ImportNode[][]; ordered: true; meta: ImportMetadata }
  | { kind: "codeBlock"; text: string; meta: ImportMetadata }
  | { kind: "table"; rows: TableCell[][]; headerRow: boolean; meta: ImportMetadata }
  | {
      kind: "image";
      blobRef: BlobRef | null;
      url: string | null;
      alt: string | null;
      caption: string | null;
      meta: ImportMetadata;
    }
  | { kind: "divider"; meta: ImportMetadata };

/**
 * Opaque byte handle: identity plus shape only. Raw bytes never enter the
 * domain; staging and upload live outside this boundary (phase 06).
 */
export interface BlobRef {
  id: string;
  mimeType: string;
  sizeBytes: number;
}

export const IMPORT_DOCUMENT_VERSION = 1 as const;

export interface ImportDocument {
  version: 1;
  nodes: ImportNode[];
  sourceMeta: ImportMetadata;
}
