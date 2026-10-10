import OperationalModel

namespace SATAccessCodeStart.Operational

theorem emptyState_initial : Initial emptyState := by
  simp [Initial, budgetSafe, waiterBound, workerBound, runtimePinned, emptyState, failureLimit, waiterLimit]

theorem initial_invariant {s : State} (h : Initial s) : Invariant s := h

theorem budgetSafe_transition (s : State) (action : Action) (h : budgetSafe s) :
    budgetSafe (transition s action) := by
  cases action with
  | claim actor observedGeneration =>
      unfold budgetSafe at h ⊢
      by_cases hClaim : observedGeneration = s.generation ∧
          s.failedCurrentWindow < failureLimit ∧
          s.pending + s.failedCurrentWindow < failureLimit
      · simp [transition, hClaim]
        omega
      · simpa [transition, hClaim] using h
  | settleMismatch actor reservationGeneration reservationWindow =>
      unfold budgetSafe at h ⊢
      by_cases hReservation : reservationGeneration = s.generation ∧ s.pending > 0
      · by_cases hCurrentWindow : reservationWindow = s.window
        · simp [transition, hReservation, hCurrentWindow]
          omega
        · simp [transition, hReservation, hCurrentWindow]
          omega
      · simpa [transition, hReservation] using h
  | settleSuccess actor reservationGeneration =>
      unfold budgetSafe at h ⊢
      by_cases hReservation : reservationGeneration = s.generation ∧ s.pending > 0
      · simp [transition, hReservation]
        omega
      · simpa [transition, hReservation] using h
  | expire actor reservationGeneration reservationWindow =>
      unfold budgetSafe at h ⊢
      by_cases hReservation : reservationGeneration = s.generation ∧ s.pending > 0
      · by_cases hCurrentWindow : reservationWindow = s.window
        · simp [transition, hReservation, hCurrentWindow]
          omega
        · simp [transition, hReservation, hCurrentWindow]
          omega
      · simpa [transition, hReservation] using h
  | sweepExpired count currentWindowCount =>
      unfold budgetSafe at h ⊢
      by_cases hSweep : count ≤ s.pending ∧ currentWindowCount ≤ count
      · simp [transition, hSweep]
        omega
      · simpa [transition, hSweep] using h
  | rollWindow =>
      unfold budgetSafe at h ⊢
      simp [transition]
      omega
  | rotate =>
      simp [transition, budgetSafe, failureLimit]
  | beginWait actor observedGeneration kind =>
      simpa [transition, budgetSafe, addWaiter] using h
  | wake actor => simpa [transition, budgetSafe] using h
  | timeout actor => simpa [transition, budgetSafe] using h
  | cancel actor => simpa [transition, budgetSafe] using h
  | acquireInitializer actor => simpa [transition, budgetSafe] using h
  | releaseInitializer actor => simpa [transition, budgetSafe] using h
  | commitColdRuntime actor version => simpa [transition, budgetSafe] using h
  | remoteRuntimeCommit version => simpa [transition, budgetSafe] using h
  | staleExclusiveRollback actor => simpa [transition, budgetSafe] using h
  | retrySharedRuntime actor version => simpa [transition, budgetSafe] using h
  | acquireStartWorker actor => simpa [transition, budgetSafe] using h
  | releaseStartWorker actor => simpa [transition, budgetSafe] using h
  | chargeStableQuota => simpa [transition, budgetSafe] using h
  | crashProcess => simpa [transition, budgetSafe] using h
  | restartProcess => simpa [transition, budgetSafe] using h

theorem waiterBound_addWaiter (s : State) (h : waiterBound s) :
    waiterBound (addWaiter s) := by
  unfold waiterBound at h ⊢
  by_cases hRoom : s.waiters < waiterLimit
  · simp [addWaiter, hRoom]
    omega
  · simp [addWaiter, hRoom]
    exact h

