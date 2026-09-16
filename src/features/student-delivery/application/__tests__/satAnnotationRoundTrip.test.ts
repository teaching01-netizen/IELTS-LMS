import { describe, expect, it } from 'vitest';
import { durablePayloadToSatDraft, satDraftToDurablePayload } from '../../hooks/useSatResponsePersistence';
import { createSatTextAnnotation, emptySatQuestionResponse, removeSatAnnotationById } from '../../domain/satResponses';

describe('SAT annotation recovery', () => {
  it('preserves anchored notes and legacy notes through the response wire format', () => {
    const draft = emptySatQuestionResponse('question-1');
    draft.annotations.legacyQuestionNote = 'Earlier general note';
    draft.annotations.annotations.push(createSatTextAnnotation({
      id: 'annotation-1', kind: 'highlight', nodeId: 'stimulus:paragraph-1',
      startOffset: 4, endOffset: 12, exact: 'evidence', prefix: 'The ',
      suffix: ' shows', note: 'Compare the claim', now: '2026-09-06T00:00:00Z',
    }));
    const wire = JSON.parse(JSON.stringify(satDraftToDurablePayload(draft)));
    expect(durablePayloadToSatDraft(draft.questionId, wire)).toEqual(draft);
  });
  it('round-trips Bluebook paper-highlighted marks without touching the wire format', () => {
    const draft = emptySatQuestionResponse('question-1');
    draft.annotations.annotations.push(createSatTextAnnotation({
      id: 'annotation-paper', kind: 'highlight', nodeId: 'stimulus:paragraph-1',
      startOffset: 4, endOffset: 12, exact: 'evidence', prefix: 'The ',
      suffix: ' shows', note: 'Compare the claim', now: '2026-09-06T00:00:00Z',
    }));
    // Phase 7 changes presentation tokens only: the durable payload (and the
    // annotation ids/kinds/anchors it carries) must be byte-identical.
    const wire = JSON.parse(JSON.stringify(satDraftToDurablePayload(draft)));
    expect(durablePayloadToSatDraft(draft.questionId, wire)).toEqual(draft);
  });
  it('keeps the wire format stable after a mark is removed', () => {
    const draft = emptySatQuestionResponse('question-1');
    const first = createSatTextAnnotation({
      id: 'annotation-1', kind: 'highlight', nodeId: 'stimulus:paragraph-1',
      startOffset: 4, endOffset: 12, exact: 'evidence', prefix: 'The ',
      suffix: ' shows', now: '2026-09-06T00:00:00Z',
    });
    const second = createSatTextAnnotation({
      id: 'annotation-2', kind: 'underline', nodeId: 'stimulus:paragraph-1',
      startOffset: 20, endOffset: 26, exact: 'claims', now: '2026-09-06T00:00:00Z',
    });
    draft.annotations.annotations.push(first, second);
    const erased = removeSatAnnotationById(draft.annotations, first.id);
    expect(erased.annotations.map((a) => a.id)).toEqual(['annotation-2']);
    const wire = JSON.parse(JSON.stringify(satDraftToDurablePayload({ ...draft, annotations: erased })));
    expect(durablePayloadToSatDraft(draft.questionId, wire).annotations).toEqual(erased);
  });
});
