import Model

namespace SATPostPublish.Counterexamples

structure LegacyClient where
  durableCommitted : Bool
  releaseReadFailed : Bool
  mutationReportedSuccess : Bool
  shellReady : Bool
  sheetMounted : Bool
  sheetSuccessVisible : Bool
  deriving DecidableEq, Repr

inductive LegacyAction where
  | openSheet
  | postCommits
  | releaseReadSucceeds
  | releaseReadFails
  | removeShell
  | publishContinuation
  deriving DecidableEq, Repr

def legacyInitial : LegacyClient :=
  { durableCommitted := false
    releaseReadFailed := false
    mutationReportedSuccess := false
    shellReady := true
    sheetMounted := false
    sheetSuccessVisible := false }

def legacyStep (s : LegacyClient) : LegacyAction → LegacyClient
  | .openSheet => { s with sheetMounted := true }
  | .postCommits => { s with durableCommitted := true }
  | .releaseReadSucceeds => { s with mutationReportedSuccess := true }
  | .releaseReadFails => { s with releaseReadFailed := true, mutationReportedSuccess := false }
  | .removeShell =>
      { s with shellReady := false, sheetMounted := false, sheetSuccessVisible := false }
  | .publishContinuation =>
      if s.sheetMounted then { s with sheetSuccessVisible := true } else s

def runLegacy (initial : LegacyClient) (trace : List LegacyAction) : LegacyClient :=
  trace.foldl legacyStep initial

def readFailureTrace : List LegacyAction := [.postCommits, .releaseReadFails]

theorem committed_post_can_be_reported_as_failure :
    let finalState := runLegacy legacyInitial readFailureTrace
    finalState.durableCommitted = true ∧
    finalState.releaseReadFailed = true ∧
    finalState.mutationReportedSuccess = false := by
  simp [runLegacy, readFailureTrace, legacyStep, legacyInitial]

def shellUnmountTrace : List LegacyAction :=
  [.openSheet, .postCommits, .releaseReadSucceeds, .removeShell, .publishContinuation]

theorem shell_removal_can_destroy_local_success_state :
    let finalState := runLegacy legacyInitial shellUnmountTrace
    finalState.durableCommitted = true ∧
    finalState.mutationReportedSuccess = true ∧
    finalState.sheetMounted = false ∧
    finalState.sheetSuccessVisible = false := by
  simp [runLegacy, shellUnmountTrace, legacyStep, legacyInitial]

end SATPostPublish.Counterexamples
