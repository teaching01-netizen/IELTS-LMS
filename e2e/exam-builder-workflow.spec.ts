import { expect, test, type Page } from '@playwright/test';
import {
  BUILDER_STORAGE_STATE_PATH,
  readBackendE2EManifest,
} from './support/backendE2e';

test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

type ApiPayload<T> = T | { data: T };

interface ExamSnapshot {
  id: string;
  status: string;
  revision: number;
  currentDraftVersionId?: string | null;
  currentPublishedVersionId?: string | null;
}

interface VersionSnapshot {
  id: string;
  revision: number;
  isDraft: boolean;
  isPublished: boolean;
  contentSnapshot?: unknown;
}

interface ValidationSnapshot {
  canPublish: boolean;
}

function unwrap<T>(payload: ApiPayload<T>): T {
  if (typeof payload === 'object' && payload !== null && 'data' in payload) {
    return payload.data;
  }
  return payload as T;
}

async function readExamSnapshot(page: Page, examId: string) {
  return page.evaluate(async (seedExamId) => {
    const responses = await Promise.all([
      fetch(`/api/v1/exams/${seedExamId}`, { credentials: 'include' }),
      fetch(`/api/v1/exams/${seedExamId}/versions`, { credentials: 'include' }),
      fetch(`/api/v1/exams/${seedExamId}/validation`, { credentials: 'include' }),
    ]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    if (responses.some((response) => !response.ok)) {
      throw new Error(`Builder snapshot request failed: ${responses.map((response) => response.status).join(', ')}`);
    }

    const normalize = <T,>(payload: T | { data: T }): T => {
      if (typeof payload === 'object' && payload !== null && 'data' in payload) {
        return payload.data;
      }
      return payload as T;
    };

    return {
      exam: normalize<ExamSnapshot>(payloads[0]),
      versions: normalize<VersionSnapshot[]>(payloads[1]),
      validation: normalize<ValidationSnapshot>(payloads[2]),
    };
  }, examId);
}

async function writeApi(
  page: Page,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: unknown }> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'csrf')?.value;
  if (!csrf) {
    throw new Error('Builder storage state did not contain a CSRF cookie.');
  }
  return page.evaluate(async ({ endpoint: requestEndpoint, body: requestBody, csrf: token }) => {
    const response = await fetch(requestEndpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': token,
      },
      body: JSON.stringify(requestBody),
    });
    return { status: response.status, payload: await response.json() };
  }, { endpoint, body, csrf });
}

test.describe('Backend-backed builder workflow', () => {
  test('loads the Go draft, saves, validates, publishes, and exposes its audit event', async ({ page }) => {
    const manifest = readBackendE2EManifest();
    const examId = manifest.builder.examId;
    const editedPrompt = `Builder prompt updated through Go E2E ${Date.now()}`;

    await page.goto(`/builder/${examId}/builder`);
    await expect(page.getByLabel('Exam title')).toBeVisible();

    const initialSnapshot = await readExamSnapshot(page, examId);
    expect(initialSnapshot.exam.id).toBe(examId);
    expect(initialSnapshot.versions).toHaveLength(manifest.builder.initialVersionCount);

    const prompt = page.getByPlaceholder('Enter the question prompt...').first();
    await prompt.fill(editedPrompt);
    await page.getByLabel('Save draft').click();

    await expect.poll(async () => {
      const snapshot = await readExamSnapshot(page, examId);
      return snapshot.versions.some((version) => JSON.stringify(version.contentSnapshot).includes(editedPrompt));
    }).toBe(true);

    const savedSnapshot = await readExamSnapshot(page, examId);
    expect(savedSnapshot.exam.revision).toBeGreaterThan(manifest.builder.initialRevision);
    expect(savedSnapshot.validation.canPublish).toBe(true);

    const draft = savedSnapshot.versions.find((version) => version.isDraft);
    expect(draft).toBeDefined();
    const publishResponse = await writeApi(page, `/api/v1/exams/${examId}/publish`, {
      publishNotes: 'Published by Go-backed builder E2E',
      revision: draft?.revision ?? -1,
    });
    expect(publishResponse.status).toBe(200);

    const publishedSnapshot = await readExamSnapshot(page, examId);
    expect(publishedSnapshot.exam.status).toBe('published');
    expect(publishedSnapshot.exam.currentPublishedVersionId).toBeTruthy();
    const publishedVersion = publishedSnapshot.versions.find(
      (version) => version.id === publishedSnapshot.exam.currentPublishedVersionId,
    );
    expect(publishedVersion?.isPublished).toBe(true);
    expect(JSON.stringify(publishedVersion?.contentSnapshot)).toContain(editedPrompt);

    const eventsResponse = await page.evaluate(async (seedExamId) => {
      const response = await fetch(`/api/v1/exams/${seedExamId}/events`, { credentials: 'include' });
      return { status: response.status, payload: await response.json() };
    }, examId);
    expect(eventsResponse.status).toBe(200);
    const events = unwrap<Array<{ action: string }>>(eventsResponse.payload as ApiPayload<Array<{ action: string }>>);
    expect(events.some((event) => event.action === 'published')).toBe(true);
  });

  test('fails closed when a builder requests an exam outside the available scope', async ({ page }) => {
    await page.goto('/login');
    const response = await page.evaluate(async () => {
      const result = await fetch('/api/v1/exams/00000000-0000-4000-8000-000000000000', { credentials: 'include' });
      return { status: result.status, payload: await result.json() };
    });
    expect(response.status).toBe(404);
  });
});
