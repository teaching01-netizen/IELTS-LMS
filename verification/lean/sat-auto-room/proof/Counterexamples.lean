import proof.Safety

namespace SatAutoRoom

-- Policy mismatch: the code covers a Math-only room with a Full release.
theorem full_reuse_is_not_equal_scope : Covers .full .math ∧ Scope.full ≠ Scope.math := by
  exact ⟨Or.inl rfl, by decide⟩

-- A no-op authoring write still bumps revision. The implementation's
-- revision=0 reuse test cannot recognize semantically identical content.
def cleanReuse (revision parent current : Nat) : Bool :=
  revision == 0 && parent == current

theorem no_op_write_defeats_clone_reuse :
    cleanReuse 0 1 1 = true ∧ cleanReuse 1 1 1 = false := by decide

def unfenced : Request := ⟨(0, 0), 0, .full, none, none, none, true⟩
def newDraft : Draft := ⟨1, 7, 99, none⟩
def newState : State := initial 12 (some newDraft) none (fun _ => none)

theorem omitted_fences_accept_changed_revision :
    Fences newState unfenced ∧ newState.examRevision ≠ 11 ∧ newDraft.revision ≠ 6 := by
  simp [Fences, newState, newDraft, unfenced, initial]

-- Current replay uses a live link projection: identity is durable, response
-- fields can differ after a room rename, registration, or publication.
def liveReplay (storedId liveName : Nat) : Nat × Nat := (storedId, liveName)

theorem live_projection_not_exact_response : liveReplay 1 10 ≠ liveReplay 1 11 := by decide

-- Closing/reloading forgets a component-owned ref. A new key is a new
-- operation despite both requests representing the same human intent.
def clientRemount (_pendingKey : Option Nat) : Option Nat := none

theorem remount_loses_unresolved_identity : clientRemount (some 1) = none := rfl

-- Non-vacuity: a real successful seal is reachable, then crash before ACK,
-- retry with the same body, and ACK; the durable effect count remains one.
def ready : Validator := fun _ _ => True
def start : State := initial 0 (some ⟨1, 0, 42, none⟩) none (fun _ => none)
def req : Request := ⟨(0, 1), 5, .full, some 0, some (some 1), some 0, true⟩
def invoked : State := { start with pending := put start.pending 0 (some req) }
def inspected : State := { invoked with preflight := put invoked.preflight 0 invoked.draft }
def committed : State := commit inspected req 1 ⟨42, .full⟩ true
def crashed : State := { committed with
  pending := put committed.pending 0 none
  preflight := put committed.preflight 0 none
  ack := put committed.ack 0 none }
def retried : State := { crashed with pending := put crashed.pending 0 (some req) }
def acknowledged : State := { retried with ack := put retried.ack 0 (some (effect req 1 ⟨42, .full⟩)) }

theorem successful_seal_reachable : Reachable ready committed := by
  have h0 : Reachable ready start := .init _ ⟨0, _, none, _, rfl⟩
  have h1 : Reachable ready invoked := .next h0 (.invoke start 0 req rfl)
  have h2 : Reachable ready inspected := .next h1 (.inspect invoked 0)
  apply Reachable.next h2
  apply Step.complete inspected 0 req 1 ⟨42, .full⟩ true
  · simp [inspected, invoked, req, put]
  · rfl
  · simp [RequiredFences, req]
  · simp [Fences, inspected, invoked, start, initial, req]
  · apply Selection.publish ⟨1, 0, 42, none⟩
    · rfl
    · rfl
    · simp [inspected, invoked, start, initial, put]
    · trivial
    · rfl

theorem lost_ack_retry_reachable : Reachable ready acknowledged := by
  have h1 : Reachable ready crashed := .next successful_seal_reachable (.crash committed 0)
  have h2 : Reachable ready retried := .next h1 (.invoke crashed 0 req rfl)
  apply Reachable.next h2
  apply Step.acknowledge retried 0 req (effect req 1 ⟨42, .full⟩)
  · simp [retried, put]
  · simp [retried, crashed, committed, commit, req, put]
  · rfl

theorem lost_ack_retry_one_effect :
    acknowledged.counts (0, 1) = 1 ∧ acknowledged.ack 0 = some (effect req 1 ⟨42, .full⟩) := by
  constructor
  · rfl
  · simp [acknowledged, put]

-- Arbitrary-length runs containing only abort/stutter actions cannot imply
-- eventual completion; this is a counter-run, not a fairness/liveness proof.
def foreverAbort (_n : Nat) : State := start

theorem permanent_abort_run (n : Nat) :
    Step ready (foreverAbort n) (.abort 0) (foreverAbort (n + 1)) ∧
    (foreverAbort n).receipts req.key = none := ⟨.abort start 0, rfl⟩

end SatAutoRoom
