import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesmosCalculator } from '../DesmosCalculator';
import type { DesmosCalculatorInstance, DesmosNamespace } from '../../../infrastructure/desmos/desmosTypes';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function createCalculator(): DesmosCalculatorInstance {
  return {
    getState: vi.fn(() => ({ expressions: { list: [] } })),
    setState: vi.fn(),
    setBlank: vi.fn(),
    resize: vi.fn(),
    focusFirstExpression: vi.fn(),
    observeEvent: vi.fn(),
    unobserveEvent: vi.fn(),
    destroy: vi.fn(),
  };
}

function installDesmos(calculator: DesmosCalculatorInstance, scientificEnabled = true) {
  const namespace: DesmosNamespace = {
    enabledFeatures: { GraphingCalculator: true, ScientificCalculator: scientificEnabled },
    GraphingCalculator: vi.fn(() => calculator),
    ScientificCalculator: vi.fn(() => calculator),
  };
  window.Desmos = namespace;
  return namespace;
}
describe('DesmosCalculator', () => {
  beforeEach(() => {
    delete window.Desmos;
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  it('uses the official scientific calculator and restores opaque state', async () => {
    const calculator = createCalculator();
    const Desmos = installDesmos(calculator);
    const onStateChange = vi.fn();
    const initialState = { evaluator: { degreeMode: false } };
    const { unmount } = render(
      <DesmosCalculator mode="scientific" initialState={initialState} onStateChange={onStateChange} />,
    );

    await waitFor(() => expect(Desmos.ScientificCalculator).toHaveBeenCalledTimes(1));
    expect(calculator.setState).toHaveBeenCalledWith(initialState);

    const observeMock = vi.mocked(calculator.observeEvent);
    const changeHandler = observeMock.mock.calls[0]?.[1];
    changeHandler?.();
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(onStateChange).toHaveBeenCalledWith({ expressions: { list: [] } });

    unmount();
    expect(calculator.unobserveEvent).toHaveBeenCalledWith('change.sat-exam');
    expect(calculator.destroy).toHaveBeenCalledTimes(1);
  });

  it('fails closed when scientific calculator entitlement is missing', async () => {
    const calculator = createCalculator();
    installDesmos(calculator, false);
    render(<DesmosCalculator mode="scientific" onStateChange={vi.fn()} />);
    expect(await screen.findByText('Calculator unavailable')).toBeInTheDocument();
    expect(screen.getByText(/not enabled for this Desmos API key/i)).toBeInTheDocument();
  });
});
