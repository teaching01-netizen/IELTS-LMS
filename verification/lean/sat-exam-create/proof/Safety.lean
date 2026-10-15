import Model

namespace SatExamCreate

theorem initiate (s : State) (h : Init s) : Invariant s := h

theorem commit_preserves {s : State} {r : Request}
    (hinv : Invariant s) (hvalid : r.payload.valid) (havailable : keyAvailable s r) :
    Invariant (commitState s r) := by
  rcases hinv with ⟨hbundles, hledger, hcursor⟩
  refine ⟨?_, ?_, ?_⟩
  · intro id b hlookup
    rw [commitState_bundle_lookup] at hlookup
    by_cases hid : id = s.nextExamId
    · simp [hid] at hlookup
      have hb : b = makeBundle r s.nextExamId := hlookup.symm
      subst b
      have : bundleWellFormed s.nextExamId (makeBundle r s.nextExamId) := makeBundle_wellFormed hvalid
      simpa [hid] using this
    · simp [hid] at hlookup
      exact hbundles id b hlookup
  · intro op entry hlookup
    rw [commitState_ledger_lookup] at hlookup
    cases hkey : r.operationKey with
    | none =>
      simp [hkey] at hlookup
      obtain ⟨b, hb, howner, hpayload⟩ := hledger op entry hlookup
      have hnot : entry.resultId ≠ s.nextExamId := by
        have hlt := hcursor entry.resultId b hb
        exact Nat.ne_of_lt hlt
      refine ⟨b, ?_, howner, hpayload⟩
      rw [commitState_bundle_lookup]
      simp [hnot, hb]
    | some key =>
      by_cases hop : op = (r.actor, key)
      · subst op
        have habsent : s.ledger (r.actor, key) = none := by
          simpa [keyAvailable, hkey] using havailable
        simp [hkey, habsent] at hlookup
        have heq : entry = { fingerprint := r.payload, resultId := s.nextExamId } := hlookup.symm
        subst entry
        refine ⟨makeBundle r s.nextExamId, ?_, rfl, rfl⟩
        rw [commitState_bundle_lookup]
        simp
      · have hold : s.ledger op = some entry := by
          simpa [hkey, hop] using hlookup
        obtain ⟨b, hb, howner, hpayload⟩ := hledger op entry hold
        have hnot : entry.resultId ≠ s.nextExamId := by
          exact Nat.ne_of_lt (hcursor entry.resultId b hb)
        refine ⟨b, ?_, howner, hpayload⟩
        rw [commitState_bundle_lookup]
        simp [hnot, hb]
  · intro id b hlookup
    rw [commitState_bundle_lookup] at hlookup
    by_cases hid : id = s.nextExamId
    · subst id
      rw [commitState_next]
      exact Nat.lt_succ_self s.nextExamId
    · simp [hid] at hlookup
      have hlt := hcursor id b hlookup
      rw [commitState_next]
      simpa using Nat.lt_trans hlt (Nat.lt_succ_self s.nextExamId)

theorem clearOperation_preserves {s : State} {op : Operation}
    (hinv : Invariant s) : Invariant (clearOperation s op) := by
  rcases hinv with ⟨hbundles, hledger, hcursor⟩
  refine ⟨?_, ?_, ?_⟩
  · intro id b hlookup
    exact hbundles id b hlookup
  · intro current entry hlookup
    change clearLedger s.ledger op current = some entry at hlookup
    by_cases heq : current = op
    · simp [clearLedger, heq] at hlookup
    · have hold : s.ledger current = some entry := by
        simpa [clearLedger, heq] using hlookup
      exact hledger current entry hold
  · intro id b hlookup
    exact hcursor id b hlookup

theorem step_preserves {s s' : State} {a : Action}
    (hinv : Invariant s) (hstep : Step s a s') : Invariant s' := by
  cases hstep with
  | create r hvalid havailable => exact commit_preserves hinv hvalid havailable
  | replay => exact hinv
  | keyConflict => exact hinv
  | invalid => exact hinv
  | abort => exact hinv
  | ackLost => exact hinv
  | ackDelivered => exact hinv
  | expireKey => exact clearOperation_preserves hinv

theorem reachable_invariant {s : State} (h : Reachable s) : Invariant s := by
  induction h with
  | init s hinit => exact initiate s hinit
  | step s s' a hreach hstep ih => exact step_preserves ih hstep

/-- A valid keyed retry with the same actor and payload does not commit a
second bundle; the existing durable receipt is the returned exam identity. -/
theorem same_key_retry_replays {s : State} {r : Request} {key : OperationKey}
    {entry : LedgerEntry} (hvalid : r.payload.valid)
    (hkey : r.operationKey = some key)
    (hentry : s.ledger (r.actor, key) = some entry)
    (hsame : entry.fingerprint = r.payload) :
    Step s (.submit r) s :=
  Step.replay s r key entry hvalid hkey hentry hsame

theorem mismatched_key_payload_conflicts {s : State} {r : Request} {key : OperationKey}
    {entry : LedgerEntry} (hvalid : r.payload.valid)
    (hkey : r.operationKey = some key)
    (hentry : s.ledger (r.actor, key) = some entry)
    (hdifferent : entry.fingerprint ≠ r.payload) :
    Step s (.submit r) s :=
  Step.keyConflict s r key entry hvalid hkey hentry hdifferent

theorem abort_is_stutter (s : State) (r : Request) : Step s (.abort r) s :=
  Step.abort s r

theorem lost_ack_is_stutter {s : State} {id : ExamId} {b : ExamBundle}
    (h : s.bundles id = some b) : Step s (.ackLost id) s :=
  Step.ackLost s id b h

/-- Every persisted key receipt resolves to the complete exam bundle whose
payload and owner it records. -/
theorem receipt_points_to_complete_exam {s : State} (hinv : Invariant s)
    {op : Operation} {entry : LedgerEntry}
    (hentry : s.ledger op = some entry) :
    ∃ b, s.bundles entry.resultId = some b ∧ bundleWellFormed entry.resultId b ∧
      b.owner = op.1 ∧ b.payload = entry.fingerprint := by
  rcases hinv with ⟨hbundles, hledger, _⟩
  obtain ⟨b, hb, howner, hpayload⟩ := hledger op entry hentry
  exact ⟨b, hb, hbundles entry.resultId b hb, howner, hpayload⟩

theorem emptyState_invariant : Invariant emptyState := by
  refine ⟨?_, ?_, ?_⟩
  · intro id b h
    simp [emptyState] at h
  · intro op entry h
    simp [emptyState] at h
  · intro id b h
    simp [emptyState] at h

/-- Non-vacuity witness: a valid SAT create reaches a state containing its
entity, draft plan, score policy configuration, report flag, and create event. -/
theorem valid_create_is_reachable {r : Request} (hvalid : r.payload.valid) :
    Reachable (commitState emptyState r) := by
  apply Reachable.step emptyState (commitState emptyState r) (.submit r)
    (Reachable.init emptyState emptyState_invariant)
  apply Step.create
  · exact hvalid
  · cases hkey : r.operationKey <;> simp [keyAvailable, emptyState, hkey]

end SatExamCreate
