/-
SAT Practice Classroom: operational model of one section across many attempts.

`Mode.current` is a historical pre-fix implementation model, not the present
working tree. `Mode.corrected` abstracts the F1/F3 fixes, route-policy fence
0084, immutable-plan fence 0086, and exact classroom completion sequence. Each
step is treated as atomic; correspondence to the Go/SQL lock sections remains
a refinement obligation, not a Lean result.
-/
namespace SatClassroom

inductive Mode | current | corrected deriving DecidableEq, Repr
inductive Policy | adaptive | forceLower | forceHigher | staffSelects deriving DecidableEq, Repr
inductive Route | lower | higher deriving DecidableEq, Repr
/-- `satpublish.Plan` entry for the section. -/
inductive Shape | none | m1Easy | m1Hard | m2Easy | m2Hard deriving DecidableEq, Repr
inductive Basis | auto | staff deriving DecidableEq, Repr
inductive Outcome | committed | replayed | conflict | sealedRefused | notReady
  deriving DecidableEq, Repr

/-- Standalone Module 2 section: the attempt enters this branch directly. -/
def Shape.standalone : Shape → Option Route
  | .m2Easy => some .lower
  | .m2Hard => some .higher
  | _ => Option.none

/-- Base-entry section whose Module 2 branch is fixed by the plan. -/
def Shape.forced : Shape → Option Route
  | .m1Easy => some .lower
  | .m1Hard => some .higher
  | _ => Option.none

def Policy.forced : Policy → Option Route
  | .forceLower => some .lower
  | .forceHigher => some .higher
  | _ => none

/-- The scoring formula is abstract: only "high enough" matters for routing. -/
def adaptiveRoute (high : Bool) : Route := if high then .higher else .lower

/-- Route of an automatic close: plan branch, else forced policy, else score. -/
def autoRoute (pol : Policy) (plan : Shape) (high : Bool) : Route :=
  match plan.forced with
  | some r => r
  | none =>
    match pol.forced with
    | some r => r
    | none => adaptiveRoute high

/-- `nextModuleTx` at Module 1 close; `none` means wait for staff.
current: the plan override ran before the staff check (F1). -/
def routeAtClose : Mode → Policy → Shape → Bool → Option Route
  | .current, pol, plan, high =>
    match plan.forced with
    | some r => some r
    | none => if pol = .staffSelects then none else some (autoRoute pol plan high)
  | .corrected, pol, plan, high =>
    if pol = .staffSelects then none else some (autoRoute pol plan high)

/-! Migration 0084 fences the session policy; migration 0086 fences the
immutable per-section plan even for binaries that do not read it. -/
def planRouteOK (plan : Shape) (r : Route) : Prop :=
  match plan.standalone, plan.forced with
  | none, none => True
  | none, some fixed => fixed = r
  | some _, _ => False

def fenceOk (pol : Policy) (plan : Shape) (r : Route) (basis : Basis) : Bool :=
  let policyOK := match pol with
    | .staffSelects => basis = .staff
    | .adaptive => true
    | p => p.forced = some r
  let planOK := match plan.standalone, plan.forced with
    | none, none => true
    | none, some fixed => decide (fixed = r)
    | some _, _ => false
  policyOK && planOK

structure Att where
  started : Bool := false
  m1Open : Bool := false
  m1Closed : Bool := false
  writes : List Nat := []
  snapshot : Option (List Nat) := none
  decision : Option (Route × Basis) := none
  m2Opened : Option Route := none
  m2Closed : Bool := false
  sealed : Bool := false
  terminated : Bool := false
  scored : Bool := false
  released : Bool := false
  served : Option Route := none
  deriving Repr

/-- `AssignStaffRoute` (`staff_route.go`). current: sealed check before replay (F3). -/
def assign (mode : Mode) (pol : Policy) (a : Att) (r : Route) : Outcome × Att :=
  let commit := (Outcome.committed, { a with decision := some (r, .staff), m2Opened := some r })
  if pol ≠ .staffSelects ∨ a.m1Closed = false then (.notReady, a) else
  match mode with
  | .current =>
    if a.sealed || a.terminated then (.sealedRefused, a) else
    match a.decision with
    | some (d, _) => if d = r then (.replayed, a) else (.conflict, a)
    | none => commit
  | .corrected =>
    match a.decision with
    | some (d, _) => if d = r then (.replayed, a) else (.conflict, a)
    | none => if a.sealed || a.terminated then (.sealedRefused, a) else commit

