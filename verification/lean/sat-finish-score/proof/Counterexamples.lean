import Safety
namespace SatFinishScore
def converted (n : Nat) : Conversion :=
  { revision := n, rw := some ⟨600, 600⟩, math := some ⟨500, 500⟩, total := some ⟨1100, 1100⟩ }
def rawReport : Report := ⟨some 8, none, some 42, true⟩
theorem old_finish_misses_score :
    rawReport.conversion = none ∧
    (overlay rawReport (.active (fun _ => some (converted 1)))).conversion =
      some (converted 1) := by decide
theorem policy_change_can_change_display :
    finish rawReport (.active (fun _ => some (converted 1))) .open ≠
    bootstrap rawReport (.active (fun _ => some (converted 2))) .open := by decide
theorem disabled_old_endpoint_leaks :
    rawReport.raw ≠ none ∧
    (receipt (overlay rawReport .absent)).raw = none := by decide
def start : State := {
  stored := fun _ => none, ready := fun _ => none, committedReads := [], responses := [], policy := .active (fun _ => some (converted 1)) }
def committed : State := {
  start with stored := set start.stored 7 (some rawReport), ready := set start.ready 10 (some ⟨7, rawReport⟩), committedReads := [⟨7, rawReport⟩] }
def emitted : State := {
  committed with ready := set committed.ready 10 none, responses := [{ ticket := ⟨7, rawReport⟩, observed := committed.policy, gate := .open, body := finish rawReport committed.policy .open }] }
theorem nonvacuous_response :
    Reachable emitted ∧ ∃ out, (emitted.responses.head?).bind (·.body) = some out ∧
      out.conversion = some (converted 1) := by
  have h0 : Reachable start := .initial start ⟨fun _ => rfl, rfl, rfl⟩
  have h1 : Reachable committed := .next h0 (.commit start 10 7 rawReport)
  have h2 : Reachable emitted :=
    .next h1 (.respond committed 10 ⟨7, rawReport⟩ .open (by simp [committed, set]))
  exact ⟨h2, { rawReport with conversion := some (converted 1), snapshot := none }, rfl, rfl⟩
end SatFinishScore
