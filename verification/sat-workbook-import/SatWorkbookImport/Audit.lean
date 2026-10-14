import SatWorkbookImport.Safety

/-!
# Audit: anti-vacuity witnesses, negative controls, axiom listing
-/

namespace WorkbookImport

/-! ## Non-vacuity: the guarded transitions really fire -/

def s0 : State :=
  { draft := fun _ => 0, rev := 0, previews := fun _ => none, ledger := fun _ => none,
    effects := fun _ => 0 }

def P7 : Preview :=
  { targets := [1], content := fun _ => 9, snapshot := s0.draft, expectedRev := 0,
    importedRev := 0, status := .previewed }

def req7 : Req := { importId := 7, targets := [1], content := fun _ => 9 }

def s1 : State := { s0 with previews := upd s0.previews 7 (some P7) }

theorem init_s0 : Init s0 := ⟨fun _ => rfl, fun _ => rfl, fun _ => rfl⟩

theorem step_register : Step s0 (.register 7 [1] (fun _ => 9)) s1 := Step.register rfl

theorem hc7 : ∀ m, m ∈ P7.targets → req7.content m = P7.content m := fun _ _ => rfl

/-- A reachable state where the import was applied exactly once, module 1 was
replaced and module 2 was left alone: `Inv` is not holding vacuously. -/
theorem effect_is_reachable :
    ∃ s, Reach s ∧ s.effects 7 = 1 ∧ s.draft 1 = 9 ∧ s.draft 2 = 0 :=
  ⟨_, Reach.step (Reach.step (Reach.init init_s0) step_register)
        (Step.commitApply (k := 5) (r := req7) (p := P7) rfl rfl rfl rfl rfl hc7),
   rfl, by decide, by decide⟩

/-! ## Negative controls: what the naive implementation does -/

/-- The naive commit: no revision check. -/
def naiveCommit (s : State) (r : Req) (p : Preview) : State :=
  { s with draft := override p.targets r.content s.draft, rev := s.rev + 1 }

/-- State after another author edits module 1 following the preview. -/
def s1edit : State := { s1 with draft := upd s1.draft 1 55, rev := s1.rev + 1 }

theorem step_edit : Step s1 (.edit 1 55) s1edit := Step.edit

/-- Minimal counterexample for the naive protocol: the other author's edit
(module 1 := 55) is silently overwritten, and the checkpoint holds 0, so the
edit is unrecoverable even by undo. -/
theorem naive_loses_edit :
    (naiveCommit s1edit req7 P7).draft 1 = 9 ∧ s1edit.draft 1 = 55 ∧ P7.snapshot 1 = 0 :=
  ⟨by decide, by decide, rfl⟩

/-- The modelled protocol: in the very same state the commit cannot apply. -/
theorem real_commit_blocked :
    ∀ s'', Step s1edit (.commit 5 req7) s'' → s'' = s1edit := by
  intro s'' hs
  have hp : s1edit.previews req7.importId = some P7 := rfl
  exact stale_commit_is_noop hp rfl (by decide) hs

/-! ## Axiom audit -/

#print axioms WorkbookImport.reach_inv
#print axioms WorkbookImport.at_most_one_effect
#print axioms WorkbookImport.commit_scope_isolation
#print axioms WorkbookImport.commit_step_scope
#print axioms WorkbookImport.commit_installs_checked_content
#print axioms WorkbookImport.commit_applies_only_to_checked_draft
#print axioms WorkbookImport.stale_commit_is_noop
#print axioms WorkbookImport.claimed_key_commit_is_noop
#print axioms WorkbookImport.retry_after_applied_is_noop
#print axioms WorkbookImport.commit_of_used_import_is_noop
#print axioms WorkbookImport.undo_restores_snapshot
#print axioms WorkbookImport.undo_discards_only_the_import
#print axioms WorkbookImport.effect_is_reachable
#print axioms WorkbookImport.naive_loses_edit
#print axioms WorkbookImport.real_commit_blocked

end WorkbookImport
