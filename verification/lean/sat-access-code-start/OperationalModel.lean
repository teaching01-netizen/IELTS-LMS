import Lean

namespace SATAccessCodeStart.Operational

def failureLimit : Nat := 200
def waiterLimit : Nat := 600
def attemptQuotaLimit : Nat := 5
def principalQuotaLimit : Nat := 20

inductive WaitKind where
  | startWorker
  | initializer
  | capacity
  deriving DecidableEq, Repr

inductive Action where
  | claim (actor observedGeneration : Nat)
  | beginWait (actor observedGeneration : Nat) (kind : WaitKind)
  | wake (actor : Nat)
  | timeout (actor : Nat)
  | cancel (actor : Nat)
  | settleMismatch (actor reservationGeneration reservationWindow : Nat)
  | settleSuccess (actor reservationGeneration : Nat)
  | expire (actor reservationGeneration reservationWindow : Nat)
  | sweepExpired (count currentWindowCount : Nat)
  | rollWindow
  | rotate
  | acquireStartWorker (actor : Nat)
  | releaseStartWorker (actor : Nat)
  | acquireInitializer (actor : Nat)
  | releaseInitializer (actor : Nat)
  | commitColdRuntime (actor version : Nat)
  | remoteRuntimeCommit (version : Nat)
  | staleExclusiveRollback (actor : Nat)
  | retrySharedRuntime (actor version : Nat)
  | chargeStableQuota
  | crashProcess
  | restartProcess
  deriving DecidableEq, Repr

structure State where
  generation : Nat
  window : Nat
  pending : Nat
  failedCurrentWindow : Nat
  waiters : Nat
  activeStartWorkers : Nat
  startWorkerLimit : Nat
  initializerHeld : Bool
  processAlive : Bool
  runtimePlan : Option Nat
  publishedVersion : Nat
  attemptQuota : Nat
  principalQuota : Nat
  deriving Repr

def emptyState : State :=
  { generation := 0
    window := 0
    pending := 0
    failedCurrentWindow := 0
    waiters := 0
    activeStartWorkers := 0
    startWorkerLimit := 24
    initializerHeld := false
    processAlive := true
    runtimePlan := none
    publishedVersion := 0
    attemptQuota := 0
    principalQuota := 0 }
def addWaiter (s : State) : State :=
  { s with waiters := if s.waiters < waiterLimit then s.waiters + 1 else s.waiters }

def canBeginWait (s : State) (observedGeneration : Nat) (kind : WaitKind) : Bool :=
  s.processAlive && match kind with
  | .startWorker => decide (s.activeStartWorkers ≥ s.startWorkerLimit)
  | .initializer => s.initializerHeld
  | .capacity =>
      decide (observedGeneration = s.generation) &&
      decide (s.failedCurrentWindow < failureLimit) &&
      decide (s.pending > 0) &&
      decide (s.pending + s.failedCurrentWindow ≥ failureLimit)

