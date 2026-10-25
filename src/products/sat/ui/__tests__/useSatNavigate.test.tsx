import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSatNavigate } from '../useSatNavigate';

const navigate = vi.hoisted(() => vi.fn());
const preferences = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', () => ({ useReducedMotion: () => preferences.reduce }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

describe('SAT route transitions', () => {
  beforeEach(() => { navigate.mockReset(); preferences.reduce = false; });

  it('keeps route options and receipt state while requesting a router-owned transition', () => {
    const { result } = renderHook(useSatNavigate);
    act(() => { void result.current('/sat/sessions/room-1', { replace: true, state: { satCreatedRoom: 'room-1' } }); });
    expect(navigate).toHaveBeenCalledWith('/sat/sessions/room-1', {
      viewTransition: true, replace: true, state: { satCreatedRoom: 'room-1' },
    });
  });

  it('skips native snapshots when the OS requests reduced motion', () => {
    preferences.reduce = true;
    const { result } = renderHook(useSatNavigate);
    act(() => { void result.current('/sat/exams/e1/settings'); });
    expect(navigate).toHaveBeenCalledWith('/sat/exams/e1/settings', { viewTransition: false });
  });

  it('preserves history navigation and allows a caller to skip snapshots', () => {
    const { result } = renderHook(useSatNavigate);
    act(() => { void result.current(-1); });
    expect(navigate).toHaveBeenLastCalledWith(-1);
    act(() => { void result.current('/sat/exams', { viewTransition: false }); });
    expect(navigate).toHaveBeenLastCalledWith('/sat/exams', { viewTransition: false });
  });
});
