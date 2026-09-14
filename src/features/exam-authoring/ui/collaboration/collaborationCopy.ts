import type { CompareFieldKey, FieldFate } from "../../realtime/threeWayCompare";

/**
 * Single source of collaboration UX strings. Tests assert against these, so a
 * copy change is a deliberate, reviewable act rather than a drive-by edit.
 *
 * Calm-awareness wording rules encoded here:
 *   - Presence is informational. Alert chrome and uppercase alarm caps appear
 *     nowhere in this directory: editing presence is a quiet label, not a
 *     problem report.
 *   - `New changes available` is the headline for a diverged editor whose
 *     fields may not even overlap. The word "conflict" is reserved for
 *     same-field dual edits, where it is literally true.
 *   - The safety phrase `Your changes are safe` is mandatory on the banner.
 */

export const REMOTE_UPDATE_COPY = {
  headline: "New changes available",
  /** Mandatory key phrase. Tests assert this exact substring. */
  safety: "Your changes are safe — review when ready.",
  /** The existing contract sentence. Both sentences appear, always. */
  contract: "Your changes are preserved.",
  review: "Review",
  compare: "Compare",
  /** Dismiss == keep editing: stays diverged, the dot remains. */
  dismiss: "Keep editing",
  dismissLabel: "Dismiss and keep editing",
} as const;

export const CONFLICT_COPY = {
  useLatest: "Use latest",
  keepEditing: "Keep editing",
  copyMyWork: "Copy my work",
  compareTitle: "Changes to review",
  /** Used only for same-field dual edits. */
  conflictHeading: "You both changed these fields",
  fallbackRemoteName: "Another author",
} as const;

export const DELETION_COPY = {
  copyMyChanges: "Copy my changes",
  goToNext: "Go to next",
  /** `name` is the neutral fallback when the author is unknown. */
  body: (name: string) =>
    `This question was deleted by ${name}. Your unsaved work is preserved on this device.`,
} as const;

export const PUBLISH_COPY = {
  body: "This draft was published while you were editing. Your changes are preserved.",
  openNewDraft: "Open the new draft",
  recoveryBody: "A newer version is active. Your unsaved changes are still available.",
  openCurrentDraft: "Open current draft",
  reviewMyChanges: "Review my changes",
  copyMyWork: "Copy my work",
  readOnlyNotice: "Published — read-only",
  /** Freeze reason surfaces as a title on every disabled mutation control. */
  frozenTitle: "Draft is no longer editable — published",
} as const;

export const STRUCTURAL_COPY = {
  movedTo: (where: string) => `Moved to ${where}`,
  orderUpdated: "Order updated",
} as const;

export const PRESENCE_COPY = {
  editingNow: "Editing now",
  /** Subtle secondary label; informational tone, never alert chrome. */
  editingThisQuestion: (name: string) => `${name} is editing this question`,
  updatedBy: (name: string) => `Updated by ${name}`,
  viewingQuestion: (name: string, label: string) => `${name} — viewing ${label}`,
  editingQuestion: (name: string, label: string) => `${name} — editing ${label}`,
  idleQuestion: (name: string, _label: string) => `${name} — idle`,
  badgeLabel: (names: string, editing: boolean) =>
    `${names} ${editing ? "editing" : "viewing"} this question`,
  stackTitle: (name: string, state: string, label: string) => `${name} — ${state} ${label}`,
  peopleOn: (label: string) => `People on ${label}`,
  overflow: (count: number) => `+${count}`,
  empty: "No one else is here right now",
} as const;

export const FIELD_LABELS: Record<CompareFieldKey, string> = {
  stimulus: "Stimulus",
  prompt: "Prompt",
  choices: "Choices",
  "answer-key": "Answer key",
  rationale: "Rationale",
  metadata: "Metadata",
  accessibility: "Accessibility",
  classification: "Question type",
};

/**
 * One plain-language line per field fate, human semantics first. `remoteName` is
 * already fallback-resolved by the caller so this stays a pure formatter.
 */
export function fieldFateLine(fate: FieldFate, remoteName: string): string {
  switch (fate) {
    case "unchanged":
      return "No change";
    case "local-only":
      return "Only you changed this";
    case "remote-only":
      return `Only ${remoteName} changed this`;
    case "same-change":
      return "You both made the same change";
    case "conflict":
      return "You both changed this differently";
    default:
      return "No change";
  }
}

/** Same-field dual edit: the only place a per-row destructive-ish action shows. */
export function theirsLabel(remoteName: string): string {
  return `Use ${remoteName}'s`;
}

/** Short label for a question, used in tooltips and popovers. */
export function questionLabel(displayOrder: number | null | undefined): string {
  if (displayOrder === null || displayOrder === undefined) return "a question";
  return `Q${displayOrder + 1}`;
}
