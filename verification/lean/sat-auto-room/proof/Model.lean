import Lean

namespace SatAutoRoom

abbrev Key := Nat × Nat -- actor ID × operation key; both unbounded

inductive Scope where
  | full | rw | math
  deriving DecidableEq, Repr

def Covers (available need : Scope) : Prop := available = .full ∨ available = need

structure Release where
  payload : Nat -- opaque identity of effective content/config, NOT a hash implementation
  scope : Scope
  deriving DecidableEq, Repr

structure Draft where
  id : Nat
  revision : Nat
  payload : Nat
  parent : Option Nat
  deriving DecidableEq, Repr

structure Request where
  key : Key
  body : Nat -- injective identity of the entire hashed request, including fences
  scope : Scope
  expectedExam : Option Nat
  expectedDraft : Option (Option Nat)
  expectedRevision : Option Nat
  allowSeal : Bool
  deriving DecidableEq, Repr

structure Effect where
  body : Nat
  version : Nat
  payload : Nat
  scope : Scope
  deriving DecidableEq, Repr

structure State where
  examRevision : Nat
  draft : Option Draft
  current : Option Nat
  releases : Nat → Option Release
  receipts : Key → Option Effect
  rooms : Key → Option Effect
  schedules : Key → Option Nat
  counts : Key → Nat
  pending : Nat → Option Request
  preflight : Nat → Option Draft
  ack : Nat → Option Effect

def put {α β : Type} [DecidableEq α] (m : α → β) (k : α) (v : β) : α → β :=
  fun x => if x = k then v else m x

def initial (revision : Nat) (draft : Option Draft) (current : Option Nat)
    (releases : Nat → Option Release) : State :=
  ⟨revision, draft, current, releases, fun _ => none, fun _ => none,
    fun _ => none, fun _ => 0, fun _ => none, fun _ => none, fun _ => none⟩

-- Newly monitored operations have no prior effects. Arbitrary imported release
-- maps and draft data are allowed; recovery retains durable state via crash.
def Init (s : State) : Prop := ∃ revision draft current releases,
  s = initial revision draft current releases

def Fences (s : State) (r : Request) : Prop :=
  (∀ v, r.expectedExam = some v → s.examRevision = v) ∧
  (∀ v, r.expectedDraft = some v → s.draft.map Draft.id = v) ∧
  (∀ v d, r.expectedRevision = some v → s.draft = some d → d.revision = v)

def RequiredFences (r : Request) : Prop :=
  r.expectedExam.isSome = true ∧ r.expectedDraft.isSome = true ∧
  (∀ id, r.expectedDraft = some (some id) → r.expectedRevision.isSome = true)

-- Opaque validator. No claim that the Go validator implements this predicate.
abbrev Validator := Nat → Scope → Prop

inductive Selection (valid : Validator) (s : State) (actor : Nat) (r : Request) :
    Nat → Release → Bool → Prop where
  | reuse (id rel) (hc : s.current = some id) (hr : s.releases id = some rel)
      (cover : Covers rel.scope r.scope)
      (source : s.draft = none ∨ ∃ d, s.draft = some d ∧ d.revision = 0 ∧
        d.parent = some id ∧ d.payload = rel.payload) : Selection valid s actor r id rel false
  | publish (d) (hd : s.draft = some d) (freeze : r.allowSeal = true)
      (pre : s.preflight actor = some d) (ready : valid d.payload r.scope)
      (fresh : s.releases d.id = none) :
      Selection valid s actor r d.id ⟨d.payload, r.scope⟩ true

def effect (r : Request) (id : Nat) (rel : Release) : Effect :=
  ⟨r.body, id, rel.payload, r.scope⟩

-- One atomic DB commit; the separate maps are the receipt, link, schedule,
-- and durable effect count. Roster insertion belongs to the same SQL commit
-- but roster normalization/contents are outside these theorems.
def commit (s : State) (r : Request) (id : Nat) (rel : Release) (sealed : Bool) : State :=
  { s with
    examRevision := s.examRevision + if sealed then 1 else 0
    draft := if sealed then none else s.draft
    current := some id
    releases := put s.releases id (some rel)
    receipts := put s.receipts r.key (some (effect r id rel))
    rooms := put s.rooms r.key (some (effect r id rel))
    schedules := put s.schedules r.key (some id)
    counts := put s.counts r.key (s.counts r.key + 1) }

inductive Action where
  | invoke (actor : Nat) (request : Request)
  | inspect (actor : Nat)
  | save (actor expected payload : Nat)
  | reopen (actor id : Nat)
  | commit (actor : Nat)
  | replay (actor : Nat)
  | acknowledge (actor : Nat)
  | crash (actor : Nat)
  | abort (actor : Nat)

inductive Step (valid : Validator) : State → Action → State → Prop where
  | invoke (s actor r) (owner : r.key.1 = actor) :
      Step valid s (.invoke actor r) { s with pending := put s.pending actor (some r) }
  | inspect (s actor) :
      Step valid s (.inspect actor) { s with preflight := put s.preflight actor s.draft }
  | save (s actor d expected payload) (hd : s.draft = some d) (fence : d.revision = expected) :
      Step valid s (.save actor expected payload)
        { s with draft := some { d with revision := d.revision + 1, payload := payload } }
  | reopen (s actor id parent rel) (empty : s.draft = none)
      (hc : s.current = some parent) (hr : s.releases parent = some rel)
      (fresh : s.releases id = none) :
      Step valid s (.reopen actor id)
        { s with
          examRevision := s.examRevision + 1
          draft := some ⟨id, 0, rel.payload, some parent⟩ }
  | complete (s actor r id rel sealed) (pending : s.pending actor = some r)
      (absent : s.receipts r.key = none) (required : RequiredFences r) (fence : Fences s r)
      (selected : Selection valid s actor r id rel sealed) :
      Step valid s (.commit actor) (commit s r id rel sealed)
  | replay (s actor r e) (pending : s.pending actor = some r)
      (stored : s.receipts r.key = some e) (sameBody : e.body = r.body) :
      Step valid s (.replay actor) s
  | acknowledge (s actor r e) (pending : s.pending actor = some r)
      (stored : s.receipts r.key = some e) (sameBody : e.body = r.body) :
      Step valid s (.acknowledge actor) { s with ack := put s.ack actor (some e) }
  | crash (s actor) : Step valid s (.crash actor)
      { s with
        pending := put s.pending actor none
        preflight := put s.preflight actor none
        ack := put s.ack actor none }
  | abort (s actor) : Step valid s (.abort actor) s

inductive Reachable (valid : Validator) : State → Prop where
  | init (s) (h : Init s) : Reachable valid s
  | next {s t a} : Reachable valid s → Step valid s a t → Reachable valid t

def Invariant (s : State) : Prop := ∀ k,
  s.rooms k = s.receipts k ∧
  s.schedules k = (s.receipts k).map Effect.version ∧
  s.counts k = (if (s.receipts k).isSome then 1 else 0) ∧
  (∀ e, s.receipts k = some e → ∃ rel,
    s.releases e.version = some rel ∧ rel.payload = e.payload ∧ Covers rel.scope e.scope)

end SatAutoRoom
