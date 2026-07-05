import { describe, expect, it } from 'vitest';
import {
  createBlockingMachineState,
  transitionBlockingMachine,
  syncProctorBlockingMachine,
} from '../blockingStateMachine';

describe('blockingStateMachine priority ordering', () => {
  it('proctor_paused takes precedence over storage_unavailable', () => {
    let state = createBlockingMachineState();
    state = transitionBlockingMachine(state, 'storage_unavailable', true);
    expect(state.current).toBe('storage_unavailable');

    state = transitionBlockingMachine(state, 'proctor_paused', true);
    expect(state.current).toBe('proctor_paused');
  });

  it('clearing proctor_paused reveals storage_unavailable', () => {
    let state = createBlockingMachineState();
    state = transitionBlockingMachine(state, 'storage_unavailable', true);
    state = transitionBlockingMachine(state, 'proctor_paused', true);
    expect(state.current).toBe('proctor_paused');

    state = transitionBlockingMachine(state, 'proctor_paused', false);
    expect(state.current).toBe('storage_unavailable');
  });

  it('returns null when all blocking reasons are cleared', () => {
    let state = createBlockingMachineState();
    state = transitionBlockingMachine(state, 'proctor_paused', true);
    state = transitionBlockingMachine(state, 'storage_unavailable', true);
    expect(state.current).toBe('proctor_paused');

    state = transitionBlockingMachine(state, 'proctor_paused', false);
    state = transitionBlockingMachine(state, 'storage_unavailable', false);
    expect(state.current).toBeNull();
  });

  it('non-blocking integrity reasons do not affect current state', () => {
    let state = createBlockingMachineState();
    state = transitionBlockingMachine(state, 'proctor_paused', true);
    expect(state.current).toBe('proctor_paused');

    state = transitionBlockingMachine(state, 'offline', true);
    expect(state.current).toBe('proctor_paused');

    state = transitionBlockingMachine(state, 'heartbeat_lost', true);
    expect(state.current).toBe('proctor_paused');

    state = transitionBlockingMachine(state, 'syncing_reconnect', true);
    expect(state.current).toBe('proctor_paused');

    state = transitionBlockingMachine(state, 'device_mismatch', true);
    expect(state.current).toBe('proctor_paused');
  });

  it('only proctor_paused and storage_unavailable can be active blocking reasons', () => {
    let state = createBlockingMachineState();

    state = transitionBlockingMachine(state, 'proctor_paused', true);
    expect(state.current).toBe('proctor_paused');

    state = transitionBlockingMachine(state, 'proctor_paused', false);
    expect(state.current).toBeNull();

    state = transitionBlockingMachine(state, 'storage_unavailable', true);
    expect(state.current).toBe('storage_unavailable');

    state = transitionBlockingMachine(state, 'storage_unavailable', false);
    expect(state.current).toBeNull();
  });

  it('handles rapid toggling of proctor_paused', () => {
    let state = createBlockingMachineState();
    state = transitionBlockingMachine(state, 'proctor_paused', true);
    expect(state.current).toBe('proctor_paused');

    state = transitionBlockingMachine(state, 'proctor_paused', false);
    expect(state.current).toBeNull();

    state = transitionBlockingMachine(state, 'proctor_paused', true);
    expect(state.current).toBe('proctor_paused');
  });

  it('proctor sync activates pause', () => {
    let state = createBlockingMachineState();
    state = syncProctorBlockingMachine(state, 'paused');
    expect(state.current).toBe('proctor_paused');
    expect(state.flags.proctor_paused).toBe(true);
  });

  it('proctor sync deactivates pause', () => {
    let state = createBlockingMachineState();
    state = syncProctorBlockingMachine(state, 'paused');
    expect(state.current).toBe('proctor_paused');

    state = syncProctorBlockingMachine(state, 'active');
    expect(state.current).toBeNull();
    expect(state.flags.proctor_paused).toBe(false);
  });

  it('proctor sync is idempotent when already paused', () => {
    let state = createBlockingMachineState();
    state = syncProctorBlockingMachine(state, 'paused');
    const snapshot = { ...state };
    state = syncProctorBlockingMachine(state, 'paused');
    expect(state).toEqual(snapshot);
  });

  it('proctor sync is idempotent when already active', () => {
    let state = createBlockingMachineState();
    state = syncProctorBlockingMachine(state, 'active');
    const snapshot = { ...state };
    state = syncProctorBlockingMachine(state, 'active');
    expect(state).toEqual(snapshot);
  });

  it('initial state with no blocking reasons is null', () => {
    const state = createBlockingMachineState();
    expect(state.current).toBeNull();
    expect(state.flags.offline).toBe(false);
    expect(state.flags.proctor_paused).toBe(false);
    expect(state.flags.storage_unavailable).toBe(false);
    expect(state.flags.device_mismatch).toBe(false);
    expect(state.flags.heartbeat_lost).toBe(false);
    expect(state.flags.syncing_reconnect).toBe(false);
  });

  it('initial state with a blocking reason has that as current', () => {
    const state = createBlockingMachineState('proctor_paused');
    expect(state.current).toBe('proctor_paused');
    expect(state.flags.proctor_paused).toBe(true);
  });

  it('initial state with storage_unavailable', () => {
    const state = createBlockingMachineState('storage_unavailable');
    expect(state.current).toBe('storage_unavailable');
    expect(state.flags.storage_unavailable).toBe(true);
  });

  it('initial state with non-blocking reason sets current via priority', () => {
    const state = createBlockingMachineState('offline');
    expect(state.current).toBe('offline');
    expect(state.flags.offline).toBe(true);
  });
});
