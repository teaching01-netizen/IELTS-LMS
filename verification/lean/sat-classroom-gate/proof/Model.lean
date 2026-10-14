/-!
The creation-gate model covers one staff actor's room request across any API
instance. A room operation's database transaction is represented as one atomic
step. That is an explicit refinement assumption, not a fact proved here.
-/

namespace SatClassroomGate

abbrev InstanceId := Nat
abbrev ActorId := Nat
abbrev OperationNonce := Nat
abbrev OperationKey := ActorId × OperationNonce

inductive Session where
  | practice
  | classroom
  deriving DecidableEq, Repr

inductive Availability where
  | unknown
  | disabled
  | enabled
  deriving DecidableEq, Repr

def capabilityFor (enabled : Bool) : Availability :=
  if enabled then .enabled else .disabled

def classroomChoiceEnabled (availability : Availability) : Bool :=
  availability == .enabled

def maySubmit (selected : Session) (availability : Availability) : Bool :=
  match selected with
  | .practice => true
  | .classroom => classroomChoiceEnabled availability

structure RoomPayload where
  exam : Nat
  session : Session
  formDigest : Nat
  deriving DecidableEq, Repr

structure Request where
  key : OperationKey
  payload : RoomPayload
  deriving DecidableEq, Repr

structure Receipt where
  payload : RoomPayload
  roomId : Nat
  deriving DecidableEq, Repr

inductive Reply where
  | created (receipt : Receipt)
  | replayed (receipt : Receipt)
  | keyConflict
  | classroomDisabled
  deriving DecidableEq, Repr

structure Store where
  /-- Each API process has its own startup-loaded flag. -/
  classroomEnabled : InstanceId → Bool
  receipts : OperationKey → Option Receipt
  roomEffects : OperationKey → Nat
  totalRooms : Nat

def Store.empty (enabled : InstanceId → Bool) : Store :=
  { classroomEnabled := enabled
    receipts := fun _ => none
    roomEffects := fun _ => 0
    totalRooms := 0 }

/-- Commit the receipt and room effect together, as one transaction. -/
def Store.commit (store : Store) (request : Request) : Store :=
  let receipt : Receipt := { payload := request.payload, roomId := store.totalRooms }
  { store with
    receipts := fun key => if key = request.key then some receipt else store.receipts key
    roomEffects := fun key => if key = request.key then store.roomEffects key + 1 else store.roomEffects key
    totalRooms := store.totalRooms + 1 }

/-- The server checks an existing durable receipt before the current gate. -/
def handle (store : Store) (target : InstanceId) (request : Request) : Store × Reply :=
  match store.receipts request.key with
  | some receipt =>
      if receipt.payload == request.payload then (store, .replayed receipt)
      else (store, .keyConflict)
  | none =>
      if request.payload.session = .classroom ∧ store.classroomEnabled target = false then
        (store, .classroomDisabled)
      else
        let receipt : Receipt := { payload := request.payload, roomId := store.totalRooms }
        (store.commit request, .created receipt)

inductive ClientStatus where
  | editing
  | creating
  | unknown
  | rejected
  | created
  deriving DecidableEq, Repr

inductive ClientResponse where
  | success
  | satClassroomDisabled
  | generic5xx
  deriving DecidableEq, Repr

structure ClientState where
  selected : Session
  availability : Availability
  pending : Option Request
  draft : Option RoomPayload
  status : ClientStatus
  deriving DecidableEq, Repr

def ClientState.refreshAvailability (client : ClientState) (availability : Availability) : ClientState :=
  { client with availability := availability }

/-- A blocked restored selection remains selected and keeps its form values. -/
def ClientState.beginSubmit (client : ClientState) (request : Request) : ClientState :=
  if client.pending.isSome || !maySubmit client.selected client.availability then client
  else if request.payload.session = client.selected then
      { client with
        pending := some request
        draft := some request.payload
        status := .creating }
    else client

/-- This models the current client distinction: the named gate refusal is
definitive; an unclassified 5xx leaves the same request key unresolved. -/
def ClientState.receive (client : ClientState) (response : ClientResponse) : ClientState :=
  match response with
  | .success => { client with pending := none, draft := none, status := .created }
  | .satClassroomDisabled => { client with pending := none, availability := .disabled, status := .rejected }
  | .generic5xx => { client with status := .unknown }

inductive Reachable : Store → Prop where
  | init (enabled : InstanceId → Bool) : Reachable (Store.empty enabled)
  | request (store : Store) (target : InstanceId) (request : Request) :
      Reachable store → Reachable (handle store target request).1

end SatClassroomGate