/-- Completion gate (`ensureSATModuleTopologyTx` + `satExpectedSequence`). -/
def gate (plan : Shape) (a : Att) : Prop :=
  a.m2Closed = true ∧
  (∀ b, plan.standalone = some b → a.m2Opened = some b ∧ a.decision = none ∧ a.m1Open = false) ∧
  (plan.standalone = none → a.m1Closed = true ∧ ∃ r bs, a.decision = some (r, bs) ∧
    a.m2Opened = some r ∧ (plan.forced = none ∨ plan.forced = some r))

/-- Session creation (`PersistSATSession`). -/
def valid : Mode → Policy → Shape → Prop
  | .current, pol, plan => ∀ r, pol.forced = some r → plan.forced = none ∨ plan.forced = some r
  | .corrected, pol, plan =>
    (∀ r, pol.forced = some r → plan.forced = none ∨ plan.forced = some r) ∧
    (pol = .staffSelects → plan = .none)

inductive AStep (mode : Mode) (pol : Policy) (plan : Shape) : Att → Att → Prop
  | start (a : Att) : a.started = false →
      AStep mode pol plan a
        { a with started := true, m1Open := plan.standalone.isNone, m2Opened := plan.standalone }
  | save (a : Att) (n : Nat) : a.m1Open = true → a.m1Closed = false → a.terminated = false →
      AStep mode pol plan a { a with writes := n :: a.writes }
  | closeM1 (a : Att) (high : Bool) : a.m1Open = true → a.m1Closed = false → a.terminated = false →
      AStep mode pol plan a
        { a with m1Closed := true, snapshot := some a.writes,
                 decision := (routeAtClose mode pol plan high).map (·, Basis.auto),
                 m2Opened := routeAtClose mode pol plan high }
  /-- A binary that predates the route policy closes Module 1 adaptively (F7). -/
  | oldClose (a : Att) (high : Bool) : a.m1Open = true → a.m1Closed = false → a.terminated = false →
      (mode = .corrected → fenceOk pol plan (adaptiveRoute high) .auto = true) →
      AStep mode pol plan a
        { a with m1Closed := true, snapshot := some a.writes,
                 decision := some (adaptiveRoute high, .auto),
                 m2Opened := some (adaptiveRoute high) }
  | staff (a : Att) (r : Route) : AStep mode pol plan a (assign mode pol a r).2
  | closeM2 (a : Att) : a.m2Opened.isSome = true → a.m2Closed = false → a.terminated = false →
      AStep mode pol plan a { a with m2Closed := true }
  | complete (a : Att) : gate plan a → a.sealed = false → a.terminated = false →
      AStep mode pol plan a { a with sealed := true }
  /-- Proctor complete/terminate: sealed as terminated, no gate (F6). -/
  | terminate (a : Att) : a.sealed = false → AStep mode pol plan a { a with terminated := true }
  /-- Score failure is a stutter: the receipt stays (TC-15). -/
  | score (a : Att) : a.sealed = true → AStep mode pol plan a { a with scored := true }
  | release (a : Att) : a.sealed = true → a.scored = true →
      AStep mode pol plan a { a with released := true }
  | serve (a : Att) (r : Route) : a.m2Opened = some r → AStep mode pol plan a { a with served := some r }

structure World where
  pol : Policy
  plan : Shape
  att : Nat → Att

def World.init (pol : Policy) (plan : Shape) : World := ⟨pol, plan, fun _ => {}⟩

def World.set (w : World) (i : Nat) (a : Att) : World :=
  { w with att := fun j => if j = i then a else w.att j }

def Step (mode : Mode) (w w' : World) : Prop :=
  ∃ i a, AStep mode w.pol w.plan (w.att i) a ∧ w' = w.set i a

inductive Reachable (mode : Mode) : World → Prop
  | init (pol : Policy) (plan : Shape) : valid mode pol plan → Reachable mode (World.init pol plan)
  | step (w w' : World) : Reachable mode w → Step mode w w' → Reachable mode w'

end SatClassroom

namespace SatClassroom
@[simp] theorem World.set_pol (w : World) (i : Nat) (a : Att) : (w.set i a).pol = w.pol := rfl
@[simp] theorem World.set_plan (w : World) (i : Nat) (a : Att) : (w.set i a).plan = w.plan := rfl
@[simp] theorem World.set_att (w : World) (i j : Nat) (a : Att) :
    (w.set i a).att j = if j = i then a else w.att j := rfl
@[simp] theorem World.init_pol (p : Policy) (s : Shape) : (World.init p s).pol = p := rfl
@[simp] theorem World.init_plan (p : Policy) (s : Shape) : (World.init p s).plan = s := rfl
@[simp] theorem World.init_att (p : Policy) (s : Shape) (j : Nat) : (World.init p s).att j = {} := rfl
end SatClassroom
