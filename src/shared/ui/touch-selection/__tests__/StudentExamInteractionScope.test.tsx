import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  StudentExamInteractionScopeProvider,
  useStudentExamInteractionScope,
} from '../StudentExamInteractionScope';

function Probe() {
  const scope = useStudentExamInteractionScope();
  return <span data-testid="owned">{String(scope.ownedTouchSelection)}</span>;
}

describe('student exam interaction scope', () => {
  it('declares an owned selection gesture only where a session says so', () => {
    render(
      <StudentExamInteractionScopeProvider ownedTouchSelection>
        <Probe />
      </StudentExamInteractionScopeProvider>,
    );

    expect(screen.getByTestId('owned')).toHaveTextContent('true');
  });

  it('answers conservatively outside any provider, which is every authoring surface', () => {
    render(<Probe />);

    // Not an error: the platform's own selection is what a preview and an
    // authoring surface must keep, so the default has to be safe without any
    // caller having to state it.
    expect(screen.getByTestId('owned')).toHaveTextContent('false');
  });

  it('allows a session to declare the opposite explicitly', () => {
    render(
      <StudentExamInteractionScopeProvider ownedTouchSelection={false}>
        <Probe />
      </StudentExamInteractionScopeProvider>,
    );

    expect(screen.getByTestId('owned')).toHaveTextContent('false');
  });
});
