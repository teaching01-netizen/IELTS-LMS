// Prompt-free field patching for co-edit sessions (2026-09-13 design,
// "Non-collaborative field saves").
//
// While prompt co-editing owns a question, the legacy full-revision endpoint
// refuses any prompt-bearing write with a typed COEDIT_ACTIVE conflict. The
// workspace therefore saves everything EXCEPT the prompt through the partial
// endpoint, and the prompt is persisted only by the collaborative store path.
//
// This module is the whole decision of WHAT that partial write contains:
//
//   - the diff vocabulary is the existing three-way compare slices, so
//     "changed" means exactly what Review already means by changed;
//   - `prompt` cannot appear in a request (see SaveQuestionRevisionFieldsRequest);
//   - a stale revision is retried once ONLY when the fields being saved were
//     not changed remotely, and a genuine same-field collision is rethrown so
//     the existing conflict UI owns it.
import type {
  QuestionRevision,
  SaveQuestionRevisionFieldsRequest,
} from "../../contracts/assessment";
import {
  canonicalStringify,
  classifyQuestionFields,
  fieldSlice,
  type CompareFieldKey,
} from "../../realtime/threeWayCompare";
import { hasBackendStatusCode } from "../../api/examAuthoringBackendGateway";

/** The allow-listed, prompt-free field vocabulary. Order is presentation. */
export const COEDIT_FIELD_PATCH_KEYS = [
  "questionType",
  "stimulus",
  "answer",
  "rationale",
  "metadata",
  "accessibility",
] as const;

export type CoeditFieldPatchKey = (typeof COEDIT_FIELD_PATCH_KEYS)[number];

/**
 * Which compare slices make up each patchable field.
 *
 * `answer` covers BOTH the choice list and the answer key, and `questionType`
 * maps to the display-only `classification` slice — the same mapping the
 * conflict UI uses, so a change is classified identically in both surfaces.
 */
const PATCH_SLICE_KEYS: Record<CoeditFieldPatchKey, readonly CompareFieldKey[]> = {
  questionType: ["classification"],
  stimulus: ["stimulus"],
  answer: ["choices", "answer-key"],
  rationale: ["rationale"],
  metadata: ["metadata"],
  accessibility: ["accessibility"],
};

/** Canonical signature of one patchable field, via the shared compare slices. */
function fieldSignature(revision: QuestionRevision, field: CoeditFieldPatchKey): string {
  return PATCH_SLICE_KEYS[field]
    .map((key) => canonicalStringify(fieldSlice(key, revision)))
    .join("\u0001");
}

/** Every patchable field whose content differs between `base` and `local`. */
export function promptFreeFieldsChangedSince(
  base: QuestionRevision,
  local: QuestionRevision
): CoeditFieldPatchKey[] {
  return COEDIT_FIELD_PATCH_KEYS.filter(
    (field) => fieldSignature(base, field) !== fieldSignature(local, field)
  );
}

/**
 * True when the ONLY thing that changed is the prompt.
 *
 * This is the gate that keeps a collaborative keystroke out of the legacy
 * autosave queue: the projection the composer emits for preview/validation is
 * real, but it must not schedule a whole-question save.
 */
export function isPromptOnlyChange(
  base: QuestionRevision,
  local: QuestionRevision
): boolean {
  return (
    promptFreeFieldsChangedSince(base, local).length === 0 &&
    canonicalStringify(fieldSlice("prompt", base)) !== canonicalStringify(fieldSlice("prompt", local))
  );
}

/**
 * Builds the partial request from a revision and an explicit field list.
 *
 * `revisionNumber` defaults to the revision's own counter; the stale-retry path
 * passes the freshly loaded one instead.
 */
export function promptFreeFieldPatch(
  revision: QuestionRevision,
  fields: readonly CoeditFieldPatchKey[],
  revisionNumber: number = revision.revision
): SaveQuestionRevisionFieldsRequest {
  const request: SaveQuestionRevisionFieldsRequest = { revision: revisionNumber };
  for (const field of fields) {
    // Same key on both types; the loop assignment needs the union index.
    (request as Record<CoeditFieldPatchKey, unknown>)[field] = revision[field];
  }
  return request;
}

/**
 * Patchable fields among `fields` that the remote side changed to a DIFFERENT
 * value. A remote change that already equals the local value is the same edit
 * (safe to retry); a differing one is a genuine same-field collision.
 */
export function remotelyBlockedFields(input: {
  base: QuestionRevision;
  local: QuestionRevision;
  remote: QuestionRevision;
  fields: readonly CoeditFieldPatchKey[];
}): CoeditFieldPatchKey[] {
  const classifications = classifyQuestionFields({
    base: input.base,
    local: input.local,
    remote: input.remote,
  });
  return input.fields.filter((field) =>
    PATCH_SLICE_KEYS[field].some((key) => {
      const row = classifications.find((entry) => entry.field === key);
      return row?.fate === "conflict" || row?.fate === "remote-only";
    })
  );
}

/** Injected transport + loader, so the orchestration is unit-testable. */
export interface PromptFreeSaveDeps {
  saveFields: (
    revisionId: string,
    request: SaveQuestionRevisionFieldsRequest
  ) => Promise<QuestionRevision>;
  loadLatest: (examQuestionId: string) => Promise<QuestionRevision>;
}

export interface PromptFreeSaveInput {
  examQuestionId: string;
  revision: QuestionRevision;
  /**
   * The last server-acknowledged revision for this question, or null when it is
   * not known yet. A null base is conservative: every allow-listed field is
   * sent (nothing is silently dropped) and a stale revision is never retried,
   * because without a base there is no way to prove the retry is safe.
   */
  base: QuestionRevision | null;
  deps: PromptFreeSaveDeps;
}

/**
 * Persists everything about a draft EXCEPT the prompt.
 *
 * Returns:
 *   - `null` when no non-prompt field differs from `base`. Nothing is sent, so
 *     a prompt-only flush cannot bump a revision or emit a false
 *     `question.changed` event;
 *   - the updated revision after a successful write.
 *
 * On a 409 the latest revision is loaded and the write is retried ONCE with the
 * fresh counter, but only when the retried fields were not changed remotely to
 * a different value. Otherwise the original conflict is rethrown so the
 * existing Review surface explains it — never silently dropped.
 */
export async function savePromptFreeFields(
  input: PromptFreeSaveInput
): Promise<QuestionRevision | null> {
  const { examQuestionId, revision, base, deps } = input;
  const fields = base
    ? promptFreeFieldsChangedSince(base, revision)
    : [...COEDIT_FIELD_PATCH_KEYS];
  if (fields.length === 0) return null;

  try {
    return await deps.saveFields(revision.id, promptFreeFieldPatch(revision, fields));
  } catch (error) {
    if (!hasBackendStatusCode(error, 409)) throw error;
    if (!base) throw error;
    const latest = await deps.loadLatest(examQuestionId);
    const blocked = remotelyBlockedFields({ base, local: revision, remote: latest, fields });
    if (blocked.length > 0) throw error;
    return await deps.saveFields(
      revision.id,
      promptFreeFieldPatch(revision, fields, latest.revision)
    );
  }
}
