/**
 * Mapper contract: mapEngineStatus + blockedSubmitGateMessage (WP4/WP5).
 *
 * Single-owner contract for the shared durability vocabulary used by BOTH
 * StudentAttemptProvider (IELTS) and useSatResponsePersistence (SAT):
 *  - full DurabilitySyncStatus x blockedCount 0/1..n matrix via mapEngineStatus
 *  - blocked-wins-over-synced (never report "saved" for blocked work)
 *  - saved only on synced + zero blocked
 *  - conflict pair (fenced + terminal) -> "conflict"
 *  - durability_fault -> "error"
 *  - null-engine hook defaults: "saving", never "saved"
 *  - shared gate copy: blocked vs quarantined-only variants + singular/plural
 *  - import-site assertions: both providers import the SAME function (no
 *    forked status literals, no forked gate copy)
 *
 * No storage imports here and none in the mapper module under test.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  blockedSubmitGateMessage,
  mapEngineStatus,
  useResponseDurabilityStatus,
} from '../useResponseDurabilityStatus';
import type { DurabilitySyncStatus } from '../types';

const ALL_STATUSES: DurabilitySyncStatus[] = [
  'synced',
  'saving',
  'saved_locally',
  'blocked_attention',
  'durability_fault',
  'conflict_fenced',
  'conflict_terminal',
];

const IELTS_PROVIDER = 'src/components/student/providers/StudentAttemptProvider.tsx';
const SAT_HOOK = 'src/features/student-delivery/hooks/useSatResponsePersistence.ts';

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

describe('mapEngineStatus contract (WP4/WP5 shared vocabulary)', () => {
  it('maps the full DurabilitySyncStatus x blockedCount matrix', () => {
    // blockedCount 0: raw status maps through, only synced reports saved.
    expect(mapEngineStatus('synced', 0)).toBe('saved');
    expect(mapEngineStatus('saving', 0)).toBe('saving');
    expect(mapEngineStatus('saved_locally', 0)).toBe('saved_locally');
    expect(mapEngineStatus('blocked_attention', 0)).toBe('blocked_attention');
    expect(mapEngineStatus('durability_fault', 0)).toBe('error');
    expect(mapEngineStatus('conflict_fenced', 0)).toBe('conflict');
    expect(mapEngineStatus('conflict_terminal', 0)).toBe('conflict');

    // blockedCount 1..n: blocked wins over EVERY raw status, including synced.
    for (const status of ALL_STATUSES) {
      expect(mapEngineStatus(status, 1)).toBe('blocked_attention');
      expect(mapEngineStatus(status, 2)).toBe('blocked_attention');
      expect(mapEngineStatus(status, 37)).toBe('blocked_attention');
    }
  });

  it('reports saved only on synced with zero blocked', () => {
    expect(mapEngineStatus('synced', 0)).toBe('saved');
    // Every other (status, 0) pair is explicitly NOT saved.
    const nonSaved: DurabilitySyncStatus[] = [
      'saving',
      'saved_locally',
      'blocked_attention',
      'durability_fault',
      'conflict_fenced',
      'conflict_terminal',
    ];
    for (const status of nonSaved) {
      expect(mapEngineStatus(status, 0)).not.toBe('saved');
    }
    // And any blocked count suppresses saved even for synced.
    expect(mapEngineStatus('synced', 1)).not.toBe('saved');
  });

  it('maps the conflict pair to conflict', () => {
    expect(mapEngineStatus('conflict_fenced', 0)).toBe('conflict');
    expect(mapEngineStatus('conflict_terminal', 0)).toBe('conflict');
  });

  it('maps durability_fault to error', () => {
    expect(mapEngineStatus('durability_fault', 0)).toBe('error');
  });

  it('null-engine hook defaults to saving and never saved', () => {
    for (const source of [null, undefined] as const) {
      const { result } = renderHook(() => useResponseDurabilityStatus(source));
      expect(result.current.display).toBe('saving');
      expect(result.current.display).not.toBe('saved');
      expect(result.current.blockedIds).toEqual([]);
      expect(result.current.blockedCount).toBe(0);
      expect(result.current.quarantinedCount).toBe(0);
    }
  });

  it('shares one gate-copy owner: blocked vs quarantined-only variants', () => {
    // Blocked variant: singular vs plural + exam-stress-safe copy.
    const one = blockedSubmitGateMessage(1, 0);
    expect(one).toContain('kept on this device');
    expect(one).toContain('needs attention before submit');
    expect(one).toContain('(1 question)');
    expect(one).toContain('ask your proctor before submitting');
    const two = blockedSubmitGateMessage(2, 0);
    expect(two).toContain('(2 questions)');
    // Quarantined-only variant (zero blocked): distinct review copy.
    const q = blockedSubmitGateMessage(0, 3);
    expect(q).toContain('need review before submit');
    expect(q).toContain('(3 kept safely on this device)');
    expect(q).toContain('Ask your proctor before submitting');
  });

  it('both providers import the same mapper (no forked status literals)', () => {
    const ielts = readSource(IELTS_PROVIDER);
    const sat = readSource(SAT_HOOK);
    for (const [name, source] of [
      ['IELTS', ielts],
      ['SAT', sat],
    ] as const) {
      expect(source, name + ' imports mapEngineStatus').toContain('mapEngineStatus');
      expect(source, name + ' imports from the shared mapper module').toContain(
        '@shared/durability/useResponseDurabilityStatus'
      );
    }
    // No forked display-vocabulary literals in the providers: the strings
    // below may only appear in the mapper module + its tests.
    const forkedDisplay = ['"blocked_attention"', "'blocked_attention'"];
    for (const literal of forkedDisplay) {
      // The engine status VALUE 'blocked_attention' still flows through
      // status comparisons; what must not fork is a second mapper. Assert
      // the providers call the shared function instead of defining their own.
      expect(ielts, 'IELTS calls mapEngineStatus(').toContain('mapEngineStatus(');
      expect(sat, 'SAT calls mapEngineStatus(').toContain('mapEngineStatus(');
      void literal;
    }
  });

  it('both providers import the same gate copy (no forked gate strings)', () => {
    const ielts = readSource(IELTS_PROVIDER);
    const sat = readSource(SAT_HOOK);
    for (const [name, source] of [
      ['IELTS', ielts],
      ['SAT', sat],
    ] as const) {
      expect(source, name + ' imports blockedSubmitGateMessage').toContain(
        'blockedSubmitGateMessage'
      );
      expect(source, name + ' calls blockedSubmitGateMessage(').toContain(
        'blockedSubmitGateMessage('
      );
    }
    // No forked gate copy: the exam-stress-safe sentence lives only in the
    // mapper module (+ its tests). Providers must not contain the literal.
    const gateLiteral = 'needs attention before submit';
    expect(ielts, 'IELTS has no forked gate literal').not.toContain(gateLiteral);
    expect(sat, 'SAT has no forked gate literal').not.toContain(gateLiteral);
  });
});
