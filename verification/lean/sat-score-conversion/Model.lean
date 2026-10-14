/-!
# Global SAT score conversion: operational model

Models `internal/satscoring` + `internal/satconvert` (migration 0087): editable
drafts, immutable published revisions, a singleton active pointer, and the
read-time resolution of every released result against the active revision.

What is modelled, and where the model is generous:

* The publish transaction is ONE atomic step. That abstraction rests on
  `SELECT ... FROM sat_score_conversion_active WHERE id = 1 FOR UPDATE` taking the
  pointer row lock inside the same InnoDB transaction as the revision update and
  the pointer update (`satscoring/service.go` `Publish`). It is an obligation on the
  database, validated by `TestConcurrentPublishOnSameBaseOneWins`, not proved here.
* Failure (aborted transaction, crash before commit, lost ACK, rejected request) is
  one unconditional stutter step: a failed or crashed publish leaves no trace.
* Content is the policy tables; `Content.resolve` is the pure lookup
  (`satconvert.Content.Resolve`). Scores are points (the 1D range form is not modelled).
* Draft validation is the abstract predicate `Publishable` (every table complete and
  valid); the Go validator is reviewed against it, not mechanized.
* Time, audit rows, checksums and the revision cache are out of the model (see
  ASSUMPTIONS.md).
-/

namespace SatScoreConversion

/-- 200–800 in steps of 10 (`satconvert.checkScore`). -/
abbrev ValidScore (n : Nat) : Prop := 200 ≤ n ∧ n ≤ 800 ∧ n % 10 = 0

/-- One policy table: exact operational dimensions and a cell lookup (`none` = empty). -/
structure Table where
  m1Ops : Nat
  m2Ops : Nat
  cell : Nat → Nat → Option Nat

/-- The tables assigned to one route (profiles); the first exact-dimension match wins. -/
structure Content where
  tables : List Table

/-- Lookup by exact operational counts and in-range raw scores; anything else is `none`. -/
def Content.resolve (c : Content) (a b m1 m2 : Nat) : Option Nat :=
  match c.tables.find? (fun t => t.m1Ops == a && t.m2Ops == b) with
  | none => none
  | some t =>
    if m1 ≤ a ∧ m2 ≤ b then
      match t.cell m1 m2 with
      | none => none
      | some v => if ValidScore v then some v else none
    else none

/-- Publishable: at least one table, and every table is complete with valid scores. -/
def Publishable (c : Content) : Prop :=
  c.tables ≠ [] ∧
    ∀ t ∈ c.tables, ∀ i j, i ≤ t.m1Ops → j ≤ t.m2Ops →
      ∃ v, t.cell i j = some v ∧ ValidScore v

inductive Status | draft | published
  deriving DecidableEq

structure Rev where
  status : Status
  /-- Revision number; meaningful once published. -/
  num : Nat
  base : Option Nat
  content : Content
  version : Nat

/-- The persisted raw scores of one released classroom result. -/
structure Raw where
  m1Ops : Nat
  m2Ops : Nat
  m1 : Nat
  m2 : Nat

/-- Constructors used by the transitions, with their projections as simp lemmas. -/
def Rev.fresh (base : Option Nat) (c : Content) : Rev :=
  { status := .draft, num := 0, base := base, content := c, version := 1 }

def Rev.edited (d : Rev) (c : Content) : Rev :=
  { d with content := c, version := d.version + 1 }

def Rev.published (d : Rev) (n : Nat) : Rev :=
  { d with status := .published, num := n }

@[simp] theorem Rev.fresh_status (b c) : (Rev.fresh b c).status = .draft := rfl
@[simp] theorem Rev.edited_status (d c) : (Rev.edited d c).status = d.status := rfl
@[simp] theorem Rev.published_status (d n) : (Rev.published d n).status = .published := rfl
@[simp] theorem Rev.published_num (d n) : (Rev.published d n).num = n := rfl
@[simp] theorem Rev.published_base (d n) : (Rev.published d n).base = d.base := rfl
@[simp] theorem Rev.published_content (d n) : (Rev.published d n).content = d.content := rfl

structure Result where
  raw : Raw
  /-- `classroomRaw` is present (the existing release gates passed). -/
  released : Bool
  /-- A score frozen into the payload by the pre-0087 per-exam converter. -/
  legacy : Option Nat

structure St where
  revs : Nat → Option Rev
  active : Option Nat
  nextNum : Nat
  results : Nat → Option Result

def upd {α : Type} (f : Nat → Option α) (k : Nat) (v : α) : Nat → Option α :=
  fun i => if i = k then some v else f i

@[simp] theorem upd_same {α : Type} (f : Nat → Option α) (k : Nat) (v : α) :
    upd f k v k = some v := by simp [upd]

theorem upd_other {α : Type} (f : Nat → Option α) (k : Nat) (v : α) (i : Nat) (h : i ≠ k) :
    upd f k v i = f i := by simp [upd, h]

inductive Act
  | createDraft (id : Nat) (c : Content)
  | save (id expected : Nat) (c : Content)
  | publish (id : Nat)
  | seal (rid : Nat) (r : Result)
  | release (rid : Nat)

def Init (s : St) : Prop :=
  (∀ i, s.revs i = none) ∧ s.active = none ∧ s.nextNum = 1 ∧ (∀ i, s.results i = none)

/-- Nondeterministic transitions. `stutter` covers rejection, abort, crash and lost ACK. -/
inductive Step : St → Act → St → Prop
  /-- A draft copies some content and is based on the CURRENT active revision. -/
  | createDraft (s : St) (id : Nat) (c : Content) :
      s.revs id = none →
      Step s (.createDraft id c) { s with revs := upd s.revs id (Rev.fresh s.active c) }
  /-- Optimistic lock: the save applies only to a draft at the expected version. -/
  | save (s : St) (id expected : Nat) (c : Content) (d : Rev) :
      s.revs id = some d → d.status = .draft → d.version = expected →
      Step s (.save id expected c) { s with revs := upd s.revs id (d.edited c) }
  /-- Publish: pointer row locked, draft publishable, base equal to the active revision. -/
  | publish (s : St) (id : Nat) (d : Rev) :
      s.revs id = some d → d.status = .draft → d.base = s.active → Publishable d.content →
      Step s (.publish id)
        { s with revs := upd s.revs id (d.published s.nextNum), active := some id, nextNum := s.nextNum + 1 }
  /-- Re-publishing the active revision (a retry after a lost ACK) changes nothing. -/
  | republish (s : St) (id : Nat) (d : Rev) :
      s.revs id = some d → d.status = .published → s.active = some id →
      Step s (.publish id) s
  | sealResult (s : St) (rid : Nat) (r : Result) :
      s.results rid = none →
      Step s (.seal rid r) { s with results := upd s.results rid r }
  | releaseResult (s : St) (rid : Nat) (r : Result) :
      s.results rid = some r →
      Step s (.release rid) { s with results := upd s.results rid { r with released := true } }
  | stutter (s : St) (a : Act) : Step s a s

inductive Reach : St → Prop
  | init (s : St) : Init s → Reach s
  | step (s s' : St) (a : Act) : Reach s → Step s a s' → Reach s'

/-- What a reader displays for a result: only released results show a score; with no
active revision the stored legacy score stays; otherwise the active revision decides. -/
def display (s : St) (r : Result) : Option Nat :=
  if r.released then
    match s.active with
    | none => r.legacy
    | some a =>
      match s.revs a with
      | none => none
      | some rev => rev.content.resolve r.raw.m1Ops r.raw.m2Ops r.raw.m1 r.raw.m2
  else none

end SatScoreConversion
