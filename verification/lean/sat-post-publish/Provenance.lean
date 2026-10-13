import Safety

namespace SATPostPublish

/-- Ghost history records this document's accepted commit steps. It models the
    A1 backend acknowledgment contract, not SQL or actual database durability. -/
structure TrackedState where
  client : State
  publications : List Target

def recordCommit (s : TrackedState) : Action → List Target
  | .commit target =>
      if s.client.outcome = .pending ∧ target.examId = s.client.examId then
        target :: s.publications
      else s.publications
  | _ => s.publications

def trackedStep (s : TrackedState) (action : Action) : TrackedState :=
  { client := step s.client action, publications := recordCommit s action }

def PublicationProvenance (s : TrackedState) : Prop :=
  (∀ target, s.client.committedTarget = some target → target ∈ s.publications) ∧
  (∀ target, s.client.receipt = some target → target ∈ s.publications)

theorem initial_publication_provenance (s : TrackedState) (h : Init s.client) :
    PublicationProvenance s := by
  rcases h with ⟨hCommit, _, _, _, _, _, hReceipt, _, _⟩
  simp [PublicationProvenance, hCommit, hReceipt]

theorem publication_provenance_step (s : TrackedState) (action : Action)
    (h : PublicationProvenance s) : PublicationProvenance (trackedStep s action) := by
  rcases h with ⟨hCommit, hReceipt⟩
  cases action with
  | commit target =>
      by_cases hEnabled : s.client.outcome = .pending ∧ target.examId = s.client.examId
      · constructor
        · intro t ht
          have heq : target = t := Option.some.inj (by simpa [trackedStep, step, hEnabled] using ht)
          subst t
          simp [trackedStep, recordCommit, hEnabled]
        · intro t ht
          have hold : s.client.receipt = some t := by simpa [trackedStep, step, hEnabled] using ht
          simp [trackedStep, recordCommit, hEnabled, hReceipt t hold]
      · simpa [PublicationProvenance, trackedStep, step, recordCommit, hEnabled] using And.intro hCommit hReceipt
  | acknowledge target =>
      by_cases hEnabled : s.client.outcome = .committed ∧ s.client.committedTarget = some target ∧ target.examId = s.client.examId
      · constructor
        · simpa [trackedStep, step, recordCommit, hEnabled] using hCommit
        · intro t ht
          have heq : target = t := Option.some.inj (by simpa [trackedStep, step, hEnabled] using ht)
          subst t
          simpa [trackedStep, recordCommit] using hCommit target hEnabled.2.1
      · simpa [PublicationProvenance, trackedStep, step, recordCommit, hEnabled] using And.intro hCommit hReceipt
  | openSheet =>
      by_cases hMounted : s.client.sheetMounted = true <;>
        simpa [PublicationProvenance, trackedStep, step, recordCommit, hMounted] using And.intro hCommit hReceipt
  | beginPublish =>
      by_cases hOpen : s.client.sheetOpen = true
      · simpa [PublicationProvenance, trackedStep, step, recordCommit, hOpen] using hReceipt
      · simpa [PublicationProvenance, trackedStep, step, recordCommit, hOpen] using And.intro hCommit hReceipt
  | remotePublish target =>
      by_cases hExam : target.examId = s.client.examId <;>
        simpa [PublicationProvenance, trackedStep, step, recordCommit, hExam] using And.intro hCommit hReceipt
  | reload => simp [PublicationProvenance, trackedStep, step, recordCommit]
  | changeExam examId => simp [PublicationProvenance, trackedStep, step, recordCommit]
  | rejectPublish | loseAcknowledgment | malformedAcknowledgment | beginReleaseRead
  | releaseReadSucceeded _ | releaseReadFailed | releaseReadHeld | shellAnswered _
  | done | createRoom | openDraft =>
      simpa [PublicationProvenance, trackedStep, step, recordCommit] using And.intro hCommit hReceipt

inductive TrackedReachable : TrackedState → Prop where
  | initial {s : TrackedState} (h : Init s.client) : TrackedReachable s
  | next {s : TrackedState} (h : TrackedReachable s) (action : Action) :
      TrackedReachable (trackedStep s action)

theorem reachable_publication_provenance {s : TrackedState} (h : TrackedReachable s) :
    PublicationProvenance s := by
  induction h with
  | initial hInit => exact initial_publication_provenance _ hInit
  | next _ action ih => exact publication_provenance_step _ action ih

/-- Receipt provenance includes a matching commit in history, not just exam ID. -/
theorem acknowledged_receipt_has_commit {s : TrackedState} (h : TrackedReachable s)
    (target : Target) (hReceipt : s.client.receipt = some target) :
    target ∈ s.publications :=
  (reachable_publication_provenance h).2 target hReceipt

/-- Erasing ghost history yields exactly the original operational step. -/
theorem tracked_step_refines_client_step (s : TrackedState) (action : Action) :
    (trackedStep s action).client = step s.client action := rfl

/-- Non-vacuity: any target for the active exam can execute a real modeled
    open/confirm/commit/ack trace, and leaves both receipt and commit history. -/
theorem tracked_success_is_reachable (target : Target) :
    ∃ s : TrackedState, TrackedReachable s ∧
      s.client.receipt = some target ∧ target ∈ s.publications := by
  let initial : TrackedState := { client := initialState target.examId .ready none, publications := [] }
  let opened := trackedStep initial .openSheet
  let pending := trackedStep opened .beginPublish
  let committed := trackedStep pending (.commit target)
  let acknowledged := trackedStep committed (.acknowledge target)
  have hInit : Init initial.client := by simp [initial, initialState, Init]
  have h0 : TrackedReachable initial := TrackedReachable.initial hInit
  have h1 : TrackedReachable opened := TrackedReachable.next h0 .openSheet
  have h2 : TrackedReachable pending := TrackedReachable.next h1 .beginPublish
  have h3 : TrackedReachable committed := TrackedReachable.next h2 (.commit target)
  have h4 : TrackedReachable acknowledged := TrackedReachable.next h3 (.acknowledge target)
  refine ⟨acknowledged, h4, ?_, ?_⟩
  · simp [acknowledged, committed, pending, opened, initial, trackedStep, step, initialState]
  · simp [acknowledged, committed, pending, opened, initial, trackedStep, recordCommit, step, initialState]

end SATPostPublish
