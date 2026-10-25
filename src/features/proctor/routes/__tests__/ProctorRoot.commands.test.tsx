import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProctorRoot } from '../ProctorRoot';

vi.mock('@shared/hooks/useLiveUpdates', () => ({ useLiveUpdates: () => undefined }));
vi.mock('../../../auth/authSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../auth/authSession')>()),
  useAuthSession: () => ({
    status: 'authenticated',
    session: { user: { id: 'proctor-1', email: 'p@example.test', displayName: 'Dana Proctor', role: 'proctor', state: 'active' } },
  }),
}));

const originalFetch = global.fetch;

const schedule = {
  id: 'sched-1',
  examId: 'exam-1',
  providerKey: 'ielts',
  examTitle: 'Mock Exam',
  publishedVersionId: 'ver-1',
  cohortName: 'Cohort A',
  startTime: '2026-01-01T09:00:00.000Z',
  endTime: '2026-01-01T12:00:00.000Z',
  plannedDurationMinutes: 180,
  deliveryMode: 'proctor_start',
  recurrenceType: 'none',
  recurrenceInterval: 1,
  autoStart: false,
  autoStop: false,
  status: 'live',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'admin-1',
  updatedAt: '2026-01-01T00:00:00.000Z',
  revision: 1,
};

const runtime = {
  id: 'runtime-1',
  scheduleId: 'sched-1',
  examId: 'exam-1',
  providerKey: 'ielts',
  status: 'live',
  revision: 3,
  actualStartAt: '2026-01-01T09:00:00.000Z',
  actualEndAt: null,
  activeSectionKey: 'reading',
  currentSectionKey: 'reading',
  currentSectionRemainingSeconds: 1200,
  waitingForNextSection: false,
  isOverrun: false,
  totalPausedSeconds: 0,
  createdAt: '2026-01-01T09:00:00.000Z',
  updatedAt: '2026-01-01T09:00:00.000Z',
  sections: [{
    sectionKey: 'reading',
    label: 'Reading',
    sectionOrder: 1,
    plannedDurationMinutes: 60,
    gapAfterMinutes: 0,
    status: 'live',
    availableAt: '2026-01-01T09:00:00.000Z',
    actualStartAt: '2026-01-01T09:00:00.000Z',
    actualEndAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionMinutes: 0,
    projectedStartAt: '2026-01-01T09:00:00.000Z',
    projectedEndAt: '2026-01-01T10:00:00.000Z',
  }],
};

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** HTTP 200 carrying a business rejection: never a success. */
function rejected(message: string) {
  return new Response(JSON.stringify({ success: false, error: { code: 'RUNTIME_REJECTED', message } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installTransport() {
  const writes: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      writes.push(`${method} ${url}`);
      if (url.includes('/presence')) return ok({});
      return rejected('Runtime revision changed');
    }
    if (url.startsWith('/api/v1/proctor/sessions/sched-1')) {
      return ok({ schedule, runtime, sessions: [], alerts: [], auditLogs: [], notes: [], presence: [], violationRules: [], degradedLiveMode: false });
    }
    if (url.startsWith('/api/v1/proctor/sessions')) {
      return ok([{ schedule, runtime, studentCount: 0, activeCount: 0, degradedLiveMode: false }]);
    }
    return ok({});
  }) as typeof fetch;
  return writes;
}

function renderRoot() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProctorRoot />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openCohort() {
  fireEvent.click(await screen.findByText('Monitor Session'));
  await waitFor(() => expect(screen.getByRole('button', { name: /End Section/ })).toBeEnabled());
}

describe('ProctorRoot cohort commands (F4)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it('a rejected end-section shows the failure, never the success toast', async () => {
    installTransport();
    renderRoot();
    await openCohort();

    fireEvent.click(screen.getByRole('button', { name: /End Section/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'End section now' }));

    expect(await screen.findByText('End section failed')).toBeInTheDocument();
    expect(screen.queryByText('Current section ended for the cohort.')).not.toBeInTheDocument();
  });

  it('a rejected extension shows the failure, never the success toast', async () => {
    installTransport();
    renderRoot();
    await openCohort();

    fireEvent.click(screen.getByRole('button', { name: /Extend \+5/ }));

    expect(await screen.findByText('Extend section failed')).toBeInTheDocument();
    expect(screen.queryByText('Current section extended by 5 minutes.')).not.toBeInTheDocument();
  });

  it('a rejected completion shows the failure, never the success toast', async () => {
    const writes = installTransport();
    renderRoot();
    await openCohort();

    fireEvent.click(screen.getByRole('button', { name: /Complete/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete exam' }));

    expect(await screen.findByText('Complete exam failed')).toBeInTheDocument();
    expect(screen.queryByText('Exam completed for the cohort.')).not.toBeInTheDocument();
    expect(writes.some((write) => !write.includes('/presence'))).toBe(true);
  });
});
