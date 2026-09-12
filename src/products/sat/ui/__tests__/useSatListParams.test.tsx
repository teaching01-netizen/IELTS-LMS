import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useSatListParams, type SatListParams } from '../useSatListParams';

let latest: { params: SatListParams; setParams: (patch: SatListParams) => void } | null = null;

function Probe() {
  const value = useSatListParams();
  latest = value;
  return <p data-testid="sat-list-params">{JSON.stringify(value.params)}</p>;
}

function renderProbe(initialEntries: string[]) {
  latest = null;
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Probe />
    </MemoryRouter>,
  );
}

describe('useSatListParams', () => {
  it('parses valid keys with validation', () => {
    renderProbe(['/?bucket=live&q=mock&score=available&student=W1&tab=archived']);
    expect(screen.getByTestId('sat-list-params')).toHaveTextContent('"bucket":"live"');
    expect(screen.getByTestId('sat-list-params')).toHaveTextContent('"q":"mock"');
    expect(screen.getByTestId('sat-list-params')).toHaveTextContent('"score":"available"');
    expect(screen.getByTestId('sat-list-params')).toHaveTextContent('"student":"W1"');
    expect(screen.getByTestId('sat-list-params')).toHaveTextContent('"tab":"archived"');
  });

  it('falls back per-key on invalid values, never throwing', () => {
    renderProbe(['/?bucket=bogus&score=nope&tab=wrong&q=keep']);
    const text = screen.getByTestId('sat-list-params').textContent ?? '';
    expect(text).not.toContain('bogus');
    expect(text).not.toContain('nope');
    expect(text).not.toContain('wrong');
    expect(text).toContain('"q":"keep"');
    expect(latest?.params.bucket).toBeUndefined();
    expect(latest?.params.score).toBeUndefined();
    expect(latest?.params.tab).toBeUndefined();
  });

  it('defaults to an empty params object with no query string', () => {
    renderProbe(['/']);
    expect(latest?.params).toEqual({});
  });

  it('setParams merges a partial patch over current params', () => {
    renderProbe(['/?bucket=upcoming&q=mock']);
    act(() => {
      latest?.setParams({ score: 'available' });
    });
    expect(latest?.params).toMatchObject({ bucket: 'upcoming', q: 'mock', score: 'available' });
  });

  it('setParams clears a key on empty-string patch', () => {
    renderProbe(['/?q=mock&bucket=live']);
    act(() => {
      latest?.setParams({ q: '' });
    });
    expect(latest?.params.q).toBeUndefined();
    expect(latest?.params.bucket).toBe('live');
  });
});