theorem waiterBound_transition (s : State) (action : Action) (h : waiterBound s) :
    waiterBound (transition s action) := by
  cases action with
  | beginWait actor observedGeneration kind =>
      by_cases hAdmit : canBeginWait s observedGeneration kind = true
      · have hAdded := waiterBound_addWaiter s h
        simpa [transition, hAdmit, addWaiter] using hAdded
      · simpa [transition, hAdmit, addWaiter] using h
  | wake actor =>
      by_cases hDrop : s.processAlive = true ∧ s.waiters > 0
      · have hBound : s.waiters ≤ waiterLimit := h
        have hDecrement : s.waiters - 1 ≤ waiterLimit :=
          Nat.le_trans (Nat.sub_le _ _) hBound
        simpa [transition, hDrop] using hDecrement
      · simpa [transition, waiterBound, hDrop] using h
  | timeout actor =>
      by_cases hDrop : s.processAlive = true ∧ s.waiters > 0
      · have hBound : s.waiters ≤ waiterLimit := h
        have hDecrement : s.waiters - 1 ≤ waiterLimit :=
          Nat.le_trans (Nat.sub_le _ _) hBound
        simpa [transition, hDrop] using hDecrement
      · simpa [transition, waiterBound, hDrop] using h
  | cancel actor =>
      by_cases hDrop : s.processAlive = true ∧ s.waiters > 0
      · have hBound : s.waiters ≤ waiterLimit := h
        have hDecrement : s.waiters - 1 ≤ waiterLimit :=
          Nat.le_trans (Nat.sub_le _ _) hBound
        simpa [transition, hDrop] using hDecrement
      · simpa [transition, waiterBound, hDrop] using h
  | crashProcess => simp [transition, waiterBound]
  | restartProcess => simp [transition, waiterBound]
  | claim actor observedGeneration => simpa [transition, waiterBound] using h
  | settleMismatch actor reservationGeneration reservationWindow => simpa [transition, waiterBound] using h
  | settleSuccess actor reservationGeneration => simpa [transition, waiterBound] using h
  | expire actor reservationGeneration reservationWindow => simpa [transition, waiterBound] using h
  | sweepExpired count currentWindowCount => simpa [transition, waiterBound] using h
  | rollWindow => simpa [transition, waiterBound] using h
  | rotate => simpa [transition, waiterBound] using h
  | acquireInitializer actor => simpa [transition, waiterBound] using h
  | releaseInitializer actor => simpa [transition, waiterBound] using h
  | acquireStartWorker actor => simpa [transition, waiterBound] using h
  | releaseStartWorker actor => simpa [transition, waiterBound] using h
  | commitColdRuntime actor version => simpa [transition, waiterBound] using h
  | remoteRuntimeCommit version => simpa [transition, waiterBound] using h
  | staleExclusiveRollback actor => simpa [transition, waiterBound] using h
  | retrySharedRuntime actor version => simpa [transition, waiterBound] using h
  | chargeStableQuota => simpa [transition, waiterBound] using h
theorem workerBound_transition (s : State) (action : Action) (h : workerBound s) :
    workerBound (transition s action) := by
  cases action with
  | acquireStartWorker actor =>
      unfold workerBound at h ⊢
      by_cases hAcquire : s.processAlive = true ∧
          s.activeStartWorkers < s.startWorkerLimit
      · simp [transition, hAcquire]
        omega
      · simpa [transition, hAcquire] using h
  | releaseStartWorker actor =>
      unfold workerBound at h ⊢
      by_cases hRelease : s.activeStartWorkers > 0
      · simp [transition, hRelease]
        omega
      · simpa [transition, hRelease] using h
  | crashProcess => simp [transition, workerBound]
  | restartProcess => simp [transition, workerBound]
  | claim actor observedGeneration => simpa [transition, workerBound] using h
  | beginWait actor observedGeneration kind => simpa [transition, workerBound, addWaiter] using h
  | wake actor => simpa [transition, workerBound] using h
  | timeout actor => simpa [transition, workerBound] using h
  | cancel actor => simpa [transition, workerBound] using h
  | settleMismatch actor reservationGeneration reservationWindow =>
      simpa [transition, workerBound] using h
  | settleSuccess actor reservationGeneration => simpa [transition, workerBound] using h
  | expire actor reservationGeneration reservationWindow =>
      simpa [transition, workerBound] using h
  | sweepExpired count currentWindowCount => simpa [transition, workerBound] using h
  | rollWindow => simpa [transition, workerBound] using h
  | rotate => simpa [transition, workerBound] using h
  | acquireInitializer actor => simpa [transition, workerBound] using h
  | releaseInitializer actor => simpa [transition, workerBound] using h
  | commitColdRuntime actor version => simpa [transition, workerBound] using h
  | remoteRuntimeCommit version => simpa [transition, workerBound] using h
  | staleExclusiveRollback actor => simpa [transition, workerBound] using h
  | retrySharedRuntime actor version => simpa [transition, workerBound] using h
  | chargeStableQuota => simpa [transition, workerBound] using h
