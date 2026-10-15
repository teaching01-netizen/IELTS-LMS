/-
Operational model of the fixed-Module-2 Module 1 threshold gate.

Go anchors (backend/go):
* `adaptive`        ↔ delivery/start_submit.go `chooseAdaptiveRoute` (none = validation error)
* `Shape.forced`    ↔ satpublish/plan.go `Shape.ForcedBranch`
* `gate`            ↔ terminalization/service.go `markModule1QualificationTx` (one section)
* `qualified`       ↔ satscoring/overlay.go `SectionQualified`
* `convert`         ↔ `convertClassroomScoresTx`, `satscoring.ApplyRevision`, `Impact`
                      (each: table lookup, then the gate)
* `Step`            ↔ the life of one result section: seal, read-time overlay under any
                      revision, degraded read, repair reseal.
-/
namespace SatModule1Gate

inductive Shape | full | m1Easy | m1Hard | m2Easy | m2Hard
  deriving DecidableEq, Repr

inductive Branch | lower | higher
  deriving DecidableEq, Repr

/-- `Shape.ForcedBranch`: the only Module 2 an M1-based single-branch shape allows. -/
def Shape.forced : Shape → Option Branch
  | .m1Easy => some .lower
  | .m1Hard => some .higher
  | _ => none

/-- `chooseAdaptiveRoute(raw, ops, policy)`; `none` is its validation error. -/
def adaptive (raw ops thr : Int) : Option Branch :=
  if 1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops then
    some (if thr ≤ raw then .higher else .lower)
  else none

/-- One `assessment_route_decisions` row as the gate reads it. `thr = none`: the
policy snapshot has no integer `minimumCorrectForHigher`. -/
structure Decision where
  raw : Int
  ops : Int
  thr : Option Int
  deriving DecidableEq, Repr

/-- `markModule1QualificationTx` for one section (post-fix). Input is the
section's plan shape and its LEFT-JOINed decision row (`none` = no row).
Result `none` = flag absent (`module1Qualified` not written). -/
def gate (s : Shape) (d : Option Decision) : Option Bool :=
  match s.forced with
  | none => none
  | some b =>
    match d with
    | some ⟨raw, ops, some thr⟩ => some (decide (adaptive raw ops thr = some b))
    | _ => some false

/-- `SectionQualified`: an absent flag qualifies. -/
def qualified (flag : Option Bool) : Bool := flag.getD true

/-- Every converter: `cell` is the table lookup (`Content.Resolve` /
`conv.Convert`) for some revision; the gate runs after it. -/
def convert (flag : Option Bool) (cell : Option Nat) : Option Nat :=
  if qualified flag then cell else none

/-- `satconvert.Total`: only when both sections converted. -/
def total (rw math : Option Nat) : Option Nat :=
  match rw, math with
  | some a, some b => some (a + b)
  | _, _ => none

/-- One result section. `shape`/`dec` are ghost copies of immutable DB facts
(published plan, route decision row) fixed at seal. -/
structure St where
  sealed : Bool
  shape : Shape
  dec : Option Decision
  flag : Option Bool
  shown : Option Nat

/-- Results written by this code start unsealed with nothing shown; the flag
and ghost fields are arbitrary (garbage allowed). -/
def Init (st : St) : Prop := st.sealed = false ∧ st.shown = none

inductive Step : St → St → Prop
  /-- materializeSATResult → classroomRawScoreTx, with the per-exam converter. -/
  | sealResult (st : St) (s : Shape) (d : Option Decision) (cell : Option Nat) :
      st.sealed = false →
      Step st { sealed := true, shape := s, dec := d, flag := gate s d, shown := convert (gate s d) cell }
  /-- Overlay → ApplyRevision for ANY active revision; stripConversion keeps the flag. -/
  | overlay (st : St) (cell : Option Nat) :
      st.sealed = true → Step st { st with shown := convert st.flag cell }
  /-- Unreadable revision: conversion stripped. -/
  | degrade (st : St) : Step st { st with shown := none }
  /-- RepairClassroomResults recomputes from the same immutable rows. -/
  | reseal (st : St) (cell : Option Nat) :
      st.sealed = true →
      Step st { st with flag := gate st.shape st.dec, shown := convert (gate st.shape st.dec) cell }

inductive Reachable : St → Prop
  | init (st : St) : Init st → Reachable st
  | step (st st' : St) : Reachable st → Step st st' → Reachable st'

end SatModule1Gate
