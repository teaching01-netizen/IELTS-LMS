import Model

namespace SatClassroomGate

/-- A committed operation receipt and its room effect appear together. -/
def StoreSafe (store : Store) : Prop :=
  ∀ key,
    (store.receipts key = none → store.roomEffects key = 0) ∧
    (∀ receipt, store.receipts key = some receipt → store.roomEffects key = 1)

theorem empty_safe (enabled : InstanceId → Bool) : StoreSafe (Store.empty enabled) := by
  intro key
  constructor
  · intro _
    rfl
  · intro receipt impossible
    cases impossible

private theorem commit_preserves_safe (store : Store) (request : Request)
    (safe : StoreSafe store) (fresh : store.receipts request.key = none) :
    StoreSafe (Store.commit store request) := by
  intro key
  by_cases sameKey : key = request.key
  · subst key
    constructor
    · intro noReceipt
      simp [Store.commit] at noReceipt
    · intro receipt committed
      have receiptEq : receipt = { payload := request.payload, roomId := store.totalRooms } := by
        simpa [Store.commit] using committed.symm
      subst receipt
      have noEffect : store.roomEffects request.key = 0 := (safe request.key).1 fresh
      simp [Store.commit, noEffect]
  · constructor
    · intro noReceipt
      have oldNoReceipt : store.receipts key = none := by
        simpa [Store.commit, sameKey] using noReceipt
      have oldNoEffect := (safe key).1 oldNoReceipt
      simpa [Store.commit, sameKey] using oldNoEffect
    · intro receipt committed
      have oldReceipt : store.receipts key = some receipt := by
        simpa [Store.commit, sameKey] using committed
      have oldEffect := (safe key).2 receipt oldReceipt
      simpa [Store.commit, sameKey] using oldEffect

theorem handle_preserves_safe (store : Store) (target : InstanceId) (request : Request)
    (safe : StoreSafe store) : StoreSafe (handle store target request).1 := by
  unfold handle
  cases oldReceipt : store.receipts request.key with
  | some receipt =>
      by_cases sameBody : receipt.payload == request.payload
      · simpa [oldReceipt, sameBody] using safe
      · simpa [oldReceipt, sameBody] using safe
  | none =>
      by_cases blocked : request.payload.session = .classroom ∧ store.classroomEnabled target = false
      · simpa [oldReceipt, blocked] using safe
      · have committed := commit_preserves_safe store request safe oldReceipt
        simpa [oldReceipt, blocked] using committed

/-- Every finite interleaving of arbitrary requests and API instances preserves
the one-effect-per-operation property, under the atomic transaction model. -/
theorem reachable_safe {store : Store} (reachable : Reachable store) : StoreSafe store := by
  induction reachable with
  | init enabled => exact empty_safe enabled
  | request store target request previous inductionHypothesis =>
      exact handle_preserves_safe store target request inductionHypothesis

theorem reachable_at_most_one_room_per_operation {store : Store} (reachable : Reachable store) :
    ∀ key, store.roomEffects key ≤ 1 := by
  have safe := reachable_safe reachable
  intro key
  cases receipt : store.receipts key with
  | none => simp [(safe key).1 receipt]
  | some value => simp [(safe key).2 value receipt]

/-- A new Classroom request sent to a disabled instance is refused without a
state change. A pre-existing matching receipt is intentionally replayed first. -/
theorem disabled_instance_refuses_new_classroom
    (store : Store) (target : InstanceId) (request : Request)
    (fresh : store.receipts request.key = none)
    (disabled : store.classroomEnabled target = false)
    (classroom : request.payload.session = .classroom) :
    handle store target request = (store, .classroomDisabled) := by
  unfold handle
  rw [fresh]
  simp [classroom, disabled]

/-- Practice requests continue to commit when Classroom is disabled. -/
theorem disabled_gate_allows_practice
    (store : Store) (target : InstanceId) (request : Request)
    (safe : StoreSafe store)
    (fresh : store.receipts request.key = none)
    (disabled : store.classroomEnabled target = false)
    (practice : request.payload.session = .practice) :
    (handle store target request).2 =
      .created { payload := request.payload, roomId := store.totalRooms } ∧
    (handle store target request).1.roomEffects request.key = 1 := by
  have unblocked : ¬ (request.payload.session = .classroom ∧ store.classroomEnabled target = false) := by
    rw [practice]
    simp [disabled]
  constructor
  · simp [handle, fresh, unblocked]
  · simp [handle, fresh, unblocked, Store.commit, (safe request.key).1 fresh]

theorem same_key_same_body_replays
    (store : Store) (target : InstanceId) (request : Request) (receipt : Receipt)
    (stored : store.receipts request.key = some receipt)
    (sameBody : receipt.payload = request.payload) :
    handle store target request = (store, .replayed receipt) := by
  simp [handle, stored, sameBody]

/-- An unavailable/failed capability check blocks a restored Classroom choice,
while the Practice choice remains available. -/
theorem classroom_requires_enabled_capability (availability : Availability) :
    maySubmit .classroom availability = true ↔ availability = .enabled := by
  cases availability <;> simp [maySubmit, classroomChoiceEnabled]

/-- A restored Classroom selection cannot start a request while capability is
unknown or disabled; the current selection and draft remain untouched. -/
theorem blocked_restored_classroom_cannot_begin
    (client : ClientState) (request : Request)
    (selected : client.selected = .classroom)
    (unavailable : client.availability ≠ .enabled) :
    client.beginSubmit request = client := by
  cases availability : client.availability with
  | unknown => simp [ClientState.beginSubmit, selected, availability, maySubmit, classroomChoiceEnabled]
  | disabled => simp [ClientState.beginSubmit, selected, availability, maySubmit, classroomChoiceEnabled]
  | enabled => exact False.elim (unavailable availability)

/-- Starting a client request never silently rewrites the selected session. -/
theorem begin_submit_preserves_selected_session (client : ClientState) (request : Request) :
    (client.beginSubmit request).selected = client.selected := by
  unfold ClientState.beginSubmit
  split
  · rfl
  · next canStart =>
    split
    · next sessionMatches => simp [sessionMatches]
    · next sessionMismatch => rfl

theorem practice_usable_for_every_capability (availability : Availability) :
    maySubmit .practice availability = true := by
  cases availability <;> rfl

theorem refresh_preserves_restored_form (client : ClientState) (availability : Availability) :
    (client.refreshAvailability availability).selected = client.selected ∧
    (client.refreshAvailability availability).draft = client.draft := by
  constructor <;> rfl

theorem disabled_refusal_clears_pending_and_preserves_form (client : ClientState) :
    (client.receive .satClassroomDisabled).pending = none ∧
    (client.receive .satClassroomDisabled).draft = client.draft ∧
    (client.receive .satClassroomDisabled).selected = client.selected ∧
    (client.receive .satClassroomDisabled).availability = .disabled ∧
    (client.receive .satClassroomDisabled).status = .rejected := by
  simp [ClientState.receive]

theorem definitive_refusal_disables_classroom_but_keeps_practice (client : ClientState) :
    maySubmit .classroom (client.receive .satClassroomDisabled).availability = false ∧
    maySubmit .practice (client.receive .satClassroomDisabled).availability = true := by
  simp [ClientState.receive, maySubmit, classroomChoiceEnabled]

theorem generic_5xx_retains_the_same_pending_attempt (client : ClientState) :
    (client.receive .generic5xx).pending = client.pending ∧
    (client.receive .generic5xx).draft = client.draft ∧
    (client.receive .generic5xx).status = .unknown := by
  simp [ClientState.receive]

end SatClassroomGate
