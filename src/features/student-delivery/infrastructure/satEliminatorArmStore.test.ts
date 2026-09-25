import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSatEliminatorArms,
  loadSatEliminatorArms,
  satEliminatorArmsKey,
  saveSatEliminatorArms,
} from './satEliminatorArmStore';

beforeEach(() => {
  window.localStorage.clear();
});

describe('satEliminatorArmStore', () => {
  it('scopes arming per attempt and per schedule', () => {
    expect(satEliminatorArmsKey('schedule-1', 'attempt-1')).toBe(
      'sat-eliminator-arms:v1:schedule-1:attempt-1',
    );
    expect(satEliminatorArmsKey('schedule-1', 'attempt-1')).not.toBe(
      satEliminatorArmsKey('schedule-1', 'attempt-2'),
    );
    expect(satEliminatorArmsKey('schedule-1', 'attempt-1')).not.toBe(
      satEliminatorArmsKey('schedule-2', 'attempt-1'),
    );
  });

  it('round-trips the armed questions of an attempt', () => {
    expect(saveSatEliminatorArms('s', 'a', new Set(['ma-1:q1', 'ma-1:q7']))).toBe(true);
    expect([...loadSatEliminatorArms('s', 'a')].sort()).toEqual(['ma-1:q1', 'ma-1:q7']);
  });

  it('reads a missing attempt as unarmed', () => {
    expect(loadSatEliminatorArms('s', 'missing').size).toBe(0);
  });

  it('does not leak one attempt’s arms into another', () => {
    saveSatEliminatorArms('s', 'a', new Set(['ma-1:q1']));
    expect(loadSatEliminatorArms('s', 'b').size).toBe(0);
  });

  it('stores nothing armed as no record at all', () => {
    saveSatEliminatorArms('s', 'a', new Set(['ma-1:q1']));
    expect(saveSatEliminatorArms('s', 'a', new Set())).toBe(true);
    expect(window.localStorage.getItem(satEliminatorArmsKey('s', 'a'))).toBeNull();
  });

  it('clears corrupt data instead of failing the exam', () => {
    const key = satEliminatorArmsKey('s', 'a');
    window.localStorage.setItem(key, '{not json');
    expect(loadSatEliminatorArms('s', 'a').size).toBe(0);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('drops a payload it does not recognise rather than guessing at it', () => {
    const key = satEliminatorArmsKey('s', 'a');
    // A future version, and a record without the version marker: neither is
    // read as this version's shape.
    window.localStorage.setItem(key, JSON.stringify({ version: 2, questionKeys: ['ma-1:q1'] }));
    expect(loadSatEliminatorArms('s', 'a').size).toBe(0);
    expect(window.localStorage.getItem(key)).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ questionKeys: ['ma-1:q1'] }));
    expect(loadSatEliminatorArms('s', 'a').size).toBe(0);
    window.localStorage.setItem(key, JSON.stringify(['ma-1:q1']));
    expect(loadSatEliminatorArms('s', 'a').size).toBe(0);
  });

  it('keeps only usable keys, once each, within the remembered ceiling', () => {
    const key = satEliminatorArmsKey('s', 'a');
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        questionKeys: [7, 'ma-1:q1', '', '  ', 'ma-1:q1', 'ma-1:q2', null],
      }),
    );
    expect([...loadSatEliminatorArms('s', 'a')].sort()).toEqual(['ma-1:q1', 'ma-1:q2']);

    const oversized = Array.from({ length: 260 }, (_, index) => `ma-1:q${index}`);
    window.localStorage.setItem(key, JSON.stringify({ version: 1, questionKeys: oversized }));
    expect(loadSatEliminatorArms('s', 'a').size).toBe(200);
  });

  it('leaves nothing behind when the attempt ends', () => {
    saveSatEliminatorArms('s', 'a', new Set(['ma-1:q1']));
    clearSatEliminatorArms('s', 'a');
    expect(window.localStorage.getItem(satEliminatorArmsKey('s', 'a'))).toBeNull();
    expect(loadSatEliminatorArms('s', 'a').size).toBe(0);
  });
});
