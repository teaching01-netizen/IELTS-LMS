import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PassageListSidebar } from '../PassageListSidebar';

describe('PassageListSidebar', () => {
  it('counts blank passage content as zero words', () => {
    render(
      <PassageListSidebar
        passages={[
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: '   ',
            blocks: [],
          } as any,
        ]}
        activePassageId="passage-1"
        onPassageSelect={() => {}}
        onPassageAdd={() => {}}
        onPassageDelete={() => {}}
        onPassageReorder={() => {}}
        onPassageEdit={() => {}}
      />,
    );

    expect(screen.getByText('0 words')).toBeInTheDocument();
  });
});
