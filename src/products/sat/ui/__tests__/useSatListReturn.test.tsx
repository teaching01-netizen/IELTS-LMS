import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { satListReturnTarget, useSatListReturn } from '../useSatListReturn';

function List() {
  const { lastOpenedId, openRecord } = useSatListReturn(true);
  return (
    <>
      <p>Last opened: {lastOpenedId ?? 'none'}</p>
      <button type="button" data-sat-row-id="exam-2" onClick={() => openRecord('exam-2', '/sat/exams/exam-2')}>Practice 2</button>
    </>
  );
}

function Detail() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => { const back = satListReturnTarget('/sat/exams'); navigate(back.to, back.state ? { state: back.state } : undefined); }}>
      Exam Library
    </button>
  );
}

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

describe('useSatListReturn', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('falls back to the bare list when nothing was opened', () => {
    expect(satListReturnTarget('/sat/exams')).toEqual({ to: '/sat/exams' });
  });

  it('returns from a record to the same filtered list, with the opened row marked and focused', () => {
    render(
      <MemoryRouter initialEntries={['/sat/exams?q=Practice&tab=archived']}>
        <Where />
        <Routes>
          <Route path="/sat/exams" element={<List />} />
          <Route path="/sat/exams/:examId" element={<Detail />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Practice 2' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/sat/exams/exam-2');
    fireEvent.click(screen.getByRole('button', { name: 'Exam Library' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/sat/exams?q=Practice&tab=archived');
    expect(screen.getByText('Last opened: exam-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice 2' })).toHaveFocus();
  });
});