def transition (s : State) : Action → State
  | .claim _ observedGeneration =>
      { s with pending := if observedGeneration = s.generation ∧
          s.failedCurrentWindow < failureLimit ∧
          s.pending + s.failedCurrentWindow < failureLimit then s.pending + 1 else s.pending }
  | .beginWait _ observedGeneration kind =>
      { s with waiters := if canBeginWait s observedGeneration kind then
          (addWaiter s).waiters else s.waiters }
  | .acquireStartWorker _ =>
      { s with activeStartWorkers := if s.processAlive = true ∧
          s.activeStartWorkers < s.startWorkerLimit then s.activeStartWorkers + 1 else s.activeStartWorkers }
  | .releaseStartWorker _ =>
      { s with activeStartWorkers := if s.activeStartWorkers > 0 then
          s.activeStartWorkers - 1 else s.activeStartWorkers }
  | .wake _ =>
      { s with waiters := if s.processAlive = true ∧ s.waiters > 0 then s.waiters - 1 else s.waiters }
  | .timeout _ =>
      { s with waiters := if s.processAlive = true ∧ s.waiters > 0 then s.waiters - 1 else s.waiters }
  | .cancel _ =>
      { s with waiters := if s.processAlive = true ∧ s.waiters > 0 then s.waiters - 1 else s.waiters }
  | .settleMismatch _ reservationGeneration reservationWindow =>
      { s with
        pending := if reservationGeneration = s.generation ∧ s.pending > 0 then s.pending - 1 else s.pending
        failedCurrentWindow := if (reservationGeneration = s.generation ∧ s.pending > 0) ∧
            reservationWindow = s.window then s.failedCurrentWindow + 1 else s.failedCurrentWindow }
  | .settleSuccess _ reservationGeneration =>
      { s with pending := if reservationGeneration = s.generation ∧ s.pending > 0 then
          s.pending - 1 else s.pending }
  | .expire _ reservationGeneration reservationWindow =>
      { s with
        pending := if reservationGeneration = s.generation ∧ s.pending > 0 then s.pending - 1 else s.pending
        failedCurrentWindow := if (reservationGeneration = s.generation ∧ s.pending > 0) ∧
            reservationWindow = s.window then s.failedCurrentWindow + 1 else s.failedCurrentWindow }
  | .sweepExpired count currentWindowCount =>
      { s with
        pending := if count ≤ s.pending ∧ currentWindowCount ≤ count then s.pending - count else s.pending
        failedCurrentWindow := if count ≤ s.pending ∧ currentWindowCount ≤ count then
            s.failedCurrentWindow + currentWindowCount else s.failedCurrentWindow }
  | .rollWindow => { s with window := s.window + 1, failedCurrentWindow := 0 }
  | .rotate => { s with generation := s.generation + 1, pending := 0, failedCurrentWindow := 0 }
  | .acquireInitializer _ =>
      { s with initializerHeld := if s.processAlive = true ∧ s.runtimePlan = none ∧
          s.initializerHeld = false then true else s.initializerHeld }
  | .releaseInitializer _ => { s with initializerHeld := false }
  | .commitColdRuntime _ version =>
      { s with runtimePlan := if s.processAlive = true ∧ s.initializerHeld = true ∧
          s.runtimePlan = none ∧ version = s.publishedVersion then some version else s.runtimePlan }
  | .remoteRuntimeCommit version =>
      { s with runtimePlan := if s.runtimePlan = none ∧ version = s.publishedVersion then some version else s.runtimePlan }
  | .staleExclusiveRollback _ =>
      { s with initializerHeld := if s.processAlive = true ∧ s.initializerHeld = true ∧
          s.runtimePlan.isSome then false else s.initializerHeld }
  | .retrySharedRuntime _ _ => s
  | .chargeStableQuota =>
      { s with attemptQuota := s.attemptQuota + 1, principalQuota := s.principalQuota + 1 }
  | .crashProcess =>
      { s with waiters := 0, activeStartWorkers := 0, initializerHeld := false, processAlive := false }
  | .restartProcess =>
      { s with waiters := 0, activeStartWorkers := 0, initializerHeld := false, processAlive := true }

def Step (before : State) (action : Action) (after : State) : Prop :=
  transition before action = after

def budgetSafe (s : State) : Prop :=
  s.pending + s.failedCurrentWindow ≤ failureLimit

def waiterBound (s : State) : Prop :=
  s.waiters ≤ waiterLimit
def workerBound (s : State) : Prop :=
  s.activeStartWorkers ≤ s.startWorkerLimit

def runtimePinned (s : State) : Prop :=
  s.runtimePlan = none ∨ s.runtimePlan = some s.publishedVersion

def Initial (s : State) : Prop :=
  budgetSafe s ∧ waiterBound s ∧ workerBound s ∧ runtimePinned s

def Invariant (s : State) : Prop :=
  budgetSafe s ∧ waiterBound s ∧ workerBound s ∧ runtimePinned s
end SATAccessCodeStart.Operational
