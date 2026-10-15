/-! Abstract transaction model for SAT exam creation and request replay.

The persistent unit is a complete `ExamBundle`; the database transaction maps
to one atomic insertion of that bundle plus its actor-scoped operation receipt.
The SQL/engine refinement is reviewed separately in the report.
-/
namespace SatExamCreate

abbrev Actor := Nat
abbrev OperationKey := Nat
abbrev ExamId := Nat
abbrev Operation := Actor × OperationKey

inductive ModulePlan
  | full
  | m1Easy
  | m1Hard
  | m2Easy
  | m2Hard
  deriving DecidableEq, Repr

structure Payload where
  slug : Nat
  title : Nat
  classroomPlan : Option ModulePlan
  planAccepted : Bool
  converter : Option Nat
  converterAccepted : Bool
  showClassroomScoreReport : Bool
  deriving DecidableEq, Repr

def Payload.valid (p : Payload) : Prop :=
  p.planAccepted = true ∧ p.converterAccepted = true

structure Request where
  actor : Actor
  operationKey : Option OperationKey
  payload : Payload
  deriving DecidableEq, Repr

structure ExamBundle where
  id : ExamId
  owner : Actor
  title : Nat
  showClassroomScoreReport : Bool
  classroomPlan : Option ModulePlan
  scoreConverter : Option Nat
  createdEventActor : Actor
  createdEvent : Bool
  payload : Payload
  deriving DecidableEq, Repr

def bundleWellFormed (id : ExamId) (b : ExamBundle) : Prop :=
  b.id = id ∧
  b.payload.valid ∧
  b.title = b.payload.title ∧
  b.owner = b.createdEventActor ∧
  b.showClassroomScoreReport = b.payload.showClassroomScoreReport ∧
  b.classroomPlan = b.payload.classroomPlan ∧
  b.scoreConverter = b.payload.converter ∧
  b.createdEvent = true

def makeBundle (r : Request) (id : ExamId) : ExamBundle :=
  { id := id
    owner := r.actor
    title := r.payload.title
    showClassroomScoreReport := r.payload.showClassroomScoreReport
    classroomPlan := r.payload.classroomPlan
    scoreConverter := r.payload.converter
    createdEventActor := r.actor
    createdEvent := true
    payload := r.payload }

theorem makeBundle_wellFormed {r : Request} {id : ExamId}
    (hvalid : r.payload.valid) : bundleWellFormed id (makeBundle r id) := by
  rcases hvalid with ⟨hplan, hconverter⟩
  simp [bundleWellFormed, makeBundle, Payload.valid, hplan, hconverter]

structure LedgerEntry where
  fingerprint : Payload
  resultId : ExamId
  deriving DecidableEq, Repr

structure State where
  nextExamId : ExamId
  bundles : ExamId → Option ExamBundle
  ledger : Operation → Option LedgerEntry

def putBundle (f : ExamId → Option ExamBundle) (id : ExamId) (b : ExamBundle) : ExamId → Option ExamBundle :=
  fun target => if target = id then some b else f target

def putLedger (f : Operation → Option LedgerEntry) (op : Operation) (entry : LedgerEntry) : Operation → Option LedgerEntry :=
  fun target => if target = op then some entry else f target

def clearLedger (f : Operation → Option LedgerEntry) (op : Operation) : Operation → Option LedgerEntry :=
  fun target => if target = op then none else f target

def operationOf (r : Request) (key : OperationKey) : Operation := (r.actor, key)

def keyAvailable (s : State) (r : Request) : Prop :=
  match r.operationKey with
  | none => True
  | some key => s.ledger (r.actor, key) = none

def commitState (s : State) (r : Request) : State :=
  let id := s.nextExamId
  let next := { s with
    nextExamId := id + 1
    bundles := putBundle s.bundles id (makeBundle r id) }
  match r.operationKey with
  | none => next
  | some key =>
    let entry : LedgerEntry := { fingerprint := r.payload, resultId := id }
    { next with ledger := putLedger s.ledger (r.actor, key) entry }

