import { describe, expect, it } from 'vitest';
import { durablePayloadToSatDraft, satDraftToDurablePayload } from '../../hooks/useSatResponsePersistence';
import { createSatTextAnnotation, emptySatQuestionResponse, removeSatAnnotationsInRange } from '../../domain/satResponses';

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
  it('keeps the wire format stable after an eraser removal', () => {
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
    const erased = removeSatAnnotationsInRange(draft.annotations, 'stimulus:paragraph-1', 0, 15);
    expect(erased.annotations.map((a) => a.id)).toEqual(['annotation-2']);
    const wire = JSON.parse(JSON.stringify(satDraftToDurablePayload({ ...draft, annotations: erased })));
    expect(durablePayloadToSatDraft(draft.questionId, wire).annotations).toEqual(erased);
  });
});
