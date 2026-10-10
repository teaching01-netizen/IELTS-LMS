import Lean

namespace SATAccessCodeStart

/-!
An executable-state abstraction of the SAT access-code first-start commit.

`Digit6` is six base-10 digits, so leading zeroes are retained. The Go HTTP
boundary must prove that `NormalizeSubmitted` constructs this value only from
six ASCII digits. This file proves properties of the transaction-visible
start state, not of JSON parsing, SQL execution, encryption, or scheduling.
-/

abbrev Digit := Fin 10

structure Digit6 where
  d0 : Digit
  d1 : Digit
  d2 : Digit
  d3 : Digit
  d4 : Digit
  d5 : Digit
  deriving DecidableEq, Repr

inductive StartMode where
  | proctor
  | accessCode
  deriving DecidableEq, Repr

inductive SessionStatus where
  | scheduled
  | live
  | paused
  | closed
  deriving DecidableEq, Repr

inductive LinkStatus where
  | absent
  | active
  | paused
  | revoked
  deriving DecidableEq, Repr

inductive RuntimeStatus where
  | absent
  | live
  | paused
  | closed
  deriving DecidableEq, Repr

inductive CandidatePhase where
  | preExam
  | inExam
  | postExam
  deriving DecidableEq, Repr

structure Policy where
  mode : StartMode
  status : SessionStatus
  linkStatus : LinkStatus
  scheduleOpensAt : Nat
  scheduleClosesAt : Nat
  linkOpensAt : Option Nat
  linkClosesAt : Option Nat
  code : Digit6
  generation : Nat
  personalTiming : Bool
  publishedVersion : Nat
  deriving DecidableEq, Repr

def effectiveOpensAt (p : Policy) : Nat :=
  match p.linkOpensAt with
  | none => p.scheduleOpensAt
  | some t => max p.scheduleOpensAt t

def effectiveClosesAt (p : Policy) : Nat :=
  match p.linkClosesAt with
  | none => p.scheduleClosesAt
  | some t => min p.scheduleClosesAt t

def insideEffectiveWindow (p : Policy) (dbNow : Nat) : Prop :=
  effectiveOpensAt p ≤ dbNow ∧ dbNow < effectiveClosesAt p

structure Candidate where
  owner : Nat
  writer : Nat
  controlEpoch : Nat
  codeRequired : Bool
  acceptedAt : Option Nat
  acceptedGeneration : Option Nat
  terminal : Bool
  proctorPaused : Bool
  pinnedVersion : Nat
  firstDeliveredModule : Nat
  startedModule : Option Nat
  currentModule : Nat
  firstModuleStartedAt : Option Nat
  firstModuleDeadline : Option Nat
  allocationSeconds : Nat
  phase : CandidatePhase
  deriving DecidableEq, Repr

@[ext]
structure World where
  policy : Policy
  runtimeStatus : RuntimeStatus
  runtimePlan : Option Nat
  attempts : Nat → Candidate

/- The candidate identity is intentionally not part of student input. The
   caller supplies the identity derived from the verified attempt bearer. -/
structure Redemption where
  owner : Nat
  writer : Nat
  controlEpoch : Nat
  submittedCode : Option Digit6
  reservedGeneration : Nat
  reservationLive : Bool
  deriving DecidableEq, Repr

def sessionMayStart (p : Policy) : Prop :=
  p.status = .scheduled ∨ p.status = .live

def linkMayStart (p : Policy) : Prop :=
  p.linkStatus = .absent ∨ p.linkStatus = .active

def runtimeMayStart (w : World) : Prop :=
  match w.runtimeStatus, w.runtimePlan with
  | .absent, none => True
  | .live, some version => version = w.policy.publishedVersion
  | _, _ => False

def firstStartEligible (w : World) (candidateId : Nat)
    (r : Redemption) (policyCheckedAt startAt : Nat) : Prop :=
  let p := w.policy
  let a := w.attempts candidateId
  r.submittedCode = some p.code ∧
  r.reservedGeneration = p.generation ∧
  r.reservationLive = true ∧
  r.owner = a.owner ∧
  r.writer = a.writer ∧
  r.controlEpoch = a.controlEpoch ∧
  a.codeRequired = true ∧
  a.acceptedAt = none ∧
  a.acceptedGeneration = none ∧
  a.firstModuleStartedAt = none ∧
  a.firstModuleDeadline = none ∧
  a.terminal = false ∧
  a.proctorPaused = false ∧
  a.pinnedVersion = p.publishedVersion ∧
  p.mode = .accessCode ∧
  sessionMayStart p ∧
  linkMayStart p ∧
  p.personalTiming = true ∧
  insideEffectiveWindow p policyCheckedAt ∧
  startAt < effectiveClosesAt p ∧
  runtimeMayStart w

