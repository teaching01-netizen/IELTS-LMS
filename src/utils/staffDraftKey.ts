export type StaffDraftResource =
  | "exam-builder"
  | "exam-answer-key"
  | "assessment-question";

function keySegment(value: string): string {
  return encodeURIComponent(value.trim());
}

export function buildStaffDraftKey(
  actorId: string | null | undefined,
  resource: StaffDraftResource,
  ...resourceIds: string[]
): string | null {
  const actor = actorId?.trim();
  const ids = resourceIds.map((value) => value.trim()).filter(Boolean);
  if (!actor || ids.length !== resourceIds.length) return null;

  return ["staff-draft", "v1", keySegment(actor), resource, ...ids.map(keySegment)].join(":");
}
