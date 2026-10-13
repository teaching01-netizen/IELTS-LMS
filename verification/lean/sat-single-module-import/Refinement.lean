import Counterexamples

namespace SingleModuleImport

/-!
This model splits transaction-private work from visible durable state. The
prepared state is a transaction-local write set; intermediate checkpoint,
placement, revision, and receipt writes do not change `project`. A database
commit publishes that write set atomically. This is a refinement model for the
transaction shape, not a mechanized semantics for Go, `database/sql`, or MySQL.
-/

structure PendingTxn (base : State) where
  request : Request
  prepared : State
  accepted : Step base (.commit request) prepared
  writesMade : Nat

structure ConcreteState where
  durable : State
  pending : Option (PendingTxn durable)

def project (s : ConcreteState) : State := s.durable

inductive ConcreteAction where
  | begin (request : Request)
  | transactionWrite
  | commitDatabase
  | abortDatabase
  | processCrash
  | retry (request : Request)
  | cleanupOperationKey (key : Key)
  | setFeatureFlag (enabled : Bool)

inductive ConcreteStep : ConcreteState → ConcreteAction → ConcreteState → Prop where
  | begin (s : ConcreteState) (r : Request) (p : Preview) (now : Nat)
      (idle : s.pending = none)
      (preview : s.durable.previews r.importId = some p)
      (ready : Ready now s.durable.draft r p)
      (unused : s.durable.receipts r.key = none)
      (keyUnused : s.durable.operationKeys r.key = none)
      (enabled : s.durable.singleModuleEnabled = true) :
      ConcreteStep s (.begin r)
        { durable := s.durable,
          pending := some ⟨r, committed s.durable r,
            Step.commit s.durable r p now preview ready unused keyUnused enabled, 0⟩ }
  | transactionWrite (base : State) (pending : PendingTxn base)
      (room : pending.writesMade < 5) :
      ConcreteStep ⟨base, some pending⟩ .transactionWrite
        ⟨base, some { pending with writesMade := pending.writesMade + 1 }⟩
  | commitDatabase (base : State) (pending : PendingTxn base)
      (complete : pending.writesMade = 5) :
      ConcreteStep ⟨base, some pending⟩ .commitDatabase
        ⟨pending.prepared, none⟩
  | abortDatabase (base : State) (pending : PendingTxn base) :
      ConcreteStep ⟨base, some pending⟩ .abortDatabase ⟨base, none⟩
  | processCrash (s : ConcreteState) :
      ConcreteStep s .processCrash ⟨s.durable, none⟩
  | retry (s : ConcreteState) (r : Request) (receipt : Receipt)
      (idle : s.pending = none)
      (found : s.durable.receipts r.key = some receipt)
      (same : receipt.request = r) :
      ConcreteStep s (.retry r)
        { durable := { s.durable with operationKeys := fun k => if k = r.key then some r else s.durable.operationKeys k },
          pending := none }
  | cleanupOperationKey (s : ConcreteState) (key : Key) (idle : s.pending = none) :
      ConcreteStep s (.cleanupOperationKey key)
        { durable := { s.durable with operationKeys := fun k => if k = key then none else s.durable.operationKeys k },
          pending := none }
  | setFeatureFlag (s : ConcreteState) (enabled : Bool) (idle : s.pending = none) :
      ConcreteStep s (.setFeatureFlag enabled)
        { durable := { s.durable with singleModuleEnabled := enabled }, pending := none }

theorem concrete_step_refines_abstract {s t : ConcreteState} {action : ConcreteAction}
    (step : ConcreteStep s action t) :
    project s = project t ∨ ∃ abstractAction, Step (project s) abstractAction (project t) := by
  cases step with
  | begin => exact Or.inl rfl
  | transactionWrite => exact Or.inl rfl
  | commitDatabase base pending complete => exact Or.inr ⟨_, pending.accepted⟩
  | abortDatabase => exact Or.inl rfl
  | processCrash => exact Or.inl rfl
  | retry s r receipt idle found same =>
      exact Or.inr ⟨.replay r, Step.replay s.durable r receipt found same⟩
  | cleanupOperationKey s key idle => exact Or.inr ⟨.evictOperationKey key, Step.evictOperationKey s.durable key⟩
  | setFeatureFlag s enabled idle => exact Or.inr ⟨.setSingleModuleEnabled enabled, Step.setSingleModuleEnabled s.durable enabled⟩

theorem crash_discards_uncommitted_write_set {s t : ConcreteState}
    (crash : ConcreteStep s .processCrash t) : t.durable = s.durable := by
  cases crash
  rfl

theorem abort_discards_uncommitted_write_set {base : State} {pending : PendingTxn base}
    : project ⟨base, some pending⟩ = project ⟨base, none⟩ := rfl

theorem database_commit_publishes_one_abstract_commit {base : State}
    {pending : PendingTxn base} (complete : pending.writesMade = 5) :
    pending.writesMade = 5 ∧
    Step (project ⟨base, some pending⟩) (.commit pending.request) (project ⟨pending.prepared, none⟩) :=
  ⟨complete, pending.accepted⟩

end SingleModuleImport
