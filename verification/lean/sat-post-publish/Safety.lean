import Model

namespace SATPostPublish

theorem initial_receipt_sound {s : State} (h : Init s) : ReceiptSound s := by
  rcases h with ⟨_, _, _, _, _, _, hNoReceipt, _, _⟩
  intro target hReceipt
  simp [hNoReceipt] at hReceipt

theorem receiptSound_step (s : State) (action : Action) (h : ReceiptSound s) :
    ReceiptSound (step s action) := by
  cases action with
  | openSheet =>
      by_cases hMounted : s.sheetMounted = true <;>
        simpa [ReceiptSound, step, hMounted] using h
  | beginPublish =>
      by_cases hOpen : s.sheetOpen = true <;>
        simpa [ReceiptSound, step, hOpen] using h
  | commit target =>
      by_cases hCommit : s.outcome = .pending ∧ target.examId = s.examId <;>
        simpa [ReceiptSound, step, hCommit] using h
  | acknowledge target =>
      by_cases hAck : s.outcome = .committed ∧ s.committedTarget = some target ∧ target.examId = s.examId
      · intro receipt hReceipt
        have hEq : target = receipt := Option.some.inj (by simpa [step, hAck] using hReceipt)
        subst receipt
        simp [step, hAck, hAck.2.2]
      · intro receipt hReceipt
        have hOldReceipt : s.receipt = some receipt := by simpa [step, hAck] using hReceipt
        have hSound := h receipt hOldReceipt
        simpa [step, hAck] using hSound
  | rejectPublish => simpa [ReceiptSound, step] using h
  | loseAcknowledgment => simpa [ReceiptSound, step] using h
  | malformedAcknowledgment => simpa [ReceiptSound, step] using h
  | beginReleaseRead => simpa [ReceiptSound, step] using h
  | releaseReadSucceeded projection => simpa [ReceiptSound, step] using h
  | releaseReadFailed => simpa [ReceiptSound, step] using h
  | releaseReadHeld => simpa [ReceiptSound, step] using h
  | shellAnswered projection => simpa [ReceiptSound, step] using h
  | remotePublish target =>
      by_cases hRemote : target.examId = s.examId <;>
        simpa [ReceiptSound, step, hRemote] using h
  | done => simpa [ReceiptSound, step] using h
  | createRoom => simpa [ReceiptSound, step] using h
  | reload => simp [ReceiptSound, step]
  | openDraft => simpa [ReceiptSound, step] using h
  | changeExam examId => simp [ReceiptSound, step]

theorem all_reachable_receipts_belong_to_active_exam {s : State} (h : Reachable s) :
    ReceiptSound s := by
  induction h with
  | initial hInit => exact initial_receipt_sound hInit
  | next hReachable hStep ih =>
      cases hStep
      exact receiptSound_step _ _ ih

theorem shell_answer_preserves_sheet_identity (s : State) (shell : ShellProjection) :
    let next := step s (.shellAnswered shell)
    next.sheetInstance = s.sheetInstance ∧
    next.sheetMounted = s.sheetMounted ∧
    next.sheetOpen = s.sheetOpen := by
  simp [step]

theorem receipt_survives_release_success (s : State) (projection : Option Target) :
    (step s (.releaseReadSucceeded projection)).receipt = s.receipt := rfl

theorem receipt_survives_release_failure (s : State) :
    (step s .releaseReadFailed).receipt = s.receipt := rfl

theorem receipt_survives_held_release_read (s : State) :
    (step s .releaseReadHeld).receipt = s.receipt := rfl

theorem valid_ack_shows_success_if_sheet_is_open
    (s : State) (target : Target)
    (hOpen : s.sheetOpen = true)
    (hCommitted : s.outcome = .committed ∧ s.committedTarget = some target)
    (hExam : target.examId = s.examId) :
    successVisible (step s (.acknowledge target)) := by
  simp [successVisible, step, hOpen, hCommitted, hExam]

theorem create_room_uses_acknowledged_target
    (s : State) (target : Target)
    (hReceipt : s.receipt = some target) :
    (step s .createRoom).roomTarget = some target := by
  simp [step, hReceipt]

theorem create_room_stays_pinned_after_remote_publish
    (s : State) (acknowledged newer : Target)
    (hReceipt : s.receipt = some acknowledged) :
    (step (step s (.remotePublish newer)) .createRoom).roomTarget = some acknowledged := by
  by_cases hRemote : newer.examId = s.examId <;>
    simp [step, hRemote, hReceipt]

theorem done_preserves_acknowledged_receipt (s : State) :
    (step s .done).receipt = s.receipt := rfl

theorem reload_clears_ephemeral_receipt (s : State) :
    (step s .reload).receipt = none := rfl

theorem reload_does_not_open_a_draft (s : State) :
    (step s .reload).openDraftPosts = s.openDraftPosts := rfl

theorem shell_read_does_not_open_a_draft (s : State) (projection : ShellProjection) :
    (step s (.shellAnswered projection)).openDraftPosts = s.openDraftPosts := rfl

theorem malformed_ack_does_not_create_receipt (s : State) :
    (step s .malformedAcknowledgment).receipt = s.receipt := rfl

theorem invalid_ack_does_not_create_receipt
    (s : State) (target : Target)
    (hNoReceipt : s.receipt = none)
    (hInvalid : ¬ (s.outcome = .committed ∧ s.committedTarget = some target ∧ target.examId = s.examId)) :
    (step s (.acknowledge target)).receipt = none := by
  simp [step, hNoReceipt, hInvalid]

end SATPostPublish
