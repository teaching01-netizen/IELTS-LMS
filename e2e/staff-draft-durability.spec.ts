import { expect, test, type Page } from '@playwright/test';
import {
  BUILDER_STORAGE_STATE_PATH,
  readBackendE2EManifest,
} from './support/backendE2e';

test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

async function readServerPrompt(page: Page, examId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const [examResponse, versionsResponse] = await Promise.all([
      fetch(`/api/v1/exams/${id}`, { credentials: 'include' }),
      fetch(`/api/v1/exams/${id}/versions`, { credentials: 'include' }),
    ]);
    // The migrated Go read routes return the resource directly. Keep this
    // helper aligned with the browser repository instead of the old Rust
    // envelope shape.
    const examPayload = await examResponse.json() as {
      currentDraftVersionId?: unknown;
      currentPublishedVersionId?: unknown;
    };
    const versionsPayload = await versionsResponse.json() as unknown;
    const versions = Array.isArray(versionsPayload) ? versionsPayload : [];
    const currentDraftVersionId = typeof examPayload.currentDraftVersionId === 'string'
      ? examPayload.currentDraftVersionId
      : typeof examPayload.currentPublishedVersionId === 'string'
        ? examPayload.currentPublishedVersionId
        : null;
    const draft = versions.find((value: unknown) => {
      if (!value || typeof value !== 'object') return false;
      return (value as { id?: unknown }).id === currentDraftVersionId;
    });
    if (!draft || typeof draft !== 'object') return null;
    const content = (draft as { contentSnapshot?: unknown }).contentSnapshot;
    if (!content || typeof content !== 'object') return null;
    const listening = (content as { listening?: unknown }).listening;
    if (!listening || typeof listening !== 'object') return null;
    const parts = (listening as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) return null;
    const part = parts[0];
    if (!part || typeof part !== 'object') return null;
    const blocks = (part as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) return null;
    const block = blocks[0];
    if (!block || typeof block !== 'object') return null;
    const questions = (block as { questions?: unknown }).questions;
    if (!Array.isArray(questions)) return null;
    const question = questions[0];
    if (!question || typeof question !== 'object') return null;
    const prompt = (question as { prompt?: unknown }).prompt;
    return typeof prompt === 'string' ? prompt : null;
  }, examId);
}

async function readRecoveredPrompt(page: Page, examId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const matches = (key: unknown) =>
      typeof key === 'string' && key.includes(':exam-builder:') && key.endsWith(`:${encodeURIComponent(id)}`);
    const readPrompt = (value: unknown): string | null => {
      if (!value || typeof value !== 'object') return null;
      const listening = (value as { listening?: unknown }).listening;
      if (!listening || typeof listening !== 'object') return null;
      const parts = (listening as { parts?: unknown }).parts;
      if (!Array.isArray(parts)) return null;
      const part = parts[0];
      if (!part || typeof part !== 'object') return null;
      const blocks = (part as { blocks?: unknown }).blocks;
      if (!Array.isArray(blocks)) return null;
      const block = blocks[0];
      if (!block || typeof block !== 'object') return null;
      const questions = (block as { questions?: unknown }).questions;
      if (!Array.isArray(questions)) return null;
      const question = questions[0];
      if (!question || typeof question !== 'object') return null;
      const prompt = (question as { prompt?: unknown }).prompt;
      return typeof prompt === 'string' ? prompt : null;
    };

    try {
      const open = indexedDB.open('warwick_durable_drafts_v1', 1);
      const database = await new Promise<IDBDatabase | null>((resolve) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
        open.onblocked = () => resolve(null);
      });
      if (database?.objectStoreNames.contains('drafts')) {
        try {
          const transaction = database.transaction('drafts', 'readonly');
          const request = transaction.objectStore('drafts').getAll();
          const records = await new Promise<unknown[]>((resolve) => {
            request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
            request.onerror = () => resolve([]);
          });
          const record = records.find((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            return matches((entry as { key?: unknown }).key);
          });
          if (record && typeof record === 'object') {
            return readPrompt((record as { value?: unknown }).value);
          }
        } finally {
          database.close();
        }
      }
    } catch {
      // localStorage fallback below is part of the production durability contract.
    }
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('warwick_durable_draft_v1:')) continue;
      try {
        const record: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (record && typeof record === 'object' && matches((record as { key?: unknown }).key)) {
          return readPrompt((record as { value?: unknown }).value);
        }
      } catch {
        // Ignore malformed unrelated localStorage entries.
      }
    }
    return null;
  }, examId);
}

async function promptFieldWithValue(page: Page, value: string) {
  const fields = page.locator('textarea[placeholder="Enter the question prompt..."]');
  await expect(fields.first()).toBeVisible({ timeout: 30_000 });
  const count = await fields.count();
  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    if ((await field.inputValue()) === value) return field;
  }
  throw new Error(`Could not find builder prompt field with value: ${value}`);
}

test.describe('Staff draft browser durability', () => {
  test('recovers an unsent builder edit after the page is killed and clears recovery only after server acknowledgement', async ({
    context,
    page,
  }) => {
    const manifest = readBackendE2EManifest();
    const examId = manifest.builder.draftDurabilityExamId;
    await page.goto(`/builder/${examId}/builder`);
    const initialServerPrompt = await readServerPrompt(page, examId);
    expect(initialServerPrompt).not.toBeNull();
    const prompt = await promptFieldWithValue(page, initialServerPrompt as string);
    await expect(prompt).toBeVisible({ timeout: 30_000 });

    const recoveredPrompt = `staff-recovery-${Date.now()}-no-loss`;
    await page.route(`**/api/v1/exams/${examId}/draft`, async (route) => {
      await route.abort('failed');
    });

    await prompt.fill(recoveredPrompt);
    await expect
      .poll(() => readRecoveredPrompt(page, examId), {
        timeout: 10_000,
        message: 'edited builder state is committed to browser durable storage',
      })
      .toBe(recoveredPrompt);

    expect(await readServerPrompt(page, examId)).toBe(initialServerPrompt);

    // Closing the page without beforeunload is a crash-like interruption: the
    // React autosave queue disappears, while IndexedDB/localStorage survives.
    await page.close({ runBeforeUnload: false });
    const reopened = await context.newPage();
    await reopened.goto(`/builder/${examId}/builder`);

    const reopenedPrompt = await promptFieldWithValue(reopened, recoveredPrompt);
    await expect(reopenedPrompt).toBeVisible({ timeout: 30_000 });
    await expect(reopened.getByText('Recovered unsaved changes')).toBeVisible({ timeout: 10_000 });
    await expect(reopenedPrompt).toHaveValue(recoveredPrompt);
    expect(await readServerPrompt(reopened, examId)).toBe(initialServerPrompt);
    const saveResponse = reopened.waitForResponse((response) =>
      response.url().includes(`/api/v1/exams/${examId}/draft`)
      && response.request().method() === 'PATCH',
    );
    await reopened.getByLabel('Save draft').click();
    expect((await saveResponse).ok()).toBe(true);

    await expect
      .poll(() => readServerPrompt(reopened, examId), { timeout: 20_000 })
      .toBe(recoveredPrompt);
    await expect
      .poll(() => readRecoveredPrompt(reopened, examId), {
        timeout: 10_000,
        message: 'durable recovery record clears only after successful server save',
      })
      .toBeNull();
    await reopened.close();
  });
});
