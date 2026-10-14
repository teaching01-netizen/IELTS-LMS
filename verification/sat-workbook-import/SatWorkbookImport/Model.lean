/-!
# Operational model of the SAT workbook import protocol

Authoritative state: the editable draft (`draft`, `rev`), the preview registry,
and the operation-key ledger.  Each `Step` is ONE database transaction (an
InnoDB REPEATABLE READ transaction holding the exam-row lock) or a failure of
one.  That atomicity is an *assumption* (A1 in ASSUMPTIONS.md), not a theorem.

Modules, content and keys are abstract (`Nat`), so every theorem is universally
quantified over module count, content, ids, keys and interleavings.

`Content` stands for "the full checked content of a module, including pretest
flags".  Equality of `Content` models equality of the SHA-256 content digest
(assumption A3: no collisions).
-/

namespace WorkbookImport

abbrev Key := Nat
abbrev Content := Nat
abbrev Draft := Key → Content

def upd {α : Type} (f : Nat → α) (k : Nat) (v : α) : Nat → α :=
  fun x => if x = k then v else f x

/-- Replace exactly the `targets` modules with `c`, leaving every other module
as in `d`. -/
def override (targets : List Key) (c d : Draft) : Draft :=
  fun m => if m ∈ targets then c m else d m

inductive Status
  | previewed
  | committed
  | undone
  deriving DecidableEq

/-- A registered preview (`sat_workbook_imports` + `sat_workbook_import_scopes`). -/
structure Preview where
  targets     : List Key   -- detected modules, canonical order
  content     : Draft      -- checked content (digest-bound)
  snapshot    : Draft      -- draft as it was when the preview was registered
  expectedRev : Nat        -- draft revision the preview was checked against
  importedRev : Nat        -- draft revision produced by the commit
  status      : Status

/-- The fingerprint of a commit request. -/
structure Req where
  importId : Nat
  targets  : List Key
  content  : Draft

structure State where
  draft    : Draft
  rev      : Nat
  previews : Nat → Option Preview
  ledger   : Nat → Option Req   -- op key ↦ fingerprint it was claimed with
  effects  : Nat → Nat          -- ghost: times each import's effect was applied

inductive Ev
  | register (id : Nat) (targets : List Key) (content : Draft)
  | edit (m : Key) (c : Content)         -- any other author's content write
  | commit (k : Nat) (r : Req)           -- client commit / retry with op key k
  | undo (id : Nat)
  | crash

inductive Step : State → Ev → State → Prop
  /-- Register a preview against the current draft; ids are fresh. -/
  | register {s : State} {id : Nat} {targets : List Key} {content : Draft}
      (h : s.previews id = none) :
      Step s (.register id targets content)
        { s with
          previews := upd s.previews id
            (some { targets := targets, content := content, snapshot := s.draft,
                    expectedRev := s.rev, importedRev := 0, status := .previewed }) }
  /-- Every content write by anyone bumps the draft revision (`touchModuleDraft`). -/
  | edit {s : State} {m : Key} {c : Content} :
      Step s (.edit m c) { s with draft := upd s.draft m c, rev := s.rev + 1 }
  /-- First delivery: key unclaimed, preview live, revision unchanged,
  request bound to the checked preview. One atomic transaction. -/
  | commitApply {s : State} {k : Nat} {r : Req} {p : Preview}
      (hk : s.ledger k = none)
      (hp : s.previews r.importId = some p)
      (hst : p.status = .previewed)
      (hrev : p.expectedRev = s.rev)
      (ht : r.targets = p.targets)
      (hc : ∀ m, m ∈ p.targets → r.content m = p.content m) :
      Step s (.commit k r)
        { draft := override p.targets r.content s.draft,
          rev := s.rev + 1,
          previews := upd s.previews r.importId
            (some { p with status := .committed, importedRev := s.rev + 1 }),
          ledger := upd s.ledger k (some r),
          effects := upd s.effects r.importId (s.effects r.importId + 1) }
  /-- Retry with the same key and the same fingerprint: stored result, no effect. -/
  | commitReplay {s : State} {k : Nat} {r : Req} (h : s.ledger k = some r) :
      Step s (.commit k r) s
  /-- Key reuse with different content: 409, no effect. -/
  | commitConflict {s : State} {k : Nat} {r r' : Req}
      (h : s.ledger k = some r') (hne : r ≠ r') : Step s (.commit k r) s
  /-- Any rollback / deadlock / timeout / revision conflict / lost connection
  before COMMIT: no durable change. -/
  | commitAbort {s : State} {k : Nat} {r : Req} : Step s (.commit k r) s
  /-- Undo restores the checkpoint, only while nothing was edited since import. -/
  | undo {s : State} {id : Nat} {p : Preview}
      (hp : s.previews id = some p) (hst : p.status = .committed)
      (hrev : p.importedRev = s.rev) :
      Step s (.undo id)
        { s with
          draft := p.snapshot,
          rev := s.rev + 1,
          previews := upd s.previews id (some { p with status := .undone }) }
  /-- Process crash / lost ACK / failover between any two steps: durable state
  is whatever the last committed transaction left. -/
  | crash {s : State} : Step s .crash s

/-- Admissible initial states: an empty registry and ledger over ANY draft and
revision.  (Pre-existing registry rows are covered by assumption A5.) -/
def Init (s : State) : Prop :=
  (∀ i, s.previews i = none) ∧ (∀ k, s.ledger k = none) ∧ (∀ i, s.effects i = 0)

inductive Reach : State → Prop
  | init {s : State} : Init s → Reach s
  | step {s s' : State} {e : Ev} : Reach s → Step s e s' → Reach s'

end WorkbookImport
