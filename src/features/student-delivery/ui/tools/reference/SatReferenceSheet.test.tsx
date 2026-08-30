import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SatReferenceSheet } from './SatReferenceSheet';

describe('SatReferenceSheet', () => {
  it('exposes geometry diagrams instead of hiding their authored accessibility labels', () => {
    render(<SatReferenceSheet />);
    expect(screen.getByRole('article', { name: 'SAT Math reference sheet' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Circle with radius r' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /30 60 90 triangle/i })).toBeInTheDocument();
  });
});
