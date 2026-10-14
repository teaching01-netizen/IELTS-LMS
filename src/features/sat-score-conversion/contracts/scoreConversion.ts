/**
 * Wire contract of the global SAT score-conversion policy
 * (`/v1/sat-score-conversion/*`, see docs/scoreconverimplement.md §3).
 *
 * One revision is a whole snapshot of both subjects. A full two-module route
 * resolves through a matrix indexed `cells[module1Correct][module2Correct]`; a
 * standalone Module 2 resolves through its own 1D table. Dimensions must equal
 * the attempt's operational counts. Null cells exist only in drafts.
 */

export type SectionKey = "reading-writing" | "math";
export type Topology = "full_lower" | "full_higher" | "m2_lower_only" | "m2_higher_only";

export const SECTION_KEYS: readonly SectionKey[] = ["reading-writing", "math"];
export const FULL_TOPOLOGIES: readonly Topology[] = ["full_lower", "full_higher"];
export const STANDALONE_TOPOLOGIES: readonly Topology[] = ["m2_lower_only", "m2_higher_only"];

export const SECTION_LABEL: Record<SectionKey, string> = {
  "reading-writing": "Reading & Writing",
  math: "Math",
};

export const TOPOLOGY_LABEL: Record<Topology, string> = {
  full_lower: "Module 1 + lower Module 2",
  full_higher: "Module 1 + higher Module 2",
  m2_lower_only: "Standalone lower Module 2",
  m2_higher_only: "Standalone higher Module 2",
};

export function isStandalone(topology: Topology): boolean {
  return topology === "m2_lower_only" || topology === "m2_higher_only";
}

export interface Score {
  low: number;
  high: number;
}

/** A 1D table entry: an integer point, a {low, high} range, or null (draft only). */
export type ScoreEntry = number | Score | null;

export interface MatrixTable {
  kind: "matrix";
  m1Operational: number;
  m2Operational: number;
  cells: Array<Array<number | null>>;
}

export interface Module2Table {
  kind: "module2";
  operational: number;
  scores: ScoreEntry[];
}

export type PolicyTable = MatrixTable | Module2Table;

export interface SectionPolicy {
  tables: Record<string, PolicyTable>;
  assign: Partial<Record<Topology, string[]>>;
}

export interface ScoreConversionContent {
  schemaVersion: 1;
  sections: Partial<Record<SectionKey, SectionPolicy>>;
}

export type RevisionStatus = "draft" | "published";

export interface ScoreConversionRevision {
  id: string;
  revisionNumber: number | null;
  status: RevisionStatus;
  baseRevisionId: string | null;
  /** Omitted from list responses. */
  content?: ScoreConversionContent;
  contentSha256: string | null;
  calibrationSource: string;
  note: string;
  restoredFromId: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  publishedBy: string | null;
  active: boolean;
}

export interface ScoreConversionSettings {
  active: ScoreConversionRevision | null;
  drafts: ScoreConversionRevision[];
  /** Blueprint operational (scored, non-pretest) question counts per module. */
  blueprint: Partial<Record<SectionKey, { m1Operational: number; m2Operational: number }>>;
}

export interface ScoreConversionIssue {
  code: string;
  /** e.g. `sections.math.tables.t1.cells[3][4]` */
  path: string;
  message: string;
  section?: SectionKey;
  tableId?: string;
  row?: number;
  col?: number;
}

export interface ScoreConversionValidation {
  valid: boolean;
  errors: ScoreConversionIssue[];
  warnings: ScoreConversionIssue[];
}

export interface ScoreConversionLookup {
  status: "converted" | "unavailable";
  scaled?: Score;
  reason?: string;
}

export interface LookupRequest {
  draftId?: string;
  revisionId?: string;
  section: SectionKey;
  topology: Topology;
  m1: number;
  m2?: number;
  m1Operational?: number;
  m2Operational?: number;
}

export interface SectionImpact {
  considered: number;
  changed: number;
  unchanged: number;
  becomesUnavailable: number;
  becomesAvailable: number;
  minDelta: number | null;
  maxDelta: number | null;
}

export interface ImpactChange {
  section: SectionKey;
  topology: Topology;
  m1: number;
  m2: number | null;
  count: number;
  oldScore: Score | null;
  newScore: Score | null;
}

export interface ScoreConversionImpact {
  draftId: string;
  activeRevisionId: string | null;
  generatedAt: string;
  resultsConsidered: number;
  sections: Partial<Record<SectionKey, SectionImpact>>;
  topChanges: ImpactChange[];
}

export interface SaveDraftRequest {
  content: ScoreConversionContent;
  calibrationSource: string;
  note: string;
}

export interface PublishResult {
  revision: ScoreConversionRevision;
  alreadyActive: boolean;
}
