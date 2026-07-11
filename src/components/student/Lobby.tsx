import React from 'react';
import type { ExamState } from '../../types';
import { Button } from '../ui/Button';
import { ExamEntryCard } from './ExamEntryCard';

interface LobbyProps {
  state: ExamState;
  candidateName?: string | null | undefined;
  candidateId?: string | null | undefined;
  onPreviewStart?: (() => void) | undefined;
}

export function Lobby({ state, candidateName, candidateId, onPreviewStart }: LobbyProps) {
  return <ExamEntryCard config={state.config} examTitle={state.title} candidateName={candidateName} candidateId={candidateId} footer={onPreviewStart ? <Button variant="primary" onClick={onPreviewStart}>Start Exam</Button> : undefined} />;
}
