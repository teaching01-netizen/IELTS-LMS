import Model
namespace SatFinishScore
theorem init_safe {s : State} (h : Init s) : Invariant s := by
  rcases h with ⟨hr, _, ho⟩
  constructor
  · intro a t ht
    rw [hr a] at ht
    contradiction
  · simp [ho]
theorem step_safe {s s' : State} (h : Invariant s) (step : Step s s') :
    Invariant s' := by
  rcases h with ⟨hr, ho⟩
  cases step with
  | commit actor attempt candidate =>
    unfold Invariant commitState
    constructor
    · intro a t ht
      by_cases ha : a = actor
      · simp [set, ha] at ht
        simp [← ht]
      · simp [set, ha] at ht
        exact List.mem_cons_of_mem _ (hr a t ht)
    · intro r hm
      obtain ⟨hc, hb⟩ := ho r hm
      exact ⟨List.mem_cons_of_mem _ hc, hb⟩
  | respond actor t g ht =>
    constructor
    · intro a ticket ha
      by_cases he : a = actor
      · simp [set, he] at ha
      · exact hr a ticket (by simpa [set, he] using ha)
    · intro r hm
      rcases List.mem_cons.mp hm with he | he
      · subst r
        exact ⟨hr actor t ht, rfl⟩
      · exact ho r he
  | publish => exact ⟨hr, ho⟩
  | crash actor =>
    constructor
    · intro a t ht
      by_cases he : a = actor
      · simp [set, he] at ht
      · exact hr a t (by simpa [set, he] using ht)
    · exact ho
  | repair => exact ⟨hr, ho⟩
  | failure => exact ⟨hr, ho⟩
theorem reachable_safe {s : State} (h : Reachable s) : Invariant s := by
  induction h with
  | initial s hi => exact init_safe hi
  | next _ step ih => exact step_safe ih step
/-- Same report, policy and live-gate observations, not arbitrary later refresh. -/
theorem response_after_commit_and_matches_bootstrap {s : State}
    (h : Reachable s) (r : Response) (hm : r ∈ s.responses) :
    r.ticket ∈ s.committedReads ∧
    r.body = bootstrap r.ticket.report r.observed r.gate :=
  (reachable_safe h).2 r hm
theorem overlay_preserves_raw (r : Report) (o : Observation) :
    (overlay r o).raw = r.raw := by
  cases h : r.raw <;> cases o <;> simp [overlay, h]
theorem overlay_preserves_release (r : Report) (o : Observation) :
    (overlay r o).released = r.released := by
  cases h : r.raw <;> cases o <;> simp [overlay, h]
theorem missing_raw_unchanged (r : Report) (o : Observation) (h : r.raw = none) :
    overlay r o = r := by simp [overlay, h]
theorem policy_failure_strips_conversion (r : Report) (raw : Nat)
    (h : r.raw = some raw) : (overlay r .failed).conversion = none := by
  simp [overlay, h]
theorem overlay_idempotent (r : Report) (o : Observation) :
    overlay (overlay r o) o = overlay r o := by
  cases h : r.raw <;> cases o <;> simp [overlay, h]
theorem no_snapshot_exposure (r : Report) (o : Observation) (g : Gate)
    (out : Report) (h : finish r o g = some out) : out.snapshot = none := by
  unfold finish project at h
  split at h
  · cases g <;> simp only [Option.some.injEq, receipt] at h
    · cases h; rfl
    · cases h; rfl
    · contradiction
  · simp only [Option.some.injEq] at h
    cases h
    rfl
theorem closed_gate_hides_report (r : Report) (o : Observation) :
    finish r o .closed = some (receipt (overlay r o)) := by
  simp [finish, project]
theorem withheld_hides_report (r : Report) (o : Observation) (g : Gate)
    (h : r.released = false) :
    finish r o g = some (receipt (overlay r o)) := by
  simp [finish, project, overlay_preserves_release, h]
theorem response_does_not_write (s : State) (actor : Nat) (t : Ticket) (g : Gate) :
    ({ s with ready := set s.ready actor none, responses := { ticket := t, observed := s.policy, gate := g, body := finish t.report s.policy g } :: s.responses } : State).stored = s.stored := rfl
end SatFinishScore
