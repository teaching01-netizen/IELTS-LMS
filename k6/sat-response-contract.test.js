import { describe, expect, it } from 'vitest';
import { satAttemptUrl, satBatchRequest, assertSatAcknowledgements, assertSatStoredResponses } from './sat-response-contract.js';

const command = { writeId: 'write-1', questionId: 'slot-1', clientVersion: 2,
  response: { answer: 'B', markedForReview: true, eliminatedOptions: ['A'], annotations: [] } };
const ack = { ...command, outcome: 'applied', serverRevision: 8, contentHash: 'server-hash', canonicalResponse: command.response };
const snapshot = { leaseEpoch: 3, controlEpoch: 7, responses: [ack] };

describe('SAT rehearsal persistence contract', () => {
  it('uses the current student V2 route and captured epochs without changing write identity', () => {
    expect(satAttemptUrl('http://localhost:4000/', 'attempt-1', 'responses:batch')).toBe('http://localhost:4000/api/v2/student/attempts/attempt-1/responses:batch');
    expect(satBatchRequest(snapshot, [command])).toEqual({ leaseEpoch: 3, controlEpoch: 7, commands: [command] });
    expect(() => satBatchRequest({ ...snapshot, controlEpoch: undefined }, [command])).toThrow('authoritative V2 snapshot');
  });

  it('accepts an exact commit and duplicate replay, but refuses missing or superseded acknowledgements', () => {
    expect(assertSatAcknowledgements({ acknowledgements: [ack] }, [command])).toEqual([ack]);
    expect(() => assertSatAcknowledgements({ acknowledgements: [{ ...ack, outcome: 'duplicate' }] }, [command])).not.toThrow();
    for (const acknowledgements of [[], [{ ...ack, outcome: 'superseded' }], [{ ...ack, clientVersion: 1 }], [{ ...ack, questionId: 'different-slot' }]]) {
      expect(() => assertSatAcknowledgements({ acknowledgements }, [command])).toThrow();
    }
  });

  it('refuses a 200 response that acknowledges different answer content or repeats one identity', () => {
    expect(() => assertSatAcknowledgements({ acknowledgements: [{ ...ack, canonicalResponse: { ...command.response, answer: 'C' } }] }, [command])).toThrow('exact intended answer');
    expect(() => assertSatAcknowledgements({ acknowledgements: [ack, ack] }, [command, { ...command, writeId: 'write-2' }])).toThrow('duplicate acknowledgement identities');
  });

  it('checks the persisted exact final answer after replaying an older write', () => {
    expect(() => assertSatStoredResponses(snapshot, [command])).not.toThrow();
    for (const response of [{ ...ack, writeId: 'old-write' }, { ...ack, clientVersion: 3 }, { ...ack, canonicalResponse: { ...command.response, answer: 'A' } }]) {
      expect(() => assertSatStoredResponses({ ...snapshot, responses: [response] }, [command])).toThrow('lost or changed');
    }
  });
});
