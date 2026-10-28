import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessmentFormsApi } from '../assessmentFormsGateway';

const originalFetch = global.fetch;

function respond(data: unknown) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as typeof fetch;
}

const evaSim = { enabled: false, mode: 'native', fields: [] };
const forms = { schemaVersion: 1, registration: { fields: [] }, evaSim };

describe('exam forms boundary', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects a malformed forms document instead of handing it to the editor', async () => {
    respond({});
    await expect(assessmentFormsApi.examForms('exam-1')).rejects.toThrow(/form settings/i);
  });

  it('accepts a well-formed document, including a legacy null forms value', async () => {
    const doc = { versionId: 'v1', versionRevision: 2, editable: true, forms: null, standard: forms, issues: [], limits: {} };
    respond(doc);
    await expect(assessmentFormsApi.examForms('exam-1')).resolves.toEqual(doc);
  });
});
