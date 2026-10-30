import { describe, expect, it } from 'vitest';
import vectors from './ieltsSharedSchedule.vectors.json';
import {
  nextIeltsSharedBoundaryMs,
  parseIeltsSharedSchedule,
  resolveIeltsSharedPosition,
} from '../ieltsSharedSchedule';

describe('IELTS shared timetable resolver', () => {
  for (const vector of vectors) {
    it(`matches the Go resolver: ${vector.name}`, () => {
      const schedule = parseIeltsSharedSchedule(vector.schedule);
      expect(schedule).not.toBeNull();
      for (const c of vector.cases) {
        const position = resolveIeltsSharedPosition(schedule!, Date.parse(c.at));
        expect({ at: c.at, kind: position.kind, section: position.window?.sectionKey ?? '' }).toEqual({
          at: c.at,
          kind: c.kind,
          section: c.section,
        });
      }
    });
  }

  it('rejects malformed or tampered schedules', () => {
    const base = vectors[0]!.schedule;
    const windows = base.windows;
    expect(parseIeltsSharedSchedule({ ...base, schemaVersion: 2 })).toBeNull();
    expect(parseIeltsSharedSchedule({ ...base, status: 'paused' })).toBeNull();
    expect(parseIeltsSharedSchedule({ ...base, windows: [windows[0], windows[0]] })).toBeNull();
    expect(parseIeltsSharedSchedule({ ...base, windows: [{ ...windows[0], sectionKey: 'speaking' }] })).toBeNull();
    expect(
      parseIeltsSharedSchedule({ ...base, windows: [windows[0], { ...windows[1], startAt: windows[0]!.deadlineAt }] }),
    ).toBeNull();
    expect(parseIeltsSharedSchedule('{}')).toBeNull();
  });

  it('reports the next boundary so a timer can fire exactly there', () => {
    const schedule = parseIeltsSharedSchedule(vectors[0]!.schedule)!;
    expect(nextIeltsSharedBoundaryMs(schedule, Date.parse('2026-10-30T03:30:00Z'))).toBe(
      Date.parse('2026-10-30T04:00:00Z'),
    );
    expect(nextIeltsSharedBoundaryMs(schedule, Date.parse('2026-10-30T06:00:00Z'))).toBeNull();
  });
});
