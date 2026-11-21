/-
SAT live settings: operational model of one exam save, room saves, protected
grants, and student observations.

This is the model the Lean theorems talk about. It is deliberately small:

* `Policy` is the four room-scoped settings plus their normalization rule
  (an answer key cannot be on while results are hidden).
* `St` is one exam's defaults and a total map of rooms. Each room carries its
  exam id, effective policy, revision, and closed flag.
* `St.examSave` is the exam-save cutover: it changes only the fields named by
  `Change`, only for scheduled/live rooms of the target exam, and leaves every
  other room alone. A change with no fields set is the production no-op early
  return.
* `St.roomSave` is one room-local optimistic-concurrency write. The expected
  revision must match the room's current revision, and a success advances it by
  exactly one.
* `St.grant` is a protected decision evaluated against the room's current
  policy. `Attempt.grant` is the already-admitted continuation: it keeps the
  admission snapshot.
* `Client.observe` is the student projection fence: a response older than the
  newest accepted revision is ignored.

Correspondence to the Go/SQL implementation, and every lock-order assumption,
is recorded in SPEC.md and TRACEABILITY.md. Kernel results apply to this model;
production code and deployment need their own evidence.
-/
namespace SatLiveSettings

structure Policy where
  retakes : Bool
  results : Bool
  keys : Bool
  pause : Bool
  deriving DecidableEq, Repr

/-- Creation/legacy default: nothing released, nothing paused. -/
def Policy.default : Policy := ⟨false, false, false, false⟩

/-- Hidden results force the PDF key off. Applied after every merge. -/
def Policy.norm (p : Policy) : Policy :=
  { p with keys := p.keys && p.results }

structure Change where
  retakes : Bool := false
  results : Bool := false
  keys : Bool := false
  pause : Bool := false
  deriving DecidableEq, Repr

/-- No room-scoped field changed: the exam save never reaches the rooms. -/
def Change.any (c : Change) : Bool :=
  c.retakes || c.results || c.keys || c.pause

/-- Merge only the changed fields into a room's current policy. -/
def Policy.apply (current defaults : Policy) (c : Change) : Policy :=
  { retakes := if c.retakes then defaults.retakes else current.retakes,
    results := if c.results then defaults.results else current.results,
    keys := if c.keys then defaults.keys else current.keys,
    pause := if c.pause then defaults.pause else current.pause }

structure Room where
  exam : Nat
  policy : Policy
  rev : Nat
  closed : Bool
  deriving DecidableEq, Repr

structure St where
  defaults : Policy
  examRev : Nat
  rooms : Nat → Room

/-- One exam save. `target` is the authoritative exam id resolved before the
transaction; rooms of another exam are untouched. Only open rooms participate.
The whole map update is atomic in the model. -/
def St.examSave (st : St) (target : Nat) (c : Change) (d : Policy) : St :=
  if c.any then
    let d' := Policy.norm d
    { defaults := d',
      examRev := st.examRev + 1,
      rooms := fun i =>
        let r := st.rooms i
        if r.closed then r
        else if r.exam = target then
          { r with
            policy := Policy.norm (Policy.apply r.policy d' c),
            rev := r.rev + 1 }
        else r }
  else st

/-- One room-local save with the room's revision as the fence. -/
def St.roomSave (st : St) (id : Nat) (p : Policy) (expected : Nat) : Option St :=
  if (st.rooms id).rev = expected then
    some { st with
      rooms := fun i =>
        if i = id then
          { st.rooms i with policy := Policy.norm p, rev := (st.rooms i).rev + 1 }
        else st.rooms i }
  else none

/-- A newly created room pins the exam defaults at creation. -/
def St.createRoom (st : St) (id exam : Nat) : St :=
  { st with
    rooms := fun i =>
      if i = id then
        { exam := exam, policy := Policy.norm st.defaults, rev := 1, closed := false }
      else st.rooms i }

/-- A protected decision uses the room's current effective policy. -/
def St.grant (st : St) (id : Nat) (field : Policy → Bool) : Bool :=
  field (st.rooms id).policy

/-- An admitted attempt owns an immutable snapshot. -/
structure Attempt where
  admitted : Bool
  snapshot : Policy
  deriving DecidableEq, Repr

/-- New attempts use the current policy; admitted attempts keep their snapshot. -/
def Attempt.grant (st : St) (id : Nat) (a : Attempt) (field : Policy → Bool) : Bool :=
  if a.admitted then field a.snapshot else st.grant id field

/-- What a student's tab currently shows. -/
structure Client where
  seen : Nat
  results : Bool
  keys : Bool
  pause : Bool
  deriving DecidableEq, Repr

/-- Fenced observation: an older revision cannot overwrite newer state. -/
def Client.observe (c : Client) (rev : Nat) (p : Policy) : Client :=
  if rev < c.seen then c
  else { seen := rev, results := p.results, keys := p.keys, pause := p.pause }

/-- The unfenced counterexample: apply every response, newest or not. -/
def Client.observeUnfenced (_c : Client) (rev : Nat) (p : Policy) : Client :=
  { seen := rev, results := p.results, keys := p.keys, pause := p.pause }

/-- A prepared export is keyed only when the serve-time policy still allows it
(the production `KeyedPDFAllowed` recheck). -/
def servedKeyed (serveTimeCheck preparedWithKey keyAllowedNow : Bool) : Bool :=
  if serveTimeCheck then preparedWithKey && keyAllowedNow else preparedWithKey

end SatLiveSettings
