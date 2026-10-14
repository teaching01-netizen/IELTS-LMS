import { backendGet, backendPost, backendPut } from "../infrastructure/scoreConversionBackendGateway";
import type {
  LookupRequest,
  PublishResult,
  SaveDraftRequest,
  ScoreConversionImpact,
  ScoreConversionLookup,
  ScoreConversionRevision,
  ScoreConversionSettings,
  ScoreConversionValidation,
} from "../contracts/scoreConversion";

const BASE = "/v1/sat-score-conversion";

export const scoreConversionApi = {
  getSettings(): Promise<ScoreConversionSettings> {
    return backendGet<ScoreConversionSettings>(`${BASE}/settings`);
  },

  async listRevisions(): Promise<ScoreConversionRevision[]> {
    const out = await backendGet<{ revisions: ScoreConversionRevision[] }>(`${BASE}/revisions`);
    return out.revisions;
  },

  getRevision(id: string): Promise<ScoreConversionRevision> {
    return backendGet<ScoreConversionRevision>(`${BASE}/revisions/${encodeURIComponent(id)}`);
  },

  /** Copies `fromRevisionId` (default: the active revision) into a new draft. */
  createDraft(fromRevisionId?: string): Promise<ScoreConversionRevision> {
    return backendPost<ScoreConversionRevision, { fromRevisionId?: string }>(
      `${BASE}/drafts`,
      fromRevisionId ? { fromRevisionId } : {},
    );
  },

  /** Optimistic lock: `version` is the draft version the edit started from. */
  saveDraft(id: string, version: number, body: SaveDraftRequest): Promise<ScoreConversionRevision> {
    return backendPut<ScoreConversionRevision, SaveDraftRequest>(
      `${BASE}/drafts/${encodeURIComponent(id)}`,
      body,
      { headers: { "If-Match": `"${version}"` } },
    );
  },

  validate(id: string): Promise<ScoreConversionValidation> {
    return backendPost<ScoreConversionValidation>(`${BASE}/drafts/${encodeURIComponent(id)}/validate`);
  },

  lookup(body: LookupRequest): Promise<ScoreConversionLookup> {
    return backendPost<ScoreConversionLookup, LookupRequest>(`${BASE}/lookup-preview`, body);
  },

  impact(id: string): Promise<ScoreConversionImpact> {
    return backendPost<ScoreConversionImpact>(`${BASE}/drafts/${encodeURIComponent(id)}/impact`);
  },

  publish(id: string): Promise<PublishResult> {
    return backendPost<PublishResult>(`${BASE}/drafts/${encodeURIComponent(id)}/publish`);
  },
};
