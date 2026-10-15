namespace SatFinishScore
structure Range where
  low : Nat
  high : Nat
  deriving DecidableEq, Repr
structure Conversion where
  revision : Nat
  rw : Option Range
  math : Option Range
  total : Option Range
  deriving DecidableEq, Repr
/-- Raw is an opaque identity of the entire raw report. Conversion arithmetic
is delegated to the existing satconvert proof/tests, not proved here. -/
structure Report where
  raw : Option Nat
  conversion : Option Conversion
  snapshot : Option Nat
  released : Bool
  deriving DecidableEq, Repr
/-- One pointer observation followed by immutable revision lookup.
Unavailable conversion and policy read failure are distinct. -/
inductive Observation where
  | absent
  | active (resolve : Nat → Option Conversion)
  | failed
def overlay (r : Report) (o : Observation) : Report :=
  match r.raw with
  | none => r
  | some raw =>
    match o with
    | .absent => r
    | .active f => { r with conversion := f raw }
    | .failed => { r with conversion := none }
inductive Gate | open | closed | failed
def receipt (r : Report) : Report :=
  { r with raw := none, conversion := none, snapshot := none }
def project (r : Report) (g : Gate) : Option Report :=
  if r.released then
    match g with
    | .open => some { r with snapshot := none }
    | .closed => some (receipt r)
    | .failed => none
  else some (receipt r)
def finish (r : Report) (o : Observation) (g : Gate) := project (overlay r o) g
def bootstrap (r : Report) (o : Observation) (g : Gate) := project (overlay r o) g
structure Ticket where
  attempt : Nat
  report : Report
  deriving DecidableEq
structure Response where
  ticket : Ticket
  observed : Observation
  gate : Gate
  body : Option Report
structure State where
  stored : Nat → Option Report
  ready : Nat → Option Ticket
  committedReads : List Ticket
  responses : List Response
  policy : Observation
def set {α : Type} (f : Nat → Option α) (id : Nat) (v : Option α) :=
  fun other => if other = id then v else f other
/-- Arbitrary pre-existing durable rows and policies, no in-flight requests. -/
def Init (s : State) : Prop :=
  (∀ id, s.ready id = none) ∧ s.committedReads = [] ∧ s.responses = []
def commitState (s : State) (actor attempt : Nat) (candidate : Report) : State :=
  let r := (s.stored attempt).getD candidate
  let t := Ticket.mk attempt r
  { s with stored := set s.stored attempt (some r), ready := set s.ready actor (some t), committedReads := t :: s.committedReads }

/-- Arbitrary request actors and interleavings. Commit atomicity is an explicit
SQL refinement obligation. Replay loads existing data rather than resealing.
Repair may change rows after a request took its committed read snapshot. -/
inductive Step : State → State → Prop
  | commit (s : State) (actor attempt : Nat) (candidate : Report) :
      Step s (commitState s actor attempt candidate)
  | respond (s : State) (actor : Nat) (t : Ticket) (g : Gate) :
      s.ready actor = some t →
      Step s { s with ready := set s.ready actor none, responses := { ticket := t, observed := s.policy, gate := g, body := finish t.report s.policy g } :: s.responses }
  | publish (s : State) (o : Observation) : Step s { s with policy := o }
  | crash (s : State) (actor : Nat) : Step s { s with ready := set s.ready actor none }
  | repair (s : State) (attempt : Nat) (r : Report) :
      Step s { s with stored := set s.stored attempt (some r) }
  /-- Abort, rejected requests, backoff and ACK loss stutter; no liveness claim. -/
  | failure (s : State) : Step s s
inductive Reachable : State → Prop
  | initial (s : State) : Init s → Reachable s
  | next {s s' : State} : Reachable s → Step s s' → Reachable s'
def Invariant (s : State) : Prop :=
  (∀ actor t, s.ready actor = some t → t ∈ s.committedReads) ∧
  (∀ r ∈ s.responses, r.ticket ∈ s.committedReads ∧
    r.body = bootstrap r.ticket.report r.observed r.gate)
end SatFinishScore
