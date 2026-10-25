import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSatEliminatorMode,
  loadSatEliminatorMode,
  satEliminatorModeKey,
  saveSatEliminatorMode,
} from './satEliminatorModeStore';

beforeEach(() => {
  window.localStorage.clear();
});

describe('satEliminatorModeStore', () => {
  it('scopes the switch per attempt and per schedule', () => {
    expect(satEliminatorModeKey('schedule-1', 'attempt-1')).toBe(
      'sat-eliminator-mode:v1:schedule-1:attempt-1',
    );
    expect(satEliminatorModeKey('schedule-1', 'attempt-1')).not.toBe(
      satEliminatorModeKey('schedule-1', 'attempt-2'),
    );
    expect(satEliminatorModeKey('schedule-1', 'attempt-1')).not.toBe(
      satEliminatorModeKey('schedule-2', 'attempt-1'),
    );
  });

  it('round-trips the switch of an attempt', () => {
    expect(saveSatEliminatorMode('s', 'a', true)).toBe(true);
    expect(loadSatEliminatorMode('s', 'a')).toBe(true);
  });

  it('reads a missing attempt as off', () => {
    expect(loadSatEliminatorMode('s', 'missing')).toBe(false);
  });

  it('does not leak one attempt’s switch into another', () => {
    saveSatEliminatorMode('s', 'a', true);
    expect(loadSatEliminatorMode('s', 'b')).toBe(false);
  });

  it('stores off as no record at all', () => {
    saveSatEliminatorMode('s', 'a', true);
    expect(saveSatEliminatorMode('s', 'a', false)).toBe(true);
    expect(window.localStorage.getItem(satEliminatorModeKey('s', 'a'))).toBeNull();
  });

  it('clears corrupt data instead of failing the exam', () => {
    const key = satEliminatorModeKey('s', 'a');
    window.localStorage.setItem(key, '{not json');
    expect(loadSatEliminatorMode('s', 'a')).toBe(false);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('drops a payload it does not recognise rather than guessing at it', () => {
    const key = satEliminatorModeKey('s', 'a');
    window.localStorage.setItem(key, JSON.stringify({ version: 2, on: true }));
    expect(loadSatEliminatorMode('s', 'a')).toBe(false);
    expect(window.localStorage.getItem(key)).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ on: true }));
    expect(loadSatEliminatorMode('s', 'a')).toBe(false);
    window.localStorage.setItem(key, JSON.stringify({ version: 1, on: 'yes' }));
    expect(loadSatEliminatorMode('s', 'a')).toBe(false);
  });

  it('leaves nothing behind when the attempt ends', () => {
    saveSatEliminatorMode('s', 'a', true);
    clearSatEliminatorMode('s', 'a');
    expect(window.localStorage.getItem(satEliminatorModeKey('s', 'a'))).toBeNull();
    expect(loadSatEliminatorMode('s', 'a')).toBe(false);
  });
});