theorem saturated_worker_acquire_stutters (s : State) (actor : Nat)
    (hFull : s.activeStartWorkers = s.startWorkerLimit) :
    transition s (.acquireStartWorker actor) = s := by
  have hNotAcquire :
      ¬(s.processAlive = true ∧ s.activeStartWorkers < s.startWorkerLimit) := by
    intro hAcquire
    omega
  simp [transition, hNotAcquire]

def repeatedSaturatedAcquire (s : State) (actor : Nat) : Nat → State
  | 0 => s
  | n + 1 => transition (repeatedSaturatedAcquire s actor n) (.acquireStartWorker actor)

theorem saturated_worker_can_stutter_for_any_finite_length
    (s : State) (actor : Nat) (n : Nat)
    (hFull : s.activeStartWorkers = s.startWorkerLimit) :
    repeatedSaturatedAcquire s actor n = s := by
  induction n with
  | zero => rfl
  | succ n ih =>
      simp [repeatedSaturatedAcquire, ih, saturated_worker_acquire_stutters, hFull]

theorem runtimePinned_transition (s : State) (action : Action) (h : runtimePinned s) :
    runtimePinned (transition s action) := by
  cases action with
  | commitColdRuntime actor version =>
      unfold runtimePinned at h ⊢
      by_cases hCommit : s.processAlive = true ∧ s.initializerHeld = true ∧
          s.runtimePlan = none ∧ version = s.publishedVersion
      · simp [transition, hCommit]
      · simpa [transition, hCommit] using h
  | remoteRuntimeCommit version =>
      unfold runtimePinned at h ⊢
      by_cases hCommit : s.runtimePlan = none ∧ version = s.publishedVersion
      · simp [transition, hCommit]
      · simpa [transition, hCommit] using h
  | claim actor observedGeneration => simpa [transition, runtimePinned] using h
  | beginWait actor observedGeneration kind => simpa [transition, runtimePinned, addWaiter] using h
  | wake actor => simpa [transition, runtimePinned] using h
  | timeout actor => simpa [transition, runtimePinned] using h
  | cancel actor => simpa [transition, runtimePinned] using h
  | settleMismatch actor reservationGeneration reservationWindow => simpa [transition, runtimePinned] using h
  | settleSuccess actor reservationGeneration => simpa [transition, runtimePinned] using h
  | expire actor reservationGeneration reservationWindow => simpa [transition, runtimePinned] using h
  | sweepExpired count currentWindowCount => simpa [transition, runtimePinned] using h
  | rollWindow => simpa [transition, runtimePinned] using h
  | rotate => simpa [transition, runtimePinned] using h
  | acquireInitializer actor => simpa [transition, runtimePinned] using h
  | releaseInitializer actor => simpa [transition, runtimePinned] using h
  | staleExclusiveRollback actor => simpa [transition, runtimePinned] using h
  | retrySharedRuntime actor version => simpa [transition, runtimePinned] using h
  | acquireStartWorker actor => simpa [transition, runtimePinned] using h
  | releaseStartWorker actor => simpa [transition, runtimePinned] using h
  | chargeStableQuota => simpa [transition, runtimePinned] using h
  | crashProcess => simpa [transition, runtimePinned] using h
  | restartProcess => simpa [transition, runtimePinned] using h

