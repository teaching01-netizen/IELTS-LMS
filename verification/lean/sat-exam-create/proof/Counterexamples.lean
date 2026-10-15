import Safety

namespace SatExamCreate

def samplePayload : Payload :=
  { slug := 11
    title := 22
    classroomPlan := some .m2Hard
    planAccepted := true
    converter := some 33
    converterAccepted := true
    showClassroomScoreReport := true }

def legacyRequest : Request :=
  { actor := 1, operationKey := none, payload := samplePayload }

def keyedRequest : Request :=
  { actor := 1, operationKey := some 7, payload := samplePayload }

/-- Old create clients without an operation key can commit the same request
twice after the first commit's response is lost. -/
theorem old_client_lost_ack_can_duplicate :
    ∃ s1 s2,
      Step emptyState (.submit legacyRequest) s1 ∧
      Step s1 (.ackLost 0) s1 ∧
      Step s1 (.submit legacyRequest) s2 ∧
      (∃ b0 b1,
        s2.bundles 0 = some b0 ∧ s2.bundles 1 = some b1 ∧
        b0.payload = samplePayload ∧ b1.payload = samplePayload) := by
  let s1 := commitState emptyState legacyRequest
  let s2 := commitState s1 legacyRequest
  refine ⟨s1, s2, ?_, ?_, ?_, ?_⟩
  · apply Step.create
    · simp [Payload.valid, legacyRequest, samplePayload]
    · simp [keyAvailable, legacyRequest]
  · apply Step.ackLost s1 0 (makeBundle legacyRequest 0)
    simp [s1, commitState, putBundle, emptyState, legacyRequest]
  · apply Step.create
    · simp [Payload.valid, legacyRequest, samplePayload]
    · simp [keyAvailable, legacyRequest]
  · refine ⟨makeBundle legacyRequest 0, makeBundle legacyRequest 1, ?_, ?_, ?_, ?_⟩
    · simp [s1, s2, commitState, putBundle, emptyState, legacyRequest]
    · simp [s1, s2, commitState, putBundle, emptyState, legacyRequest]
    · rfl
    · rfl

/-- With a retained actor-scoped key, an ACK loss is followed by a replay
stutter that returns the original durable result ID. -/
theorem keyed_lost_ack_then_retry_replays :
    ∃ s1 entry,
      Step emptyState (.submit keyedRequest) s1 ∧
      Step s1 (.ackLost 0) s1 ∧
      Step s1 (.submit keyedRequest) s1 ∧
      s1.nextExamId = 1 ∧
      s1.ledger (1, 7) = some entry ∧ entry.resultId = 0 ∧ entry.fingerprint = samplePayload := by
  let s1 := commitState emptyState keyedRequest
  let entry : LedgerEntry := { fingerprint := samplePayload, resultId := 0 }
  refine ⟨s1, entry, ?_, ?_, ?_, ?_, ?_, rfl, rfl⟩
  · apply Step.create
    · simp [Payload.valid, keyedRequest, samplePayload]
    · simp [keyAvailable, keyedRequest, emptyState]
  · apply Step.ackLost s1 0 (makeBundle keyedRequest 0)
    simp [s1, commitState, putBundle, emptyState, keyedRequest]
  · apply Step.replay s1 keyedRequest 7 entry
    · simp [Payload.valid, keyedRequest, samplePayload]
    · rfl
    · simp [s1, entry, commitState, putLedger, emptyState, keyedRequest]
    · rfl
  · simp [s1, commitState, emptyState, keyedRequest]
  · simp [s1, entry, commitState, putLedger, emptyState, keyedRequest]

/-- The database's seven-day key cleanup is an explicit boundary: after the
receipt expires, a late retry can be a new create. -/
theorem expired_key_allows_late_duplicate :
    ∃ s1 s2,
      Step emptyState (.submit keyedRequest) s1 ∧
      Step s1 (.expireKey (1, 7)) s2 ∧
      Step s2 (.submit keyedRequest) (commitState s2 keyedRequest) ∧
      (∃ b0 b1,
        (commitState s2 keyedRequest).bundles 0 = some b0 ∧
        (commitState s2 keyedRequest).bundles 1 = some b1 ∧
        b0.payload = samplePayload ∧ b1.payload = samplePayload) := by
  let s1 := commitState emptyState keyedRequest
  let s2 := clearOperation s1 (1, 7)
  let entry : LedgerEntry := { fingerprint := samplePayload, resultId := 0 }
  refine ⟨s1, s2, ?_, ?_, ?_, ?_⟩
  · apply Step.create
    · simp [Payload.valid, keyedRequest, samplePayload]
    · simp [keyAvailable, keyedRequest, emptyState]
  · apply Step.expireKey s1 (1, 7) entry
    simp [s1, entry, commitState, putLedger, emptyState, keyedRequest]
  · apply Step.create
    · simp [Payload.valid, keyedRequest, samplePayload]
    · simp [keyAvailable, s2, clearOperation, clearLedger, s1, commitState, putLedger, emptyState, keyedRequest]
  · refine ⟨makeBundle keyedRequest 0, makeBundle keyedRequest 1, ?_, ?_, rfl, rfl⟩
    · simp [s2, clearOperation, clearLedger, s1, commitState, putBundle, emptyState, keyedRequest]
    · simp [s2, clearOperation, clearLedger, s1, commitState, putBundle, emptyState, keyedRequest]

end SatExamCreate
