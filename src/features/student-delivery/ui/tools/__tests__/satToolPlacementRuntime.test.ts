import { afterEach, expect, it } from 'vitest';
import { readSatToolSafeArea } from '../satToolPlacementRuntime';

afterEach(() => document.documentElement.removeAttribute('style'));

it('converts resolved device safe-area insets once into logical exam coordinates', () => {
  const root = document.documentElement.style;
  root.setProperty('--student-safe-top', '24px');
  root.setProperty('--student-safe-right', '20px');
  root.setProperty('--student-safe-bottom', '34px');
  root.setProperty('--student-safe-left', '10px');
  expect(readSatToolSafeArea()).toEqual({ top: 136, right: 36, bottom: 120, left: 26 });
  expect(readSatToolSafeArea((physical) => physical / 0.5)).toEqual({ top: 160, right: 56, bottom: 154, left: 36 });
});
