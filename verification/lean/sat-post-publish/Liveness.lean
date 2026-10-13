import Safety

namespace SATPostPublish

/-- Conditional completion: once a committed publish acknowledgment is delivered,
    an open sheet receives the success receipt in this transition. -/
theorem delivered_ack_makes_success_visible
    (s : State) (target : Target)
    (hOpen : s.sheetOpen = true)
    (hCommitted : s.outcome = .committed ∧ s.committedTarget = some target)
    (hExam : target.examId = s.examId) :
    successVisible (step s (.acknowledge target)) :=
  valid_ack_shows_success_if_sheet_is_open s target hOpen hCommitted hExam

/-- A permanently held refresh may remain pending forever; refresh availability
    is not a liveness premise for delivering the publish receipt. -/
theorem held_refresh_does_not_change_receipt (s : State) :
    (step s .releaseReadHeld).receipt = s.receipt := rfl

/-- The model does not claim success when the acknowledgment is permanently lost.
    The outcome remains unknown until a trustworthy response/status read arrives. -/
theorem lost_ack_is_unknown_without_fabricating_receipt (s : State) :
    (step s .loseAcknowledgment).outcome = .unknown ∧
    (step s .loseAcknowledgment).receipt = s.receipt := by
  simp [step]

end SATPostPublish
