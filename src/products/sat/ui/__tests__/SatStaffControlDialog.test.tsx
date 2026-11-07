import { createServer, type Server } from 'node:http';
import { fireEvent, render, screen } from '@testing-library/react';
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
afterEach(async () => { vi.unstubAllGlobals(); await new Promise<void>(resolve => server.close(() => resolve())); });

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
