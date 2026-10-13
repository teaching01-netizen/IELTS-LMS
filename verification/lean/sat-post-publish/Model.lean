import Lean

namespace SATPostPublish

inductive Scope where
  | full
  | readingWriting
  | math
  deriving DecidableEq, Repr

structure Target where
  examId : Nat
  versionId : Nat
  versionNumber : Nat
  scope : Scope
  deriving DecidableEq, Repr

inductive ShellProjection where
  | loading
  | ready
  | noDraft
  | missing
  | forbidden
  | error
  deriving DecidableEq, Repr

inductive PublishOutcome where
  | idle
  | pending
  | committed
  | acknowledged
  | rejected
  | unknown
  deriving DecidableEq, Repr

inductive ReadState where
  | idle
  | pending
  | succeeded
  | failed
  | held
  deriving DecidableEq, Repr

structure State where
  examId : Nat
  durableCurrent : Option Target
  committedTarget : Option Target
  releaseProjection : Option Target
  shell : ShellProjection
  outcome : PublishOutcome
  readState : ReadState
  sheetMounted : Bool
  sheetOpen : Bool
  sheetInstance : Nat
  receipt : Option Target
  roomTarget : Option Target
  openDraftPosts : Nat
  deriving DecidableEq, Repr

inductive Action where
  | openSheet
  | beginPublish
  | commit (target : Target)
  | acknowledge (target : Target)
  | rejectPublish
  | loseAcknowledgment
  | malformedAcknowledgment
  | beginReleaseRead
  | releaseReadSucceeded (projection : Option Target)
  | releaseReadFailed
  | releaseReadHeld
  | shellAnswered (projection : ShellProjection)
  | remotePublish (target : Target)
  | done
  | createRoom
  | reload
  | openDraft
  | changeExam (examId : Nat)
  deriving DecidableEq, Repr

def initialState (examId : Nat) (shell : ShellProjection) (release : Option Target) : State :=
  { examId := examId
    durableCurrent := release
    committedTarget := none
    releaseProjection := release
    shell := shell
    outcome := .idle
    readState := .idle
    sheetMounted := false
    sheetOpen := false
    sheetInstance := 0
    receipt := none
    roomTarget := none
    openDraftPosts := 0 }

/-- Startup may be loading, ready, no-draft, missing, forbidden, or errored.
    Durable publication state and a cached release projection are independent. -/
def Init (s : State) : Prop :=
  s.committedTarget = none ∧
  s.outcome = .idle ∧
  s.readState = .idle ∧
  s.sheetMounted = false ∧
  s.sheetOpen = false ∧
  s.sheetInstance = 0 ∧
  s.receipt = none ∧
  s.roomTarget = none ∧
  s.openDraftPosts = 0

def step (s : State) : Action → State
  | .openSheet =>
      if s.sheetMounted then
        { s with sheetOpen := true }
      else
        { s with sheetMounted := true, sheetOpen := true, sheetInstance := s.sheetInstance + 1 }
  | .beginPublish =>
      if s.sheetOpen then
        { s with outcome := .pending, committedTarget := none }
      else s
  | .commit target =>
      if s.outcome = .pending ∧ target.examId = s.examId then
        { s with durableCurrent := some target, committedTarget := some target, outcome := .committed }
      else s
  | .acknowledge target =>
      if s.outcome = .committed ∧ s.committedTarget = some target ∧ target.examId = s.examId then
        { s with outcome := .acknowledged, receipt := some target }
      else
        { s with outcome := .unknown }
  | .rejectPublish => { s with outcome := .rejected }
  | .loseAcknowledgment => { s with outcome := .unknown }
  | .malformedAcknowledgment => { s with outcome := .unknown }
  | .beginReleaseRead => { s with readState := .pending }
  | .releaseReadSucceeded projection => { s with readState := .succeeded, releaseProjection := projection }
  | .releaseReadFailed => { s with readState := .failed }
  | .releaseReadHeld => { s with readState := .held }
  | .shellAnswered projection => { s with shell := projection }
  | .remotePublish target =>
      if target.examId = s.examId then { s with durableCurrent := some target } else s
  | .done => { s with sheetMounted := false, sheetOpen := false }
  | .createRoom =>
      let target := match s.receipt with
        | some receipt => some receipt
        | none => s.releaseProjection
      { s with roomTarget := target }
  | .reload =>
      { s with
        releaseProjection := none
        shell := .loading
        outcome := .idle
        readState := .idle
        committedTarget := none
        sheetMounted := false
        sheetOpen := false
        receipt := none
        roomTarget := none }
  | .openDraft => { s with shell := .loading, openDraftPosts := s.openDraftPosts + 1 }
  | .changeExam examId =>
      { s with
        examId := examId
        releaseProjection := none
        committedTarget := none
        shell := .loading
        outcome := .idle
        readState := .idle
        sheetMounted := false
        sheetOpen := false
        receipt := none
        roomTarget := none
        openDraftPosts := 0 }

def Step (s : State) (action : Action) (next : State) : Prop :=
  next = step s action

inductive Reachable : State → Prop where
  | initial {s : State} (h : Init s) : Reachable s
  | next {s next : State} {action : Action}
      (hReachable : Reachable s) (hStep : Step s action next) : Reachable next

def ReceiptSound (s : State) : Prop :=
  ∀ target, s.receipt = some target → target.examId = s.examId

def successVisible (s : State) : Prop :=
  s.sheetOpen = true ∧ s.outcome = .acknowledged ∧ s.receipt.isSome = true

end SATPostPublish
