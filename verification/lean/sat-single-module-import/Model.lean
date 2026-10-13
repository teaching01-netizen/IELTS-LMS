import Std

namespace SingleModuleImport

inductive Module where
  | rw1 | rwLower | rwHigher | math1 | mathLower | mathHigher
  deriving DecidableEq, Repr

def expected : Module → Nat
  | .rw1 | .rwLower | .rwHigher => 27
  | .math1 | .mathLower | .mathHigher => 22

structure Question where
  order : Nat
  -- Abstract canonical content; XLSX parsing/serialization is a refinement gap.
  canonical : String
  deriving DecidableEq, Repr

structure Placement where
  id : Nat
  question : Question
  isPretest : Bool
  deriving DecidableEq, Repr

structure Draft where
  exam : Nat
  version : Nat
  revision : Nat
  editable : Bool
  placements : Module → List Placement
  targets : Module → Nat
  routing : String
  scoring : String

inductive Designation where
  | sourceVerified | staffDefined
  deriving DecidableEq, Repr

structure Key where
  actor : Nat
  exam : Nat
  operation : Nat
  deriving DecidableEq, Repr

structure Request where
  key : Key
  importId : Nat
  target : Module
  version : Nat
  revision : Nat
  questions : List Question
  selected : List Nat
  source : Option Designation
  confirmed : Bool
  deriving DecidableEq, Repr

structure Preview where
  actor : Nat
  exam : Nat
  target : Module
  version : Nat
  revision : Nat
  questions : List Question
  expiresAt : Nat
  -- Registration must establish content/media checks; not proved by this model.
  contentChecked : Bool
  assetsChecked : Bool

def PretestsOK (r : Request) : Prop :=
  r.selected.length = 2 ∧ r.selected.Nodup ∧
  (∀ n ∈ r.selected, 1 ≤ n ∧ n ≤ expected r.target) ∧
  r.source ≠ none ∧ r.confirmed = true

def ShapeOK (r : Request) : Prop :=
  r.questions.length = expected r.target ∧
  r.questions.map Question.order = List.range' 1 (expected r.target)

structure Row where
  module : Module
  order : Nat
  response : String
  difficulty : String
  pretest : String
  -- All remaining authoring cells, including prompt/choices/taxonomy/assets.
  authoringCells : List String

def UntouchedScaffold (row : Row) : Prop :=
  1 ≤ row.order ∧ row.order ≤ expected row.module ∧
  row.response = "Multiple Choice" ∧ row.difficulty = "Medium" ∧ row.pretest = "No" ∧
  ∀ cell ∈ row.authoringCells, cell = ""

inductive RowDecision where
  | selected | ignore | block
  deriving DecidableEq, Repr

instance (row : Row) : Decidable (UntouchedScaffold row) := by
  unfold UntouchedScaffold
  infer_instance

def classify (target : Module) (row : Row) : RowDecision :=
  if row.module = target then .selected
  else if UntouchedScaffold row then .ignore else .block

def Bound (r : Request) (p : Preview) : Prop :=
  p.actor = r.key.actor ∧ p.exam = r.key.exam ∧ p.target = r.target ∧
  p.version = r.version ∧ p.revision = r.revision ∧ p.questions = r.questions

def Ready (now : Nat) (d : Draft) (r : Request) (p : Preview) : Prop :=
  d.editable = true ∧ d.version = r.version ∧ d.revision = r.revision ∧
  Bound r p ∧ now < p.expiresAt ∧ p.contentChecked = true ∧
  p.assetsChecked = true ∧ ShapeOK r ∧ PretestsOK r ∧ d.exam = r.key.exam

def imported (r : Request) : List Placement :=
  r.questions.map fun q =>
    { id := q.order, question := q, isPretest := decide (q.order ∈ r.selected) }

-- IDs here are abstract within one module; real fresh UUIDs are not verified.
def replace (d : Draft) (r : Request) : Draft :=
  { d with
    revision := d.revision + 1,
    placements := fun m => if m = r.target then imported r else d.placements m }

structure Receipt where
  request : Request
  before : Draft
  importedVersion : Nat
  afterRevision : Nat

structure State where
  draft : Draft
  previews : Nat → Option Preview
  -- Durable import receipts survive cleanup of the shorter-lived retry index.
  receipts : Key → Option Receipt
  operationKeys : Key → Option Request
  singleModuleEnabled : Bool
  -- Ghost counter records business effects; undo does not erase history.
  effects : Key → Nat

def initialWithFlag (d : Draft) (ps : Nat → Option Preview) (enabled : Bool) : State :=
  { draft := d, previews := ps, receipts := fun _ => none,
    operationKeys := fun _ => none, singleModuleEnabled := enabled, effects := fun _ => 0 }