def clearOperation (s : State) (op : Operation) : State :=
  { s with ledger := clearLedger s.ledger op }

@[simp] theorem commitState_next (s : State) (r : Request) :
    (commitState s r).nextExamId = s.nextExamId + 1 := by
  cases h : r.operationKey <;> simp [commitState, h]

@[simp] theorem commitState_bundle_lookup (s : State) (r : Request) (id : ExamId) :
    (commitState s r).bundles id =
      (if id = s.nextExamId then some (makeBundle r s.nextExamId) else s.bundles id) := by
  cases h : r.operationKey <;> simp [commitState, h, putBundle]

@[simp] theorem commitState_ledger_lookup (s : State) (r : Request) (op : Operation) :
    (commitState s r).ledger op =
      (match r.operationKey with
       | none => s.ledger op
       | some key =>
         if op = (r.actor, key) then
           some { fingerprint := r.payload, resultId := s.nextExamId }
         else s.ledger op) := by
  cases h : r.operationKey <;> simp [commitState, h, putLedger]

def BundlesWellFormed (s : State) : Prop :=
  ∀ id b, s.bundles id = some b → bundleWellFormed id b

def LedgerSound (s : State) : Prop :=
  ∀ op entry, s.ledger op = some entry →
    ∃ b, s.bundles entry.resultId = some b ∧
      b.owner = op.1 ∧ b.payload = entry.fingerprint

def CursorSound (s : State) : Prop :=
  ∀ id b, s.bundles id = some b → id < s.nextExamId

/-- Permitted startup and recovery states: arbitrary existing complete exam
bundles, with a cursor beyond all existing IDs and each persisted operation
receipt resolving to its durable exam. This includes non-empty databases. -/
def Init (s : State) : Prop :=
  BundlesWellFormed s ∧ LedgerSound s ∧ CursorSound s

def Invariant (s : State) : Prop :=
  BundlesWellFormed s ∧ LedgerSound s ∧ CursorSound s

inductive Action
  | submit (request : Request)
  | abort (request : Request)
  | ackLost (examId : ExamId)
  | ackDelivered (examId : ExamId)
  | expireKey (operation : Operation)
  deriving Repr

inductive Step : State → Action → State → Prop
  | create (s : State) (r : Request)
      (hvalid : r.payload.valid) (havailable : keyAvailable s r) :
      Step s (.submit r) (commitState s r)
  | replay (s : State) (r : Request) (key : OperationKey) (entry : LedgerEntry)
      (hvalid : r.payload.valid)
      (hkey : r.operationKey = some key)
      (hentry : s.ledger (r.actor, key) = some entry)
      (hsame : entry.fingerprint = r.payload) :
      Step s (.submit r) s
  | keyConflict (s : State) (r : Request) (key : OperationKey) (entry : LedgerEntry)
      (hvalid : r.payload.valid)
      (hkey : r.operationKey = some key)
      (hentry : s.ledger (r.actor, key) = some entry)
      (hdifferent : entry.fingerprint ≠ r.payload) :
      Step s (.submit r) s
  | invalid (s : State) (r : Request) (hinvalid : ¬ r.payload.valid) :
      Step s (.submit r) s
  | abort (s : State) (r : Request) :
      Step s (.abort r) s
  | ackLost (s : State) (id : ExamId) (b : ExamBundle)
      (hbundle : s.bundles id = some b) :
      Step s (.ackLost id) s
  | ackDelivered (s : State) (id : ExamId) (b : ExamBundle)
      (hbundle : s.bundles id = some b) :
      Step s (.ackDelivered id) s
  | expireKey (s : State) (op : Operation) (entry : LedgerEntry)
      (hentry : s.ledger op = some entry) :
      Step s (.expireKey op) (clearOperation s op)

inductive Reachable : State → Prop
  | init (s : State) (h : Init s) : Reachable s
  | step (s s' : State) (a : Action) (hreach : Reachable s) (hstep : Step s a s') :
      Reachable s'

def emptyState : State :=
  { nextExamId := 0
    bundles := fun _ => none
    ledger := fun _ => none }

end SatExamCreate
