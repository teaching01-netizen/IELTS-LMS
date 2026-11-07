import { createServer, type Server } from 'node:http';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SatStaffControlDialog } from '../SatStaffControlDialog';

let server: Server;
let requests: Array<Record<string, unknown>>;
let origin: string;
const realFetch = globalThis.fetch;
beforeEach(async () => {
 requests = [];
 server = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
   const command = JSON.parse(body) as Record<string, unknown>;
   requests.push(command);
   res.setHeader('content-type', 'application/json');
   res.end(JSON.stringify({ outcomes: (command.attemptIds as string[]).map(attemptId => ({ attemptId, applied: true })) }));
  });
 });
 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 const address = server.address();
 if (!address || typeof address === 'string') throw new Error('test server missing');
 origin = `http://127.0.0.1:${address.port}`;
 vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => { const { signal: _signal, ...options } = init ?? {}; return realFetch(origin + new URL(String(input), 'http://localhost').pathname, options); });
});
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); await new Promise<void>(resolve => server.close(() => resolve())); });

const movePlan = [{ sectionKey: 'reading-writing', label: 'Reading & Writing', order: 0, durationMinutes: 64, gapAfterMinutes: 10, modules: [{ moduleKey: 'rw-m1', title: 'Module 1', adaptiveRole: 'base', durationMinutes: 32 }] }];

// The student's own clock keeps counting while the dialog is open, so the edit
// view names where they actually are (the room's latest read) and the seconds
// their deadline still holds — ticking on the room's shared clock, never the
// frozen click snapshot the review request is built from.
it('shows the selected student current module and remaining time as it ticks', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-30T02:05:00Z').getTime());
  const live = {
    'student-a': {
      stage: 'Reading & Writing · Module 1',
      deadlineAt: '2026-08-30T02:35:00Z',
      running: true,
      // A deliberately wrong fallback the old snapshot might have carried: the
      // deadline must win, never a stale poll's seconds.
      remainingSeconds: 900,
    },
  };
  try {
    render(<SatStaffControlDialog scheduleId="room" targets={[{ id: 'student-a', name: 'Ada', remainingSeconds: 900, stage: 'reading' }]} action="move" plan={movePlan} onClose={() => {}} onApplied={() => {}} live={live} roomClock={{ serverNow: '2026-08-30T02:05:00Z', receivedAt: 0 }} />);
    expect(document.querySelector('[data-sat-staff-control-current]')?.textContent).toBe('Current: Reading & Writing · Module 1 · 30:00 remaining');
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(document.querySelector('[data-sat-staff-control-current]')?.textContent).toBe('Current: Reading & Writing · Module 1 · 29:58 remaining');
  } finally {
    vi.useRealTimers();
    vi.setSystemTime(new Date('2026-08-30T02:05:00Z').getTime());
  }
});

// The review decision can sit open while a room keeps moving: the affected list
// re-reads each student's live state (stage label and their deadline-derived
// seconds) on every room refresh, so a student who advanced mid-review is
// visible before Apply — and without live inputs the click-time snapshot is
// still what the rows show.
it('refreshes the affected students list with the room latest read as it reviews', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-30T02:05:00Z').getTime());
  const props = {
    scheduleId: 'room',
    targets: [{ id: 'student-a', name: 'Ada', remainingSeconds: 900, stage: 'reading' }],
    action: 'move' as const,
    plan: movePlan,
    onClose: () => {},
    onApplied: () => {},
  };
  const live = () => ({
    'student-a': {
      stage: 'Reading & Writing · Module 1',
      deadlineAt: '2026-08-30T02:35:00Z',
      running: true,
      fallbackSeconds: 900,
    },
  });
  try {
    const view = render(<SatStaffControlDialog {...props} live={live()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    const list = screen.getByRole('list', { name: 'Affected students' });
    const row = () => within(list).getByText('Ada').closest('li') as HTMLElement;
    expect(row()).toHaveTextContent('Reading & Writing · Module 1');
    expect(row()).toHaveTextContent('· 30:00');
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(row()).toHaveTextContent('· 29:58');
    // The room's next read says the student moved on while the dialog sat open.
    view.rerender(<SatStaffControlDialog {...props} live={{ 'student-a': { ...live()['student-a'], stage: 'Reading & Writing · Module 2' } }} />);
    expect(row()).toHaveTextContent('Reading & Writing · Module 2');

    // Without live inputs the click-time snapshot is what the rows show.
    view.rerender(<SatStaffControlDialog {...props} />);
    expect(row()).toHaveTextContent('reading');
    expect(row()).toHaveTextContent('· 15:00');
  } finally {
    vi.useRealTimers();
    vi.setSystemTime(new Date('2026-08-30T02:05:00Z').getTime());
  }
});

it('reviews an exact individual time edit before sending the staff HTTP command', async () => {
 render(<SatStaffControlDialog scheduleId="room" targets={[{ id: 'student-a', name: 'Ada', remainingSeconds: 500, stage: 'Math Module 1' }]} action="set_time" plan={[]} onClose={() => {}} onApplied={() => {}} />);
 fireEvent.change(screen.getByLabelText('Remaining time (mm:ss)'), { target: { value: '20:00' } });
 fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
 expect(screen.getByText('Ada')).toBeInTheDocument();
 expect(screen.getByText(/20:00 remaining/)).toBeInTheDocument();
 expect(requests).toHaveLength(0);
 fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
 await screen.findByText('Change applied to 1 student.');
 expect(requests[0]).toMatchObject({ attemptIds: ['student-a'], action: 'set_time', remainingSeconds: 1200 });
});

it('moves the reviewed whole-room list with automatic routing and an editable destination clock', async () => {
 render(<SatStaffControlDialog scheduleId="room" targets={[{ id: 'a', name: 'Ada', remainingSeconds: 500, stage: 'Reading Module 1' }, { id: 'b', name: 'Ben', remainingSeconds: 200, stage: 'Math Module 1 · Disconnected' }]} action="move" plan={[{ sectionKey: 'math', label: 'Math', order: 1, durationMinutes: 70, gapAfterMinutes: 0, modules: [{ moduleKey: 'm1', title: 'Module 1', adaptiveRole: 'base', durationMinutes: 35 }, { moduleKey: 'm2l', title: 'Module 2', adaptiveRole: 'lower_branch', durationMinutes: 35 }, { moduleKey: 'm2h', title: 'Module 2', adaptiveRole: 'higher_branch', durationMinutes: 35 }] }]} onClose={() => {}} onApplied={() => {}} />);
 fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'math:module_2' } });
 expect(screen.getByLabelText('Module 2 selection')).toHaveValue('automatic');
 expect(screen.getByLabelText('Remaining time (mm:ss)')).toHaveValue('35:00');
 fireEvent.change(screen.getByLabelText('Remaining time (mm:ss)'), { target: { value: '25:00' } });
 fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
 expect(screen.getByRole('list', { name: 'Affected students' }).children).toHaveLength(2);
 fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
 await screen.findByText('Change applied to 2 students.');
 expect(requests[0]).toMatchObject({ attemptIds: ['a', 'b'], action: 'move', sectionKey: 'math', destination: 'module_2', route: 'automatic', remainingSeconds: 1500 });
});