def initial (d : Draft) (ps : Nat → Option Preview) : State :=
  initialWithFlag d ps true

def Init (s : State) : Prop := ∃ d ps enabled, s = initialWithFlag d ps enabled

def committed (s : State) (r : Request) : State :=
  { s with
    draft := replace s.draft r,
    previews := fun i => if i = r.importId then none else s.previews i,
    receipts := fun k => if k = r.key then
      some {
        request := r,
        before := { s.draft with version := s.draft.version + 1, revision := 0 },
        importedVersion := s.draft.version, afterRevision := s.draft.revision + 1 }
      else s.receipts k,
    operationKeys := fun k => if k = r.key then some r else s.operationKeys k,
    effects := fun k => if k = r.key then s.effects k + 1 else s.effects k }

def ModuleReady (d : Draft) (m : Module) : Prop :=
  (d.placements m).length = d.targets m ∧
  ((d.placements m).filter fun p => p.isPretest).length = 2

inductive Scope where
  | rw | math | full
  deriving DecidableEq, Repr

def included : Scope → Module → Bool
  | .full, _ => true
  | .rw, .rw1 | .rw, .rwLower | .rw, .rwHigher => true
  | .math, .math1 | .math, .mathLower | .math, .mathHigher => true
  | _, _ => false

def PublishReady (d : Draft) (scope : Scope) : Prop :=
  ∀ m, included scope m = true → ModuleReady d m

-- Only the proposed durable transaction is atomic. Reads/ACKs can stutter.
-- This abstraction needs a locked SQL refinement, not just similar Go code.
inductive Action where
  | read (actor : Nat) | ack (actor : Nat) | crash (actor : Nat)
  | abort (actor : Nat) | commit (r : Request) | replay (r : Request)
  | evictOperationKey (key : Key) | setSingleModuleEnabled (enabled : Bool)
  | expire (importId : Nat) | edit | undo (key : Key) | publish (scope : Scope)

inductive Step : State → Action → State → Prop where
  | read (s : State) (actor : Nat) : Step s (.read actor) s
  | ack (s : State) (actor : Nat) : Step s (.ack actor) s
  | crash (s : State) (actor : Nat) : Step s (.crash actor) s
  | abort (s : State) (actor : Nat) : Step s (.abort actor) s
  | commit (s : State) (r : Request) (p : Preview) (now : Nat)
      (preview : s.previews r.importId = some p)
      (ready : Ready now s.draft r p)
      (unused : s.receipts r.key = none)
      (keyUnused : s.operationKeys r.key = none)
      (enabled : s.singleModuleEnabled = true) :
      Step s (.commit r) (committed s r)
  | replay (s : State) (r : Request) (receipt : Receipt)
      (found : s.receipts r.key = some receipt) (same : receipt.request = r) :
      Step s (.replay r) { s with operationKeys := fun k => if k = r.key then some r else s.operationKeys k }
  | evictOperationKey (s : State) (key : Key) :
      Step s (.evictOperationKey key) { s with operationKeys := fun k => if k = key then none else s.operationKeys k }
  | setSingleModuleEnabled (s : State) (enabled : Bool) :
      Step s (.setSingleModuleEnabled enabled) { s with singleModuleEnabled := enabled }
  | expire (s : State) (i : Nat) :
      Step s (.expire i) { s with previews := fun j => if j = i then none else s.previews j }
  | edit (s : State) (placements : Module → List Placement)
      (editable : s.draft.editable = true) :
      Step s .edit { s with draft := { s.draft with
        revision := s.draft.revision + 1, placements := placements } }
  | undo (s : State) (key : Key) (receipt : Receipt)
      (found : s.receipts key = some receipt)
      (sameVersion : s.draft.version = receipt.importedVersion)
      (sameRevision : s.draft.revision = receipt.afterRevision)
      (editable : s.draft.editable = true) :
      Step s (.undo key) { s with draft := receipt.before }
  | publish (s : State) (scope : Scope) (ready : PublishReady s.draft scope)
      (editable : s.draft.editable = true) :
      Step s (.publish scope) { s with draft := { s.draft with editable := false } }

inductive Reachable : State → Prop where
  | init {s : State} : Init s → Reachable s
  | step {s t : State} {a : Action} : Reachable s → Step s a t → Reachable t

def Invariant (s : State) : Prop :=
  ∀ k, s.effects k ≤ 1 ∧ (s.effects k = 1 ↔ ∃ receipt, s.receipts k = some receipt)

end SingleModuleImport
