import { describe, expect, it } from 'vitest';
import { canTransition } from '../policies/examStatusTransitions';

describe('exam status transition policy', () => {
  it('allows known happy-path transitions', () => {
    expect(canTransition('draft', 'draft', null)).toBe(true);
    expect(canTransition('draft', 'in_review', 'owner')).toBe(true);
    expect(canTransition('approved', 'published', 'admin')).toBe(true);
    expect(canTransition('archived', 'draft', 'admin')).toBe(true);
  });

  it('rejects transitions outside the policy table', () => {
    expect(canTransition('in_review', 'published', 'admin')).toBe(false);
    expect(canTransition('approved', 'archived', 'admin')).toBe(false);
    expect(canTransition('published', 'approved', 'admin')).toBe(false);
  });

  it('fails closed when a transition requires an actor role but none is provided', () => {
    expect(canTransition('draft', 'in_review', null)).toBe(false);
    expect(canTransition('approved', 'published', null)).toBe(false);
  });

  it('rejects transitions when actor role does not satisfy policy requirement', () => {
    expect(canTransition('draft', 'in_review', 'reviewer')).toBe(false);
    expect(canTransition('approved', 'published', 'owner')).toBe(false);
  });

  it('lets the system role satisfy any gated transition (background jobs)', () => {
    expect(canTransition('draft', 'in_review', 'system')).toBe(true);
    expect(canTransition('approved', 'published', 'system')).toBe(true);
    expect(canTransition('published', 'archived', 'system')).toBe(true);
  });

  it('rejects unknown pairs even for the system role', () => {
    expect(canTransition('draft', 'published', 'system')).toBe(false);
    expect(canTransition('archived', 'published', 'system')).toBe(false);
  });
});
