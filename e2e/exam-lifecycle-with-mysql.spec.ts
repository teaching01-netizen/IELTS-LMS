import { expect, test, type Page } from '@playwright/test';
import { BUILDER_STORAGE_STATE_PATH } from './support/backendE2e';

test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

type ApiPayload<T> = T | { data: T };

interface ExamSnapshot {
  id: string;
  title: string;
  status: string;
  revision: number;
  currentDraftVersionId?: string | null;
  currentPublishedVersionId?: string | null;
}

interface VersionSnapshot {
  id: string;
  examId: string;
  revision: number;
  isDraft: boolean;
  isPublished: boolean;
  contentSnapshot?: unknown;
}

interface ValidationSnapshot {
  canPublish: boolean;
  errors: Array<{ field: string; message: string }>;
}

interface ApiResponse {
  status: number;
  payload: unknown;
}

function unwrap<T>(payload: ApiPayload<T>): T {
  if (typeof payload === 'object' && payload !== null && 'data' in payload) {
    return payload.data;
  }
  return payload as T;
}

async function writeApi(
  page: Page,
  method: 'DELETE' | 'PATCH' | 'POST',
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<ApiResponse> {
  const cookies = await page.context().cookies();
  const csrfCookieNames = [
    process.env['CSRF_COOKIE_NAME'],
    process.env['AUTH_CSRF_COOKIE_NAME'],
    '__Host-csrf',
    'csrf',
  ].filter((name): name is string => Boolean(name));
  const csrf = cookies.find((cookie) => csrfCookieNames.includes(cookie.name))?.value;
  if (!csrf) {
    throw new Error('Builder storage state did not contain a CSRF cookie.');
  }

  return page.evaluate(async ({ endpoint: requestEndpoint, method: requestMethod, body: requestBody, csrf: token }) => {
    const response = await fetch(requestEndpoint, {
      method: requestMethod,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': token,
      },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
    return { status: response.status, payload };
  }, { endpoint, method, body, csrf });
}

async function readApi(page: Page, endpoint: string): Promise<ApiResponse> {
  return page.evaluate(async (requestEndpoint) => {
    const response = await fetch(requestEndpoint, { credentials: 'include' });
    return { status: response.status, payload: await response.json() as unknown };
  }, endpoint);
}

async function createExam(page: Page, title: string): Promise<ExamSnapshot> {
  const response = await writeApi(page, 'POST', '/api/v1/exams', {
    slug: `e2e-mysql-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    examType: 'Academic',
    visibility: 'organization',
    providerKey: 'ielts',
  });
  expect(response.status, JSON.stringify(response.payload)).toBe(201);
  return unwrap<ExamSnapshot>(response.payload as ApiPayload<ExamSnapshot>);
}

async function getExam(page: Page, examId: string): Promise<ExamSnapshot> {
  const response = await readApi(page, `/api/v1/exams/${examId}`);
  expect(response.status, JSON.stringify(response.payload)).toBe(200);
  return unwrap<ExamSnapshot>(response.payload as ApiPayload<ExamSnapshot>);
}

test.describe('Exam lifecycle against the Go/MySQL API', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'Skipping webkit due to storage state auth issue');

  test.beforeEach(async ({ page }) => {
    // API helpers use same-origin fetch; establish the authenticated app
    // origin before the first mutation instead of evaluating from about:blank.
    await page.goto('/admin/exams');
  });

  test('creates, saves, validates, publishes, and records the audit trail', async ({ page }) => {
    const examTitle = `Go lifecycle exam ${Date.now()}`;
    let examId: string | undefined;

    try {
      const created = await createExam(page, examTitle);
      examId = created.id;
      expect(created.title).toBe(examTitle);
      expect(created.status).toBe('draft');
      expect(created.revision).toBe(0);
      expect(created.currentDraftVersionId).toBeTruthy();

      const initial = await getExam(page, examId);
      expect(initial.currentDraftVersionId).toBe(created.currentDraftVersionId);

      const initialVersionResponse = await readApi(page, `/api/v1/versions/${created.currentDraftVersionId}`);
      expect(initialVersionResponse.status).toBe(200);
      const initialVersion = initialVersionResponse.payload as VersionSnapshot;
      expect(initialVersion.examId).toBe(examId);
      expect(initialVersion.isDraft).toBe(true);

      const contentSnapshot = {
        sections: [
          {
            key: 'reading',
            title: 'Reading',
            questions: [{ id: 'lifecycle-question-1', prompt: 'What is being tested?' }],
          },
        ],
      };
      const configSnapshot = {
        modules: { reading: { enabled: true } },
        timing: { readingSeconds: 60 },
      };

      const savedResponse = await writeApi(page, 'PATCH', `/api/v1/exams/${examId}/draft`, {
        contentSnapshot,
        configSnapshot,
        revision: initialVersion.revision,
      });
      expect(savedResponse.status, JSON.stringify(savedResponse.payload)).toBe(200);
      const savedVersion = unwrap<VersionSnapshot>(savedResponse.payload as ApiPayload<VersionSnapshot>);
      expect(savedVersion.id).toBe(created.currentDraftVersionId);
      expect(savedVersion.revision).toBe(initialVersion.revision + 1);
      expect(JSON.stringify(savedVersion.contentSnapshot)).toContain('What is being tested?');

      const savedExam = await getExam(page, examId);
      expect(savedExam.revision).toBeGreaterThan(initial.revision);

      const validationResponse = await readApi(page, `/api/v1/exams/${examId}/validation`);
      expect(validationResponse.status).toBe(200);
      const validation = unwrap<ValidationSnapshot>(validationResponse.payload as ApiPayload<ValidationSnapshot>);
      expect(validation.canPublish).toBe(true);
      expect(validation.errors).toHaveLength(0);

      const publishResponse = await writeApi(page, 'POST', `/api/v1/exams/${examId}/publish`, {
        publishNotes: 'Published by the Go lifecycle E2E test',
        revision: savedVersion.revision,
        expectedDraftVersionId: savedVersion.id,
        expectedDraftRevision: savedVersion.revision,
      });
      expect(publishResponse.status, JSON.stringify(publishResponse.payload)).toBe(200);
      const publishedVersion = unwrap<VersionSnapshot>(publishResponse.payload as ApiPayload<VersionSnapshot>);
      expect(publishedVersion.isDraft).toBe(false);
      expect(publishedVersion.isPublished).toBe(true);

      const publishedExam = await getExam(page, examId);
      expect(publishedExam.status).toBe('published');
      expect(publishedExam.currentDraftVersionId).toBeFalsy();
      expect(publishedExam.currentPublishedVersionId).toBe(publishedVersion.id);

      const versionsResponse = await readApi(page, `/api/v1/exams/${examId}/versions`);
      expect(versionsResponse.status).toBe(200);
      const versions = unwrap<VersionSnapshot[]>(versionsResponse.payload as ApiPayload<VersionSnapshot[]>);
      expect(versions).toHaveLength(1);
      expect(versions[0]?.isPublished).toBe(true);

      const eventsResponse = await readApi(page, `/api/v1/exams/${examId}/events`);
      expect(eventsResponse.status).toBe(200);
      const events = unwrap<Array<{ action: string }>>(eventsResponse.payload as ApiPayload<Array<{ action: string }>>);
      expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(['created', 'draft_saved', 'published']));
    } finally {
      if (examId) {
        const deleted = await writeApi(page, 'DELETE', `/api/v1/exams/${examId}`);
        expect(deleted.status, JSON.stringify(deleted.payload)).toBe(200);
      }
    }
  });

  test('keeps invalid drafts unpublished and rejects stale revisions', async ({ page }) => {
    const examTitle = `Go validation exam ${Date.now()}`;
    let examId: string | undefined;

    try {
      const created = await createExam(page, examTitle);
      examId = created.id;
      const draftVersionId = created.currentDraftVersionId;
      expect(draftVersionId).toBeTruthy();

      const savedInvalidResponse = await writeApi(page, 'PATCH', `/api/v1/exams/${examId}/draft`, {
        contentSnapshot: { sections: [{ key: 'not-an-ielts-section' }] },
        configSnapshot: { timing: { readingSeconds: 60 } },
        revision: 0,
      });
      expect(savedInvalidResponse.status).toBe(200);
      const savedInvalid = unwrap<VersionSnapshot>(savedInvalidResponse.payload as ApiPayload<VersionSnapshot>);

      const validationResponse = await readApi(page, `/api/v1/exams/${examId}/validation`);
      expect(validationResponse.status).toBe(200);
      const validation = unwrap<ValidationSnapshot>(validationResponse.payload as ApiPayload<ValidationSnapshot>);
      expect(validation.canPublish).toBe(false);
      expect(validation.errors.some((error) => error.field.includes('contentSnapshot.sections'))).toBe(true);

      const publishResponse = await writeApi(page, 'POST', `/api/v1/exams/${examId}/publish`, {
        revision: savedInvalid.revision,
        expectedDraftVersionId: draftVersionId,
        expectedDraftRevision: savedInvalid.revision,
      });
      expect(publishResponse.status).toBe(422);

      const staleSaveResponse = await writeApi(page, 'PATCH', `/api/v1/exams/${examId}/draft`, {
        contentSnapshot: { sections: [{ key: 'reading' }] },
        configSnapshot: { timing: { readingSeconds: 90 } },
        revision: 0,
      });
      expect(staleSaveResponse.status).toBe(409);
      expect((await getExam(page, examId)).status).toBe('draft');
    } finally {
      if (examId) {
        const deleted = await writeApi(page, 'DELETE', `/api/v1/exams/${examId}`);
        expect(deleted.status, JSON.stringify(deleted.payload)).toBe(200);
      }
    }
  });
});
