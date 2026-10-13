import Model

namespace SATPostPublish.Traces

def initial : State := initialState 17 .ready none
def target : Target := { examId := 17, versionId := 91, versionNumber := 4, scope := .math }
def opened : State := step initial .openSheet
def pending : State := step opened .beginPublish
def committed : State := step pending (.commit target)
def acknowledged : State := step committed (.acknowledge target)
def lostAck : State := step committed .loseAcknowledgment
def rejected : State := step pending .rejectPublish

theorem initial_is_admissible : Init initial := by
  simp [initial, initialState, Init]

theorem successful_publish_trace_is_reachable : Reachable acknowledged := by
  have h0 : Reachable initial := Reachable.initial initial_is_admissible
  have h1 : Reachable opened := Reachable.next h0 rfl
  have h2 : Reachable pending := Reachable.next h1 rfl
  have h3 : Reachable committed := Reachable.next h2 rfl
  exact Reachable.next h3 rfl

theorem lost_ack_trace_is_reachable : Reachable lostAck := by
  have h0 : Reachable initial := Reachable.initial initial_is_admissible
  have h1 : Reachable opened := Reachable.next h0 rfl
  have h2 : Reachable pending := Reachable.next h1 rfl
  have h3 : Reachable committed := Reachable.next h2 rfl
  exact Reachable.next h3 rfl

theorem rejected_publish_trace_is_reachable : Reachable rejected := by
  have h0 : Reachable initial := Reachable.initial initial_is_admissible
  have h1 : Reachable opened := Reachable.next h0 rfl
  have h2 : Reachable pending := Reachable.next h1 rfl
  exact Reachable.next h2 rfl

theorem success_trace_has_receipt_and_visible_sheet :
    acknowledged.receipt = some target ∧ successVisible acknowledged := by
  simp [acknowledged, committed, pending, opened, initial, initialState, target, step, successVisible]

theorem lost_ack_trace_has_unknown_outcome_and_no_new_receipt :
    lostAck.outcome = .unknown ∧ lostAck.receipt = none := by
  simp [lostAck, committed, pending, opened, initial, initialState, target, step]

theorem rejected_trace_has_rejected_outcome_and_no_receipt :
    rejected.outcome = .rejected ∧ rejected.receipt = none := by
  simp [rejected, pending, opened, initial, initialState, step]

end SATPostPublish.Traces
