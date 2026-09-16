// Single ownership of the open question's fields — "Single ownership per field"
// in docs/sat-authoring-coedit.md.
//
// Up to three writers can describe the same columns for one question:
//
//   - `workspace`   the exam-level room. Its Y.Doc carries the question's rich
//                   roots AND the scalar record (questionType, answer,
//                   metadata, accessibility, isPretest), and the service
//                   materializes all of them. It owns every field.
//   - `prompt-room` the question-scoped v1 room. It owns the prompt ONLY, which
//                   is why every other field still travels over the partial
//                   HTTP endpoint the same design defines.
//   - `legacy`      no room. The full-revision endpoint is the only writer.
//
// Two writers for one field is a lost update decided by wall-clock instead of
// by authorship: the room stores the CRDT and the HTTP write stores a stale
// full-column snapshot of it. So the choice is made ONCE, here, from the two
// room facts — not re-decided at each call site, where a future edit can
// easily make `saveDraft` and `handleChange` disagree.
export type FieldWriter = "workspace" | "prompt-room" | "legacy";

export interface FieldWriterInput {
  /** The exam-level workspace room is mounted for this session. */
  workspaceRoomActive: boolean;
  /** The question-scoped prompt room owns the prompt. */
  promptRoomActive: boolean;
}

/**
 * The writer that owns the open question's fields.
 *
 * The workspace room outranks the prompt room: it contains the prompt, so a
 * question-scoped room opened beside it could only ever be a second writer.
 */
export function resolveFieldWriter(input: FieldWriterInput): FieldWriter {
  if (input.workspaceRoomActive) return "workspace";
  if (input.promptRoomActive) return "prompt-room";
  return "legacy";
}
