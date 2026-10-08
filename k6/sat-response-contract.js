// Shared by SAT rehearsals: HTTP success alone is not an answer-save proof.
export function satAttemptUrl(baseUrl, attemptId, suffix) {
  return `${baseUrl.replace(/\/$/, '')}/api/v2/student/attempts/${encodeURIComponent(attemptId)}/${suffix}`;
}

export function satBatchRequest(snapshot, commands) {
  if (!Number.isSafeInteger(snapshot?.leaseEpoch) || snapshot.leaseEpoch < 1 ||
      !Number.isSafeInteger(snapshot?.controlEpoch) || snapshot.controlEpoch < 0 ||
      !Array.isArray(snapshot.responses)) {
    throw new Error('SAT rehearsal requires an authoritative V2 snapshot with writer epochs.');
  }
  return { leaseEpoch: snapshot.leaseEpoch, controlEpoch: snapshot.controlEpoch, commands };
}

function sameResponse(actual, expected) {
  return JSON.stringify(actual?.answer) === JSON.stringify(expected.answer) &&
    Boolean(actual?.markedForReview) === Boolean(expected.markedForReview) &&
    JSON.stringify(actual?.eliminatedOptions ?? []) === JSON.stringify(expected.eliminatedOptions ?? []) &&
    JSON.stringify(actual?.annotations ?? []) === JSON.stringify(expected.annotations ?? []);
}

export function assertSatAcknowledgements(body, commands) {
  const acks = body?.acknowledgements;
  if (!Array.isArray(acks) || acks.length !== commands.length) {
    throw new Error('SAT save did not acknowledge every commanded write.');
  }
  const byWrite = new Map(acks.map((ack) => [ack.writeId, ack]));
  if (byWrite.size !== commands.length) throw new Error('SAT save returned duplicate acknowledgement identities.');
  for (const command of commands) {
    const ack = byWrite.get(command.writeId);
    if (!ack || ack.questionId !== command.questionId || ack.clientVersion !== command.clientVersion ||
        !['applied', 'duplicate'].includes(ack.outcome) || !Number.isSafeInteger(ack.serverRevision) ||
        ack.serverRevision < 1 || !ack.contentHash || !sameResponse(ack.canonicalResponse, command.response)) {
      throw new Error('SAT save acknowledgement did not confirm the exact intended answer.');
    }
  }
  return acks;
}

export function assertSatStoredResponses(snapshot, commands) {
  satBatchRequest(snapshot, []);
  const byQuestion = new Map(snapshot.responses.map((response) => [response.questionId, response]));
  for (const command of commands) {
    const stored = byQuestion.get(command.questionId);
    if (!stored || stored.writeId !== command.writeId || stored.clientVersion !== command.clientVersion ||
        !sameResponse(stored.canonicalResponse, command.response)) {
      throw new Error('SAT snapshot lost or changed an acknowledged final answer.');
    }
  }
}
