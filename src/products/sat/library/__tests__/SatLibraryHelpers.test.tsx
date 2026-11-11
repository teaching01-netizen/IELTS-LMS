import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ancestorsOf, childrenOf, descendantIds, entryMap, folderIdOf } from '../types';

describe('library helpers', () => {
  const folders = [
    { id: 'root-a', scopeKey: 'sat|org', providerKey: 'sat', name: 'Alpha', revision: 0, createdBy: 'u', createdAt: '', updatedAt: '' },
    { id: 'child-a', scopeKey: 'sat|org', providerKey: 'sat', parentId: 'root-a', name: 'Beta', revision: 0, createdBy: 'u', createdAt: '', updatedAt: '' },
    { id: 'root-b', scopeKey: 'sat|org', providerKey: 'sat', name: 'gamma', revision: 0, createdBy: 'u', createdAt: '', updatedAt: '' },
  ];
  it('lists direct children sorted case-insensitively', () => {
    expect(childrenOf(folders, null).map((f) => f.id)).toEqual(['root-a', 'root-b']);
    expect(childrenOf(folders, 'root-a').map((f) => f.id)).toEqual(['child-a']);
  });
  it('builds ancestor chains root-first', () => {
    expect(ancestorsOf(folders, 'child-a').map((f) => f.id)).toEqual(['root-a', 'child-a']);
  });
  it('collects descendants without the mover itself', () => {
    const desc = descendantIds(folders, 'root-a');
    expect(desc.has('child-a')).toBe(true);
    expect(desc.has('root-a')).toBe(false);
  });
  it('maps entries and treats missing rows as Library root', () => {
    const byExam = entryMap([{ examId: 'e1', folderId: 'root-a', revision: 2 }]);
    expect(folderIdOf(byExam, 'e1')).toBe('root-a');
    expect(folderIdOf(byExam, 'missing')).toBeNull();
  });
});

describe('useSatListParams folder contract', () => {
  it('parses folder ids and the all smart view', async () => {
    const { useSatListParams } = await import('../../ui/useSatListParams');
    let latest: { params: { folder?: string }; setParams: (patch: Record<string, string>, options?: { replace?: boolean }) => void } | null = null;
    function Probe() {
      const value = useSatListParams();
      latest = value as unknown as typeof latest;
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/?folder=all']}>
        <Probe />
      </MemoryRouter>,
    );
    expect(latest?.params.folder).toBe('all');
    act(() => {
      latest?.setParams({ folder: '' });
    });
    expect(latest?.params.folder).toBeUndefined();
  });
});
