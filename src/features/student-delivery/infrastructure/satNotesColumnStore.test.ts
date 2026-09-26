import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSatNotesColumn,
  loadSatNotesColumnOpen,
  satNotesColumnKey,
  saveSatNotesColumnOpen,
} from './satNotesColumnStore';

beforeEach(() => {
  window.localStorage.clear();
});

describe('satNotesColumnStore', () => {
  it('scopes the record per attempt', () => {
    expect(satNotesColumnKey('schedule-1', 'attempt-1')).toBe(
      'sat-notes-column:v1:schedule-1:attempt-1',
    );
    expect(satNotesColumnKey('schedule-1', 'attempt-1')).not.toBe(
      satNotesColumnKey('schedule-1', 'attempt-2'),
    );
  });

  it('round-trips an open column for the module attempt it was left in', () => {
    expect(saveSatNotesColumnOpen('s', 'a', 'ma-1', true)).toBe(true);
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-1')).toBe(true);
  });

  it('reads a closed record, a missing attempt, and another attempt as closed', () => {
    expect(loadSatNotesColumnOpen('s', 'missing', 'ma-1')).toBe(false);
    saveSatNotesColumnOpen('s', 'a', 'ma-1', false);
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-1')).toBe(false);
    saveSatNotesColumnOpen('s', 'a', 'ma-1', true);
    expect(loadSatNotesColumnOpen('s', 'b', 'ma-1')).toBe(false);
  });

  it('does not carry the pane into a module the record does not name', () => {
    saveSatNotesColumnOpen('s', 'a', 'ma-1', true);
    // A new module is a new context: the record answers only for ma-1, so the
    // next module starts with its column closed without a second key family.
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-2')).toBe(false);
    // Once the student opens it there, THAT is what the record names.
    saveSatNotesColumnOpen('s', 'a', 'ma-2', true);
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-2')).toBe(true);
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-1')).toBe(false);
  });

  it('clears corrupt and foreign payloads instead of failing the exam', () => {
    const key = satNotesColumnKey('s', 'a');
    window.localStorage.setItem(key, '{not json');
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-1')).toBe(false);
    expect(window.localStorage.getItem(key)).toBeNull();

    window.localStorage.setItem(key, JSON.stringify({ version: 2, moduleAttemptId: 'ma-1', open: true }));
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-1')).toBe(false);
    expect(window.localStorage.getItem(key)).toBeNull();

    // A record that cannot name a module attempt cannot be honored either.
    window.localStorage.setItem(key, JSON.stringify({ version: 1, open: true }));
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-1')).toBe(false);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('leaves nothing behind when the attempt ends', () => {
    saveSatNotesColumnOpen('s', 'a', 'ma-1', true);
    clearSatNotesColumn('s', 'a');
    expect(window.localStorage.getItem(satNotesColumnKey('s', 'a'))).toBeNull();
    expect(loadSatNotesColumnOpen('s', 'a', 'ma-1')).toBe(false);
  });
});