def initializeCandidate (a : Candidate) (generation dbNow : Nat) : Candidate :=
  { a with
    acceptedAt := some dbNow
    acceptedGeneration := some generation
    startedModule := some a.firstDeliveredModule
    currentModule := a.firstDeliveredModule
    firstModuleStartedAt := some dbNow
    firstModuleDeadline := some (dbNow + a.allocationSeconds)
    phase := .inExam }

/- This is the durable projection written by one committed start transaction.
   The room runtime is a single optional schedule-scoped plan; candidate rows
   are keyed independently by the verified candidate ID. -/
def commitFirstStart (w : World) (candidateId dbNow : Nat) : World :=
  { w with
    policy := { w.policy with status := .live }
    runtimeStatus := .live
    runtimePlan := some w.policy.publishedVersion
    attempts := fun otherId =>
      if otherId = candidateId then
        initializeCandidate (w.attempts candidateId) w.policy.generation dbNow
      else
        w.attempts otherId }

/- A rejected redemption leaves the modeled start-critical projection intact.
   The production limiter/reservation and idempotent row seeder are separate
   state machines and may still record their own facts. -/
noncomputable def startIfEligible (w : World) (candidateId : Nat)
    (r : Redemption) (policyCheckedAt startAt : Nat) : World := by
  classical
  exact if firstStartEligible w candidateId r policyCheckedAt startAt then
    commitFirstStart w candidateId startAt
  else
    w

theorem eligible_redemption_uses_current_code
    (w : World) (candidateId : Nat) (r : Redemption)
    (policyCheckedAt startAt : Nat)
    (h : firstStartEligible w candidateId r policyCheckedAt startAt) :
    r.submittedCode = some w.policy.code := h.1

theorem eligible_reservation_uses_current_generation
    (w : World) (candidateId : Nat) (r : Redemption)
    (policyCheckedAt startAt : Nat)
    (h : firstStartEligible w candidateId r policyCheckedAt startAt) :
    r.reservedGeneration = w.policy.generation := h.2.1

theorem rejected_start_has_no_start_effect
    (w : World) (candidateId : Nat) (r : Redemption)
    (policyCheckedAt startAt : Nat)
    (h : ¬ firstStartEligible w candidateId r policyCheckedAt startAt) :
    startIfEligible w candidateId r policyCheckedAt startAt = w := by
  simp [startIfEligible, h]

theorem successful_start_commits_acceptance_and_activation
    (w : World) (candidateId : Nat) (r : Redemption)
    (policyCheckedAt startAt : Nat)
    (h : firstStartEligible w candidateId r policyCheckedAt startAt) :
    let after := startIfEligible w candidateId r policyCheckedAt startAt
    (after.attempts candidateId).acceptedAt = some startAt ∧
    (after.attempts candidateId).acceptedGeneration = some w.policy.generation ∧
    (after.attempts candidateId).startedModule =
      some (w.attempts candidateId).firstDeliveredModule ∧
    (after.attempts candidateId).firstModuleStartedAt = some startAt ∧
    (after.attempts candidateId).firstModuleDeadline =
      some (startAt + (w.attempts candidateId).allocationSeconds) ∧
    (after.attempts candidateId).phase = .inExam := by
  simp [startIfEligible, h, commitFirstStart, initializeCandidate]

theorem successful_start_uses_one_pinned_runtime
    (w : World) (candidateId : Nat) (r : Redemption)
    (policyCheckedAt startAt : Nat)
    (h : firstStartEligible w candidateId r policyCheckedAt startAt) :
    let after := startIfEligible w candidateId r policyCheckedAt startAt
    after.runtimeStatus = .live ∧
    after.runtimePlan = some w.policy.publishedVersion ∧
    after.policy.status = .live := by
  simp [startIfEligible, h, commitFirstStart]

theorem successful_start_preserves_another_candidate
    (w : World) (candidateId otherId : Nat) (r : Redemption)
    (policyCheckedAt startAt : Nat)
    (h : firstStartEligible w candidateId r policyCheckedAt startAt)
    (hDifferent : otherId ≠ candidateId) :
    (startIfEligible w candidateId r policyCheckedAt startAt).attempts otherId =
      w.attempts otherId := by
  simp [startIfEligible, h, commitFirstStart, hDifferent]

theorem start_uses_database_time_for_deadline
    (w : World) (candidateId : Nat) (r : Redemption)
    (policyCheckedAt startAt : Nat)
    (h : firstStartEligible w candidateId r policyCheckedAt startAt) :
    ((startIfEligible w candidateId r policyCheckedAt startAt).attempts candidateId).firstModuleDeadline =
      some (startAt + (w.attempts candidateId).allocationSeconds) := by
  simp [startIfEligible, h, commitFirstStart, initializeCandidate]

theorem open_boundary_is_inclusive (p : Policy)
    (h : effectiveOpensAt p < effectiveClosesAt p) :
    insideEffectiveWindow p (effectiveOpensAt p) := by
  exact ⟨Nat.le_refl _, h⟩

