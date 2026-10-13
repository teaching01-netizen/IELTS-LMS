import Model

namespace SingleModuleImport

theorem singleton_filter (xs : List Nat) (a : Nat) (nd : xs.Nodup) :
    xs.filter (fun n => decide (n = a)) = if a ∈ xs then [a] else [] := by
  induction xs with
  | nil => simp
  | cons x xs ih =>
    have parts : x ∉ xs ∧ xs.Nodup := by simpa using nd
    by_cases eq : x = a
    · subst x
      simp [List.filter_cons, ih parts.2, parts.1]
    · simp [List.filter_cons, eq, Ne.symm eq, ih parts.2]

theorem pair_count (xs : List Nat) (a b : Nat) (different : a ≠ b) :
    xs.countP (fun n => decide (n ∈ [a, b])) =
      xs.countP (fun n => decide (n = a)) + xs.countP (fun n => decide (n = b)) := by
  induction xs with
  | nil => rfl
  | cons n xs ih =>
    have ih' : xs.countP (fun n => decide (n = a) || decide (n = b)) =
        xs.countP (fun n => decide (n = a)) + xs.countP (fun n => decide (n = b)) := by
      simpa using ih
    by_cases ha : n = a <;> by_cases hb : n = b
    · exact False.elim (different (ha.symm.trans hb))
    · simp [List.countP_cons, ha, hb, ih', different, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm]
    · simp [List.countP_cons, ha, hb, ih', Ne.symm different, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm]
    · simp [List.countP_cons, ha, hb, ih']

theorem imported_exactly_two (r : Request) (shape : ShapeOK r) (tests : PretestsOK r) :
    ((imported r).filter fun p => p.isPretest).length = 2 := by
  have len := tests.1
  obtain ⟨a, b, pair⟩ : ∃ a b, r.selected = [a, b] := by
    cases h : r.selected with
    | nil => simp [h] at len
    | cons a tail =>
      cases ht : tail with
      | nil => simp [h, ht] at len
      | cons b rest =>
        have empty : rest = [] := by
          have restLen : rest.length = 0 := by
            simp only [h, ht, List.length_cons, List.length_nil] at len
            omega
          exact List.length_eq_zero_iff.mp restLen
        exact ⟨a, b, by simp [h, ht, empty]⟩
  have different : a ≠ b := by simpa [pair] using tests.2.1
  have arange := tests.2.2.1 a (by simp [pair])
  have brange := tests.2.2.1 b (by simp [pair])
  have amem : a ∈ List.range' 1 (expected r.target) := by
    apply List.mem_range'.mpr
    exact ⟨a - 1, by omega, by omega⟩
  have bmem : b ∈ List.range' 1 (expected r.target) := by
    apply List.mem_range'.mpr
    exact ⟨b - 1, by omega, by omega⟩
  rw [← List.countP_eq_length_filter, imported, List.countP_map]
  change r.questions.countP (fun q => decide (q.order ∈ r.selected)) = 2
  change r.questions.countP ((fun n => decide (n ∈ r.selected)) ∘ Question.order) = 2
  rw [← List.countP_map (p := fun n => decide (n ∈ r.selected)) (f := Question.order)]
  rw [shape.2, pair, pair_count _ a b different]
  simp [List.countP_eq_length_filter, singleton_filter _ _ (List.nodup_range'), amem, bmem]

theorem initiation {s : State} (h : Init s) : Invariant s := by
  obtain ⟨d, ps, enabled, rfl⟩ := h
  simp [Invariant, initialWithFlag]

theorem commit_preserves {s : State} (h : Invariant s) (r : Request)
    (unused : s.receipts r.key = none) : Invariant (committed s r) := by
  have zero : s.effects r.key = 0 := by
    have notOne : s.effects r.key ≠ 1 := by
      intro one
      obtain ⟨receipt, found⟩ := (h r.key).2.mp one
      rw [unused] at found
      cases found
    have bound := (h r.key).1
    omega
  intro k
  by_cases same : k = r.key
  · subst k
    simp [committed, zero]
  · simpa [committed, same] using h k

theorem consecution {s t : State} {a : Action}
    (h : Invariant s) (step : Step s a t) : Invariant t := by
  cases step with
  | commit r p now preview ready unused keyUnused enabled => exact commit_preserves h r unused
  | replay r receipt found same =>
      intro k
      by_cases sameKey : k = r.key
      · subst k
        simpa [Invariant] using h r.key
      · simpa [Invariant, sameKey] using h k
  | evictOperationKey key =>
      intro k
      simpa [Invariant] using h k
  | setSingleModuleEnabled enabled =>
      intro k
      simpa [Invariant] using h k
  | _ => exact h

theorem reachable_invariant {s : State} (h : Reachable s) : Invariant s := by
  induction h with
  | init h => exact initiation h
  | step _ step ih => exact consecution ih step

theorem at_most_once {s : State} (h : Reachable s) (k : Key) : s.effects k ≤ 1 :=
  (reachable_invariant h k).1

theorem effect_has_receipt {s : State} (h : Reachable s) (k : Key)
    (effect : s.effects k = 1) : ∃ receipt, s.receipts k = some receipt :=
  (reachable_invariant h k).2.mp effect

theorem non_target_preserved (d : Draft) (r : Request) (m : Module)
    (other : m ≠ r.target) : (replace d r).placements m = d.placements m := by
  simp [replace, other]

theorem policies_preserved (d : Draft) (r : Request) :
    (replace d r).routing = d.routing ∧ (replace d r).scoring = d.scoring := by
  exact ⟨rfl, rfl⟩

theorem imported_count {now : Nat} {d : Draft} {r : Request} {p : Preview}
    (h : Ready now d r p) : ((replace d r).placements r.target).length = expected r.target := by
  simpa [replace, imported] using h.2.2.2.2.2.2.2.1.1

theorem preview_content_bound {now : Nat} {d : Draft} {r : Request} {p : Preview}
    (h : Ready now d r p) : p.questions = r.questions :=
  h.2.2.2.1.2.2.2.2.2

theorem unknown_pretests_blocked {now : Nat} {d : Draft} {r : Request} {p : Preview}
    (unknown : r.source = none) : ¬ Ready now d r p := by
  intro h
  have tests : PretestsOK r := h.2.2.2.2.2.2.2.2.1
  exact tests.2.2.2.1 unknown

theorem stale_revision_blocked {now : Nat} {d : Draft} {r : Request} {p : Preview}
    (stale : d.revision ≠ r.revision) : ¬ Ready now d r p := by
  intro h
  exact stale h.2.2.1

theorem replay_no_mutation {s t : State} {r : Request}
    (h : Step s (.replay r) t) :
    t.draft = s.draft ∧ t.previews = s.previews ∧ t.receipts = s.receipts ∧ t.effects = s.effects := by
  cases h with
  | replay r receipt found same =>
      -- Replay restores the shared operation-key result cache, but leaves
      -- the authoritative draft and durable business receipt unchanged.
      simp

theorem replay_preserves_durable_result {s t : State} {r : Request}
    (h : Step s (.replay r) t) : t.receipts r.key = s.receipts r.key ∧ t.effects r.key = s.effects r.key := by
  cases h with
  | replay r receipt found same => exact ⟨rfl, rfl⟩

theorem disabled_blocks_fresh_commit {s t : State} {r : Request}
    (disabled : s.singleModuleEnabled = false) : ¬ Step s (.commit r) t := by
  intro step
  cases step with
  | commit _ _ _ _ _ _ _ enabled => simp [disabled] at enabled

theorem cached_key_blocks_fresh_commit {s t : State} {r : Request}
    (cached : s.operationKeys r.key ≠ none) : ¬ Step s (.commit r) t := by
  intro step
  cases step with
  | commit _ _ _ _ _ _ keyUnused _ => exact cached keyUnused

theorem durable_receipt_survives_operation_key_cleanup {s t : State} {key : Key}
    (step : Step s (.evictOperationKey key) t) : t.receipts key = s.receipts key := by
  cases step
  rfl

theorem retry_after_operation_key_cleanup {s : State} {key : Key} (receipt : Receipt)
    (durable : s.receipts key = some receipt) (_cleaned : s.operationKeys key = none)
    (requestKey : receipt.request.key = key) :
    ∃ t, Step s (.replay receipt.request) t ∧ t.operationKeys key = some receipt.request := by
  refine ⟨{ s with operationKeys := fun k => if k = receipt.request.key then some receipt.request else s.operationKeys k }, ?_, ?_⟩
  · exact Step.replay s receipt.request receipt (by simpa [requestKey] using durable) rfl
  · simp [requestKey]

theorem consumed_preview (s : State) (r : Request) :
    (committed s r).previews r.importId = none := by
  simp [committed]

theorem publish_pretests {d : Draft} {scope : Scope}
    (h : PublishReady d scope) (m : Module) (selected : included scope m = true) :
    ((d.placements m).filter fun p => p.isPretest).length = 2 :=
  (h m selected).2

theorem rw_requires_three {d : Draft} (h : PublishReady d .rw) :
    ModuleReady d .rw1 ∧ ModuleReady d .rwLower ∧ ModuleReady d .rwHigher := by
  exact ⟨h .rw1 rfl, h .rwLower rfl, h .rwHigher rfl⟩

theorem undo_restores {s t : State} {key : Key} (step : Step s (.undo key) t) :
    ∃ receipt, s.receipts key = some receipt ∧ t.draft = receipt.before := by
  cases step with
  | undo key receipt found _ _ _ => exact ⟨receipt, found, rfl⟩

theorem crash_durable {s t : State} {actor : Nat}
    (step : Step s (.crash actor) t) : t = s := by
  cases step
  rfl

theorem substantive_other_row_blocked (target : Module) (row : Row)
    (other : row.module ≠ target) (content : ∃ cell ∈ row.authoringCells, cell ≠ "") :
    classify target row = .block := by
  have authored : ¬ UntouchedScaffold row := by
    intro h
    obtain ⟨cell, member, nonempty⟩ := content
    exact nonempty (h.2.2.2.2.2 cell member)
  simp [classify, other, authored]

theorem untouched_other_row_ignored (target : Module) (row : Row)
    (other : row.module ≠ target) (untouched : UntouchedScaffold row) :
    classify target row = .ignore := by
  simp [classify, other, untouched]

theorem changed_scaffold_blocked (target : Module) (row : Row)
    (other : row.module ≠ target) (changed : ¬ UntouchedScaffold row) :
    classify target row = .block := by
  simp [classify, other, changed]

theorem used_key_cannot_commit {s t : State} {r : Request}
    (reachable : Reachable s) (used : s.effects r.key = 1) :
    ¬ Step s (.commit r) t := by
  obtain ⟨receipt, found⟩ := effect_has_receipt reachable r.key used
  intro step
  cases step with
  | commit _ _ _ _ _ unused _ _ => rw [unused] at found; cases found

theorem altered_replay_blocked {s t : State} {r : Request} (receipt : Receipt)
    (found : s.receipts r.key = some receipt) (changed : receipt.request ≠ r) :
    ¬ Step s (.replay r) t := by
  intro step
  cases step with
  | replay _ stored found' same =>
    have eq : receipt = stored := Option.some.inj (found.symm.trans found')
    subst stored
    exact changed same

theorem stale_after_commit (d : Draft) (first second : Request) (p : Preview) (now : Nat)
    (sameRevision : second.revision = d.revision) :
    ¬ Ready now (replace d first) second p := by
  apply stale_revision_blocked
  simp only [replace]
  omega

theorem stale_undo_blocked {s t : State} {key : Key} (receipt : Receipt)
    (found : s.receipts key = some receipt) (stale : s.draft.revision ≠ receipt.afterRevision) :
    ¬ Step s (.undo key) t := by
  intro step
  cases step with
  | undo _ stored found' _ sameRevision _ =>
    have eq : receipt = stored := Option.some.inj (found.symm.trans found')
    subst stored
    exact stale sameRevision

end SingleModuleImport