theorem transition_preserves_invariant (s : State) (action : Action)
    (h : Invariant s) : Invariant (transition s action) := by
  rcases h with ⟨hBudget, hWaiters, hWorkers, hRuntime⟩
  exact ⟨budgetSafe_transition s action hBudget,
    waiterBound_transition s action hWaiters,
    workerBound_transition s action hWorkers,
    runtimePinned_transition s action hRuntime⟩

inductive Reachable : State → Prop where
  | initial {s : State} (h : Initial s) : Reachable s
  | next {before after : State} {action : Action}
      (hBefore : Reachable before) (hStep : Step before action after) : Reachable after

theorem all_reachable_states_preserve_invariant {s : State} (h : Reachable s) :
    Invariant s := by
  induction h with
  | initial hInitial => exact initial_invariant hInitial
  | next hBefore hStep ih =>
      rw [← hStep]
      exact transition_preserves_invariant _ _ ih

inductive AdmissionDecision where
  | reserve
  | wait
  | busy
  | cooldown
  | rotated
  deriving DecidableEq, Repr

def decideAdmission (s : State) (observedGeneration : Nat) : AdmissionDecision :=
  if observedGeneration ≠ s.generation then .rotated
  else if s.failedCurrentWindow ≥ failureLimit then .cooldown
  else if s.pending + s.failedCurrentWindow < failureLimit then .reserve
  else if s.waiters < waiterLimit then .wait
  else .busy

theorem pending_saturation_waits_instead_of_cooldown
    (s : State) (hFailures : s.failedCurrentWindow < failureLimit)
    (hFull : s.pending + s.failedCurrentWindow ≥ failureLimit)
    (hWaiterRoom : s.waiters < waiterLimit) :
    decideAdmission s s.generation = .wait := by
  have hNotFailed : ¬ failureLimit ≤ s.failedCurrentWindow := by omega
  have hNotReserve : ¬ s.pending + s.failedCurrentWindow < failureLimit := by omega
  simp [decideAdmission, hNotFailed, hNotReserve, hWaiterRoom]

theorem exhausted_failures_return_cooldown (s : State) :
    s.failedCurrentWindow ≥ failureLimit →
      decideAdmission s s.generation = .cooldown := by
  intro hFailures
  simp [decideAdmission, hFailures]

theorem full_waiter_bound_returns_busy
    (s : State) (hFailures : s.failedCurrentWindow < failureLimit)
    (hBudgetFull : s.pending + s.failedCurrentWindow ≥ failureLimit)
    (hWaitersFull : s.waiters ≥ waiterLimit) :
    decideAdmission s s.generation = .busy := by
  have hNotFailed : ¬ failureLimit ≤ s.failedCurrentWindow := by omega
  have hNotReserve : ¬ s.pending + s.failedCurrentWindow < failureLimit := by omega
  have hNotWait : ¬ s.waiters < waiterLimit := by omega
  simp [decideAdmission, hNotFailed, hNotReserve, hNotWait]

theorem beginWait_preserves_budget_and_quotas
    (s : State) (actor observedGeneration : Nat) (kind : WaitKind) :
    let after := transition s (.beginWait actor observedGeneration kind)
    after.pending = s.pending ∧
    after.failedCurrentWindow = s.failedCurrentWindow ∧
    after.attemptQuota = s.attemptQuota ∧
    after.principalQuota = s.principalQuota := by
  simp [transition, addWaiter]

theorem claim_preserves_quotas (s : State) (actor observedGeneration : Nat) :
    (transition s (.claim actor observedGeneration)).attemptQuota = s.attemptQuota ∧
      (transition s (.claim actor observedGeneration)).principalQuota = s.principalQuota := by
  simp [transition]