theorem close_boundary_is_exclusive (p : Policy) (dbNow : Nat)
    (h : effectiveClosesAt p ≤ dbNow) :
    ¬ insideEffectiveWindow p dbNow := by
  intro hin
  exact (Nat.not_lt_of_ge h) hin.2

/- Replays require the verified owner/writer, a well-formed six-digit input,
   and a nonterminal attempt. They deliberately do not compare against the
   current code or generation and do not re-enter the start transaction. -/
def canResume (w : World) (candidateId : Nat) (r : Redemption) : Prop :=
  let a := w.attempts candidateId
  r.submittedCode.isSome ∧
  r.owner = a.owner ∧
  r.writer = a.writer ∧
  a.acceptedAt.isSome ∧
  a.terminal = false

noncomputable def resumeIfStarted (w : World) (candidateId : Nat)
    (r : Redemption) : Option World := by
  classical
  exact if canResume w candidateId r then some w else none

theorem replay_preserves_original_attempt_state
    (w : World) (candidateId : Nat) (r : Redemption)
    (h : canResume w candidateId r) :
    (resumeIfStarted w candidateId r).getD w = w := by
  simp [resumeIfStarted, h]

theorem replay_preserves_current_module
    (w : World) (candidateId : Nat) (r : Redemption)
    (h : canResume w candidateId r) :
    (((resumeIfStarted w candidateId r).getD w).attempts candidateId).currentModule =
      (w.attempts candidateId).currentModule := by
  simp [resumeIfStarted, h]

/- Pure transaction commits for distinct candidate rows commute when they
   observe the same immutable policy snapshot. This is the state-level basis
   for order-independent concurrent starts after lock acquisition. -/
theorem distinct_candidate_commits_commute
    (w : World) (left right leftTime rightTime : Nat)
    (hDifferent : left ≠ right) :
    commitFirstStart (commitFirstStart w left leftTime) right rightTime =
      commitFirstStart (commitFirstStart w right rightTime) left leftTime := by
  cases w with
  | mk policy runtimeStatus runtimePlan attempts =>
    apply World.ext
    · rfl
    · simp [commitFirstStart]
    · simp [commitFirstStart]
    · funext candidateId
      by_cases hLeft : candidateId = left
      · subst candidateId
        simp [commitFirstStart, hDifferent]
      · by_cases hRight : candidateId = right
        · subst candidateId
          have hRightLeft : right ≠ left := Ne.symm hDifferent
          simp [commitFirstStart, hRightLeft]
        · simp [commitFirstStart, hLeft, hRight]

/- A reservation represents either a pending comparison or a failed one.
   Success releases pending capacity; mismatch/expired lease moves pending to
   failed. The bound matches the schedule guard's `failed + pending < 200`
   reservation condition. -/
def failureLimit : Nat := 200

structure GuardBudget where
  failed : Nat
  pending : Nat
  deriving DecidableEq, Repr

def withinFailureLimit (b : GuardBudget) : Prop :=
  b.failed + b.pending ≤ failureLimit

def reserveComparison (b : GuardBudget)
    (_hCapacity : b.failed + b.pending < failureLimit) : GuardBudget :=
  { b with pending := b.pending + 1 }

def settleMismatch (b : GuardBudget) (_hPending : 0 < b.pending) : GuardBudget :=
  { failed := b.failed + 1, pending := b.pending - 1 }

def releaseSuccessfulComparison (b : GuardBudget)
    (_hPending : 0 < b.pending) : GuardBudget :=
  { b with pending := b.pending - 1 }

theorem reserve_respects_failure_limit (b : GuardBudget)
    (hCapacity : b.failed + b.pending < failureLimit) :
    withinFailureLimit (reserveComparison b hCapacity) := by
  have hCapacity' : b.failed + b.pending < 200 := by
    simpa [failureLimit] using hCapacity
  dsimp [withinFailureLimit, reserveComparison, failureLimit]
  omega

theorem full_budget_has_no_new_comparison_slot (b : GuardBudget)
    (hFull : b.failed + b.pending = failureLimit) :
    ¬ b.failed + b.pending < failureLimit := by
  omega

theorem mismatch_settlement_preserves_spent_capacity (b : GuardBudget)
    (hPending : 0 < b.pending) :
    (settleMismatch b hPending).failed + (settleMismatch b hPending).pending =
      b.failed + b.pending := by
  have hPending' : 1 ≤ b.pending := by omega
  dsimp [settleMismatch]
  omega

theorem successful_settlement_does_not_increase_spent_capacity
    (b : GuardBudget) (hPending : 0 < b.pending) :
    (releaseSuccessfulComparison b hPending).failed +
        (releaseSuccessfulComparison b hPending).pending ≤
      b.failed + b.pending := by
  have hPending' : 1 ≤ b.pending := by omega
  dsimp [releaseSuccessfulComparison]
  omega

end SATAccessCodeStart