theorem wake_preserves_quotas (s : State) (actor : Nat) :
    (transition s (.wake actor)).attemptQuota = s.attemptQuota ∧
      (transition s (.wake actor)).principalQuota = s.principalQuota := by
  simp [transition]

theorem internal_claim_retry_does_not_recharge_identity_quotas
    (s : State) (actor observedGeneration : Nat) :
    let afterWait := transition s (.beginWait actor observedGeneration .capacity)
    let afterWake := transition afterWait (.wake actor)
    let afterRetry := transition afterWake (.claim actor observedGeneration)
    afterRetry.attemptQuota = s.attemptQuota ∧
      afterRetry.principalQuota = s.principalQuota := by
  simp [transition, addWaiter]

theorem claim_after_rotation_cannot_reserve_for_new_generation
    (s : State) (actor : Nat) :
    let afterRotation := transition s .rotate
    let afterClaim := transition afterRotation (.claim actor s.generation)
    afterClaim.generation = s.generation + 1 ∧ afterClaim.pending = 0 ∧
      afterClaim.failedCurrentWindow = 0 := by
  have hGeneration : s.generation ≠ s.generation + 1 := by omega
  simp [transition, hGeneration]

theorem old_window_expiry_releases_pending_without_current_failure
    (s : State) (actor originalWindow : Nat) (hPending : 0 < s.pending)
    (hOldWindow : originalWindow ≠ s.window) :
    let after := transition s (.expire actor s.generation originalWindow)
    after.pending + after.failedCurrentWindow ≤ s.pending + s.failedCurrentWindow := by
  simp [transition, hPending, hOldWindow]

theorem current_window_expiry_preserves_spent_budget
    (s : State) (actor : Nat) (hPending : 0 < s.pending) :
    let after := transition s (.expire actor s.generation s.window)
    after.pending + after.failedCurrentWindow = s.pending + s.failedCurrentWindow := by
  simp [transition, hPending]
  omega

theorem roll_window_preserves_pending (s : State) :
    (transition s .rollWindow).pending = s.pending := by
  rfl

theorem cold_runtime_commit_pins_the_published_plan
    (s : State) (actor : Nat) (hAlive : s.processAlive = true)
    (hHeld : s.initializerHeld = true) (hCold : s.runtimePlan = none) :
    (transition s (.commitColdRuntime actor s.publishedVersion)).runtimePlan =
      some s.publishedVersion := by
  simp [transition, hAlive, hHeld, hCold]

theorem stale_exclusive_loser_releases_gate_and_keeps_runtime
    (s : State) (actor : Nat) (hAlive : s.processAlive = true)
    (hHeld : s.initializerHeld = true)
    (hRuntime : s.runtimePlan = some s.publishedVersion) :
    let after := transition s (.staleExclusiveRollback actor)
    after.runtimePlan = s.runtimePlan ∧ after.initializerHeld = false := by
  simp [transition, hAlive, hHeld, hRuntime]

theorem remote_runtime_wins_cold_start_race
    (s : State) (actor : Nat) (hAlive : s.processAlive = true)
    (hCold : s.runtimePlan = none) (hGateFree : s.initializerHeld = false) :
    let afterAcquire := transition s (.acquireInitializer actor)
    let afterRemote := transition afterAcquire (.remoteRuntimeCommit s.publishedVersion)
    let afterRollback := transition afterRemote (.staleExclusiveRollback actor)
    let afterRetry := transition afterRollback (.retrySharedRuntime actor s.publishedVersion)
    afterRetry.runtimePlan = some s.publishedVersion ∧ afterRetry.initializerHeld = false := by
  simp [transition, hAlive, hCold, hGateFree]

theorem crash_preserves_durable_budget_and_runtime (s : State) :
    let after := transition s .crashProcess
    after.pending = s.pending ∧
    after.failedCurrentWindow = s.failedCurrentWindow ∧
    after.runtimePlan = s.runtimePlan := by
  simp [transition]

end SATAccessCodeStart.Operational
