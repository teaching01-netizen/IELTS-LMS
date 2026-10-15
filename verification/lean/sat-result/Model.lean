/-!
# SAT result, score report and answered-exam paper — operational model

Formal model for the SAT result and release requirements recorded in SPEC.md.
Each definition names the code it abstracts; TRACEABILITY.md maps requirements
to theorems, code paths and tests.

Namespaces:
* `Convert`       — `sat.PolicyScorer` conversion, `normalizedRaw`, total (§1–2, SC-01..05)
* `ConvertTopo`   — `satconvert` topology-exact classroom converter + publish gate (R-1)
* `Scoring`       — `scoreScoringRows` (pretests never count)
* `Report`        — `classroomRawScoreTx` (classroom raw score report, §3)
* `Attach`        — `results.attachSATModules` (staff module breakdown)
* `Release`       — `StudentResultScoreVisible` + projections + client gate
* `ResultMachine` — `materializeSATResult` / `RepairClassroomResults` lifecycle
* `Paper`         — `AnsweredExamPaper` marking and completeness (§4, PDF-01..06)
* `PrintGate`     — `SatScoreReport.printAnsweredExam` (PDF-10)
* `CloseAck`      — why the paper re-reads the attempt before printing (SC-07/PDF)
-/

/-! ## Convert — backend/go/internal/sat/service.go `PolicyScorer.ScoreSection` -/
namespace Convert

/-- What `json.Unmarshal(rawScore, &int64)` can see for one table entry: an
    integer literal, `null` (silently decodes to 0 with no error), or anything
    else (rejected). -/
inductive Entry where
  | int (n : Int)
  | null
  | other
  deriving DecidableEq, Repr

/-- A conversion table: (section, route, raw) ↦ entry; `none` = key absent. -/
abbrev Table := String → String → Nat → Option Entry

def minScaled : Int := 200
def maxScaled : Int := 800

/-- Go semantics before the fix: `null` decodes to 0, no range check. -/
def convertGoOld (t : Table) (sec route : String) (raw : Nat) : Option Int :=
  match t sec route raw with
  | some (.int n) => some n
  | some .null    => some 0
  | _             => none

/-- Go semantics after the fix: an explicit integer entry within 200–800 only. -/
def convert (t : Table) (sec route : String) (raw : Nat) : Option Int :=
  match t sec route raw with
  | some (.int n) => if minScaled ≤ n ∧ n ≤ maxScaled then some n else none
  | _             => none

/-- `normalizedRaw` with Go truncating division (`Int.tdiv`). -/
def normalizedRaw (raw op mx : Int) : Int :=
  if op ≤ 0 ∨ mx ≤ 0 then 0
  else
    let n := Int.tdiv (raw * mx + Int.tdiv op 2) op
    if n < 0 then 0 else if n > mx then mx else n

/-- Combined score: only when both sections converted. -/
def total (rw math : Option Int) : Option Int :=
  match rw, math with
  | some a, some b => some (a + b)
  | _, _ => none

end Convert

/-! ## ConvertTopo — backend/go/internal/satconvert (versioned classroom converter)

`terminalization.convertClassroomScoresTx`: the administered module roles of a
section pick its topology; only a table for exactly that topology and
operational count converts; a 400–1600 total needs two full sections.
`satpublish.validateConverter` is `gateOk`. -/
namespace ConvertTopo

/-- `satpublish.RoleOfModuleKey`; `other` = an unrecognised key (""). -/
inductive Role where
  | base | lower | higher | other
  deriving DecidableEq, Repr

inductive Topology where
  | fullLower | fullHigher | m2LowerOnly | m2HigherOnly
  deriving DecidableEq, Repr

/-- `Topology.Full`. -/
def Topology.full : Topology → Bool
  | .fullLower | .fullHigher => true
  | _ => false

def count (r : Role) (rs : List Role) : Nat := (rs.filter (· == r)).length

/-- `satconvert.TopologyOf`: role counts plus list length. -/
def topologyOf (rs : List Role) : Option Topology :=
  match count .base rs, count .lower rs, count .higher rs, rs.length with
  | 1, 1, 0, 2 => some .fullLower
  | 1, 0, 1, 2 => some .fullHigher
  | 0, 1, 0, 1 => some .m2LowerOnly
  | 0, 0, 1, 1 => some .m2HigherOnly
  | _, _, _, _ => none

/-- `satconvert.Score`: a point when `low = high`, else a reference range. -/
structure Score where
  low : Int
  high : Int
  deriving DecidableEq, Repr

/-- `checkScore`. -/
def Score.valid (s : Score) : Prop :=
  200 ≤ s.low ∧ s.low ≤ s.high ∧ s.high ≤ 800 ∧ s.low % 10 = 0 ∧ s.high % 10 = 0

/-- `satconvert.Table`: raw 0..ops ↦ score. -/
structure Tbl where
  ops : Nat
  scores : Nat → Score

/-- `parseTable`: 1 ≤ ops and every entry 0..ops passes `checkScore`. -/
def Tbl.valid (t : Tbl) : Prop := 0 < t.ops ∧ ∀ r, r ≤ t.ops → (t.scores r).valid

/-- A parsed `Converter`. `Parse` resolves table ids and refuses a dangling
    one, so the model maps (section, topology) straight to a table. -/
structure Conv where
  table : String → Topology → Option Tbl

def Conv.valid (c : Conv) : Prop := ∀ sec τ t, c.table sec τ = some t → t.valid

/-- `(*Converter).Convert`; `none` = no converter configured, or unparseable. -/
def convert (c : Option Conv) (sec : String) (τ : Topology) (raw ops : Nat) : Option Score :=
  match c with
  | none => none
  | some c =>
    match c.table sec τ with
    | none => none
    | some t => if ops = t.ops ∧ raw ≤ ops then some (t.scores raw) else none

/-- One section of `convertClassroomScoresTx`. -/
def sectionScore (c : Option Conv) (sec : String) (rs : List Role) (raw ops : Nat) :
    Option (Topology × Score) :=
  match topologyOf rs with
  | none => none
  | some τ => (convert c sec τ raw ops).map fun s => (τ, s)

/-- `satconvert.Total`. -/
def total : Option (Topology × Score) → Option (Topology × Score) → Option Score
  | some (τ₁, a), some (τ₂, b) =>
    if τ₁.full = true ∧ τ₂.full = true then some ⟨a.low + b.low, a.high + b.high⟩ else none
  | _, _ => none

/-- Before R-1 a table was keyed by (section, route), so a standalone Module 2
    read the full two-module table of its route, with no operational check. -/
def routeTopology : Topology → Topology
  | .m2LowerOnly => .fullLower
  | .m2HigherOnly => .fullHigher
  | τ => τ

def convertOld (c : Option Conv) (sec : String) (τ : Topology) (raw : Nat) : Option Score :=
  match c with
  | none => none
  | some c =>
    match c.table sec (routeTopology τ) with
    | none => none
    | some t => if raw ≤ t.ops then some (t.scores raw) else none

/-- `satpublish` classroom plan shapes ("" = full adaptive). -/
inductive Shape where
  | full | m1Easy | m1Hard | m2Easy | m2Hard
  deriving DecidableEq, Repr

/-- `satpublish.topologiesFor`. -/
def topologiesFor : Shape → List Topology
  | .full => [.fullLower, .fullHigher]
  | .m1Easy => [.fullLower]
  | .m1Hard => [.fullHigher]
  | .m2Easy => [.m2LowerOnly]
  | .m2Hard => [.m2HigherOnly]

/-- Modules a completed classroom section administers under a shape; `higher`
    is the routing outcome (adaptive, forced or staff), used only by `full`. -/
def administered : Shape → Bool → List Role
  | .full, higher => [.base, if higher then .higher else .lower]
  | .m1Easy, _ => [.base, .lower]
  | .m1Hard, _ => [.base, .higher]
  | .m2Easy, _ => [.lower]
  | .m2Hard, _ => [.higher]

/-- `validateConverter`: every deliverable topology has a table whose
    operational count is the plan's. -/
def gateOk (c : Conv) (sec : String) (sh : Shape) (opsOf : Topology → Nat) : Prop :=
  ∀ τ ∈ topologiesFor sh, ∃ t, c.table sec τ = some t ∧ t.ops = opsOf τ

end ConvertTopo

/-! ## Scoring — backend/go/internal/delivery/start_submit.go `scoreScoringRows` -/
namespace Scoring

structure Row where
  pretest : Bool
  correct : Bool
  deriving DecidableEq, Repr

/-- One loop iteration: pretest rows `continue`; otherwise count the row and
    count it correct when the policy scorer says so. -/
def step (acc : Nat × Nat) (r : Row) : Nat × Nat :=
  if r.pretest then acc else ((if r.correct then acc.1 + 1 else acc.1), acc.2 + 1)

/-- `(rawCorrect, operationalCount)`. -/
def score (rows : List Row) : Nat × Nat := rows.foldl step (0, 0)

end Scoring

/-! ## Report — backend/go/internal/terminalization/service.go `classroomRawScoreTx` -/
namespace Report

/-- One `assessment_module_attempts` row of the report query (already in
    `ORDER BY s.display_order, m.display_order` order). `none` = SQL NULL. -/
structure DbRow (κ μ : Type) where
  sec : κ
  mod : μ
  raw : Option Int
  op  : Option Int

/-- A row that passed the `unscored` guard. -/
structure SRow (κ μ : Type) where
  sec : κ
  mod : μ
  raw : Int
  op  : Int

/-- One element of the `sections` slice. -/
structure Sec (κ μ : Type) where
  key : κ
  raw : Int
  total : Int
  mods : List (μ × Int × Int)

/-- The `classroomRaw` object (domains are best-effort and not modelled). -/
structure Summary (κ μ : Type) where
  raw : Int
  total : Int
  sections : List (Sec κ μ)

def sumBy {α : Type} (f : α → Int) : List α → Int
  | [] => 0
  | x :: xs => f x + sumBy f xs

section
variable {κ μ : Type} [DecidableEq κ]

def entry (r : SRow κ μ) : μ × Int × Int := (r.mod, r.raw, r.op)

/-- A freshly appended section: `rawCorrect: 0, total: 0, modules: []`. -/
def empty (k : κ) : Sec κ μ := ⟨k, 0, 0, []⟩

/-- `section["rawCorrect"] += c; section["total"] += t; modules = append(...)`. -/
def addRow (s : Sec κ μ) (r : SRow κ μ) : Sec κ μ :=
  { s with raw := s.raw + r.raw, total := s.total + r.op, mods := s.mods ++ [entry r] }

/-- After the fix: `sectionIndex[sectionKey]` finds the section with this key
    anywhere in the slice; otherwise a new section is appended. -/
def upsert (r : SRow κ μ) : List (Sec κ μ) → List (Sec κ μ)
  | [] => [addRow (empty r.sec) r]
  | s :: ss => if s.key = r.sec then addRow s r :: ss else s :: upsert r ss

def groupNew (rows : List (SRow κ μ)) : List (Sec κ μ) :=
  rows.foldl (fun acc r => upsert r acc) []

/-- Before the fix: a new section opened whenever the key differed from the
    *last* section's key (adjacency). The accumulator is kept reversed. -/
def stepOld (acc : List (Sec κ μ)) (r : SRow κ μ) : List (Sec κ μ) :=
  match acc with
  | s :: ss => if s.key = r.sec then addRow s r :: ss else addRow (empty r.sec) r :: s :: ss
  | [] => [addRow (empty r.sec) r]

def groupOld (rows : List (SRow κ μ)) : List (Sec κ μ) := (rows.foldl stepOld []).reverse

/-- The SQL `unscored` column: `raw IS NULL OR op IS NULL OR op <= 0`. -/
def scored (r : DbRow κ μ) : Option (SRow κ μ) :=
  match r.raw, r.op with
  | some c, some t => if t ≤ 0 then none else some ⟨r.sec, r.mod, c, t⟩
  | _, _ => none

/-- `if unscored { return nil, nil }` anywhere in the scan. -/
def scoreAll : List (DbRow κ μ) → Option (List (SRow κ μ))
  | [] => some []
  | r :: rs =>
    match scored r, scoreAll rs with
    | some s, some ss => some (s :: ss)
    | _, _ => none

/-- `classroomRawScoreTx` with the report enabled. -/
def reportOf (rows : List (DbRow κ μ)) : Option (Summary κ μ) :=
  match scoreAll rows with
  | none => none
  | some srows =>
    if (groupNew srows).isEmpty then none
    else some ⟨sumBy (·.raw) srows, sumBy (·.op) srows, groupNew srows⟩

/-- `classroomRawScoreTx`: `nil` when `sat_score_report_enabled` is off. -/
def classroomRaw (enabled : Bool) (rows : List (DbRow κ μ)) : Option (Summary κ μ) :=
  if enabled then reportOf rows else none

/-- Specification of one section: exactly the rows carrying its key, in order. -/
def secOf (rows : List (SRow κ μ)) (k : κ) : Sec κ μ :=
  ⟨k, sumBy (·.raw) (rows.filter fun r => decide (r.sec = k)),
      sumBy (·.op) (rows.filter fun r => decide (r.sec = k)),
      (rows.filter fun r => decide (r.sec = k)).map entry⟩

/-- Specification of the section order: section keys in order of first appearance. -/
def fkStep (ks : List κ) (r : SRow κ μ) : List κ := if r.sec ∈ ks then ks else ks ++ [r.sec]

def firstKeys (rows : List (SRow κ μ)) : List κ := rows.foldl fkStep []

end
end Report

/-! ## Attach — backend/go/internal/results/service.go `attachSATModules` -/
namespace Attach

/-- One `satModules` row: its section key and module key. -/
structure ModRow (κ μ : Type) where
  sec : κ
  mod : μ

variable {κ μ : Type} [DecidableEq κ] [DecidableEq μ]

/-- After the fix: `modules[i]` is nested under the section keyed
    `sectionKeys[i]` (section keys are unique: `uq_assessment_result_section`). -/
def attachNew (sections : List κ) (mods : List (ModRow κ μ)) : List (κ × List μ) :=
  sections.map fun k => (k, (mods.filter fun r => decide (r.sec = k)).map (·.mod))

/-- Before the fix: `byModule[moduleKey] = sectionKey`, last write wins. -/
def lastSec (mods : List (ModRow κ μ)) (m : μ) : Option κ :=
  mods.foldl (fun acc r => if r.mod = m then some r.sec else acc) none

def attachOld (sections : List κ) (mods : List (ModRow κ μ)) : List (κ × List μ) :=
  sections.map fun k => (k, (mods.filter fun r => decide (lastSec mods r.mod = some k)).map (·.mod))

end Attach

/-! ## Release — backend/go/internal/delivery/student_result_release.go and
    src/features/student-delivery/ui/transitions/SatScoreReport.tsx `classroomReport` -/
namespace Release

/-- `studentVisibleScoreStatuses`: sat and act show scores only when released. -/
def visibleTable (provider : String) : Option (String → Bool) :=
  if provider = "sat" ∨ provider = "act" then some (fun s => decide (s = "released")) else none

/-- `StudentResultScoreVisible`; `norm` abstracts `ToLower(TrimSpace(·))`. -/
def scoreVisible (norm : String → String) (provider status : String) : Bool :=
  if norm status = "" then false
  else match visibleTable (norm provider) with
    | some vis => vis (norm status)
    | none => decide (norm status = "released")

/-- The `sat.AssessmentResult` fields that can carry a score. -/
structure Result (V S : Type) where
  outcome : String
  release : String
  totalScore : Option Int
  payload : List (String × V)
  sections : List S

variable {V S : Type}

/-- `satReleasedProjection`: only the `classroomRaw` key survives. -/
def releasedProjection (r : Result V S) : Result V S :=
  { r with payload := match r.payload.lookup "classroomRaw" with
      | some v => [("classroomRaw", v)]
      | none => [] }

/-- `satReceiptProjection`: every score-bearing field dropped. -/
def receiptProjection (r : Result V S) : Result V S :=
  { r with totalScore := none, payload := [], sections := [] }

/-- `studentSafeBootstrapResult` for a SAT result. -/
def studentSafe (norm : String → String) (provider : String) (r : Result V S) : Result V S :=
  if scoreVisible norm provider r.release then releasedProjection r else receiptProjection r

/-- `loadBootstrapResult` (delivery/service.go): `enabled` is
    `results.SATScoreReportOpenSQL` (switch on ∧ classroom session), read live;
    closed, a result with a stored payload is cut to the receipt even when
    released. -/
def studentView (enabled : Bool) (norm : String → String) (provider : String)
    (r : Result V S) : Result V S :=
  if enabled = false ∧ r.payload.isEmpty = false then receiptProjection r
  else studentSafe norm provider r

/-- Client `classroomReport`: exact `"released"` and a `classroomRaw` value. -/
def clientReport (r : Result V S) : Option V :=
  if r.release = "released" then r.payload.lookup "classroomRaw" else none

end Release

/-! ## ResultMachine — terminalization `materializeSATResult`, `RepairClassroomResults`,
    delivery module scoring writes -/
namespace ResultMachine
open Report

inductive Outcome | pending | scored | invalidatedTimeout | invalidatedProctor
  deriving DecidableEq, Repr
inductive Rel | pending | released | invalidated
  deriving DecidableEq, Repr
inductive Actor | proctor | system
  deriving DecidableEq, Repr

/-- The single `assessment_results` row (`uq_assessment_result_attempt_provider`). -/
structure Row (κ μ : Type) where
  outcome : Outcome
  rel : Rel
  raw : Option (Summary κ μ)

structure St (κ μ : Type) where
  enabled : Bool                 -- exam_entities.sat_score_report_enabled
  classroom : Bool               -- exam_schedules.sat_session_mode = 'classroom'; written
                                 -- only in the schedule-creating tx, so no step changes it
  started : Bool                 -- ¬ satAttemptNeverStartedTx
  mods : List (DbRow κ μ)        -- assessment_module_attempts (report order)
  sealed : Bool                  -- attempt terminal (receipt committed)
  result : Option (Row κ μ)

/-- `SATOutcomeStatus` for a terminated outcome. -/
def wantTerminated (a : Actor) : Outcome :=
  if a = .proctor then .invalidatedProctor else .invalidatedTimeout

variable {κ μ : Type} [DecidableEq κ]

/-- `results.SATScoreReportOpenSQL`: the report switch is on and the attempt
    sat a classroom session. -/
def St.reportOpen (s : St κ μ) : Bool := s.enabled && s.classroom

/-- `materializeSATResult` for `OutcomeSubmitted`. `readFails` models the
    TC-15 path where `classroomRawScoreTx` errors and the result stays pending. -/
def submit (s : St κ μ) (readFails : Bool) : St κ μ :=
  if s.started = false then { s with sealed := true } else
  match s.result with
  | some _ => { s with sealed := true }
  | none =>
    match (if readFails then none else classroomRaw s.reportOpen s.mods) with
    | some rep => { s with sealed := true, result := some ⟨.scored, .released, some rep⟩ }
    | none => { s with sealed := true, result := some ⟨.pending, .pending, none⟩ }

/-- `materializeSATResult` for `OutcomeTerminated`. -/
def terminate (s : St κ μ) (a : Actor) : St κ μ :=
  if s.started = false then { s with sealed := true } else
  match s.result with
  | some row =>
    if row.outcome = wantTerminated a then { s with sealed := true }
    else { s with sealed := true, result := some ⟨wantTerminated a, .invalidated, none⟩ }
  | none => { s with sealed := true, result := some ⟨wantTerminated a, .invalidated, none⟩ }

/-- One `RepairClassroomResults` row (`outcome_status = 'pending' AND
    release_status = 'pending'`, guarded UPDATE). A failed read rolls back. -/
def repair (s : St κ μ) : St κ μ :=
  match s.result with
  | some row =>
    if row.outcome = .pending ∧ row.rel = .pending then
      match classroomRaw s.reportOpen s.mods with
      | some rep => { s with result := some ⟨.scored, .released, some rep⟩ }
      | none => s
    else s
  | none => s

/-- Environment and service steps. -/
inductive Step : St κ μ → St κ μ → Prop
  /-- A module attempt whose score columns are NULL gets scored (module close,
      timer sweep). Any values, any time: an over-approximation. -/
  | lateScore (s : St κ μ) (i : Nat) (r : DbRow κ μ) (c t : Int) :
      s.mods[i]? = some r → (r.raw = none ∨ r.op = none) →
      Step s { s with mods := s.mods.set i { r with raw := some c, op := some t } }
  /-- `repairTimeoutFinalizedModuleTx` rescoring a scored module. Fenced by
      `ensureAttemptCanWorkTx` (attempt row `FOR UPDATE`, rejects terminal). -/
  | rescore (s : St κ μ) (i : Nat) (r : DbRow κ μ) (c t : Int) :
      s.sealed = false → s.mods[i]? = some r →
      Step s { s with mods := s.mods.set i { r with raw := some c, op := some t } }
  /-- Staff toggles `sat_score_report_enabled`. -/
  | toggle (s : St κ μ) (b : Bool) : Step s { s with enabled := b }
  | submit (s : St κ μ) (readFails : Bool) : Step s (submit s readFails)
  | terminate (s : St κ μ) (a : Actor) : Step s (terminate s a)
  | repair (s : St κ μ) : Step s (repair s)

/-- Every attempt starts unsealed with no result row; module rows arbitrary. -/
def Init (s : St κ μ) : Prop := s.result = none ∧ s.sealed = false

inductive Reachable : St κ μ → Prop
  | init (s : St κ μ) : Init s → Reachable s
  | step (s s' : St κ μ) : Reachable s → Step s s' → Reachable s'

inductive Star : St κ μ → St κ μ → Prop
  | refl (s : St κ μ) : Star s s
  | tail (s t u : St κ μ) : Star s t → Step t u → Star s u

end ResultMachine

/-! ## RepairQueue — terminalization `RepairClassroomResults` batch selection
    (A-FAIR / LIVE-1). The queue is the `pending/pending` classroom rows with
    the gate on, in `updated_at, id` order. Readiness is static here: no rescore
    or switch flip during the sweeps (those only remove rows from the queue). -/
namespace RepairQueue
open Report

section
variable {κ μ : Type} [DecidableEq κ]

/-- The readiness filter `classroomPendingSQL` adds (post-fix): some module
    row exists and none has `raw IS NULL OR op IS NULL OR op <= 0`. -/
def sqlReady (rows : List (DbRow κ μ)) : Bool :=
  !rows.isEmpty && rows.all fun r => (scored r).isSome
end

variable {α : Type}

/-- Pre-fix sweep: the `LIMIT k` oldest rows are read; releasable ones leave the
    queue, the rest keep their place (their `updated_at` is never touched). -/
def sweepOld (ready : α → Bool) (k : Nat) (q : List α) : List α :=
  (q.take k).filter (fun x => !ready x) ++ q.drop k

/-- Post-fix sweep: only releasable rows are selected and the `LIMIT k` oldest
    of them leave. (Unselected rows are listed first; a sweep reads only the
    releasable subsequence, whose order is kept.) -/
def sweep (ready : α → Bool) (k : Nat) (q : List α) : List α :=
  q.filter (fun x => !ready x) ++ (q.filter ready).drop k

/-- `n` successive sweeps (worker ticks, on any instances). -/
def runs (f : List α → List α) : Nat → List α → List α
  | 0, q => q
  | n + 1, q => runs f n (f q)

end RepairQueue

/-! ## Paper — SatScoreReport.tsx `AnsweredExamPaper` -/
namespace Paper

variable {α : Type} [DecidableEq α]

/-- Options drawn with the selection ring: `answer === option.id`. -/
def circled (opts : List α) (a : Option α) : List α := opts.filter fun o => decide (a = some o)

/-- "Recorded answer … matches none of the listed choices." -/
def unmatched (opts : List α) (a : Option α) : Bool :=
  match a with
  | some x => !(decide (x ∈ opts))
  | none => false

/-- "Unanswered". -/
def unanswered (a : Option α) : Bool := a.isNone

/-- One saved response: module attempt, exam question, trimmed value
    (`none` for empty / non-string). -/
structure Resp (ρ ε α : Type) where
  att : ρ
  qid : ε
  value : Option α

section
variable {ρ μ ε : Type} [DecidableEq μ] [DecidableEq ε]

/-- The map key of a response; `none` when its module attempt is not in the
    administered list (`moduleKeyByAttempt` miss → skipped). -/
def keyOf (modOf : ρ → Option μ) (r : Resp ρ ε α) : Option (μ × ε) :=
  (modOf r.att).map fun m => (m, r.qid)

/-- One `answers.set(...)`; blank answers are skipped. -/
def upd (modOf : ρ → Option μ) (f : μ × ε → Option α) (r : Resp ρ ε α) : μ × ε → Option α :=
  match keyOf modOf r, r.value with
  | some k', some v => fun k => if k = k' then some v else f k
  | _, _ => f

/-- The `answers` map keyed `${moduleId}:${examQuestionId}`. -/
def answerMap (modOf : ρ → Option μ) (rs : List (Resp ρ ε α)) : μ × ε → Option α :=
  rs.foldl (upd modOf) (fun _ => none)

end

/-- `data-complete`: `printable.size === administered.size`, printable ⊆ administered. -/
def complete {μ : Type} (administered : List μ) (printable : μ → Bool) : Bool :=
  (administered.filter printable).length == administered.length

end Paper

/-! ## PrintGate — SatScoreReport.tsx `printAnsweredExam` -/
namespace PrintGate

inductive Phase | idle | reloading | polling (g : Nat)
  deriving DecidableEq, Repr

/-- What `window.print()` captured. -/
structure Print where
  gen : Nat           -- the flow's generation
  paperGen : Nat      -- data-generation of the mounted paper
  complete : Bool     -- data-complete
  decoded : Bool      -- every <figure> has a decoded <img>
  failed : Bool       -- mediaFailed
  clickEpoch : Nat    -- source freshness when the click started
  flowEpoch : Nat     -- freshness delivered by this flow's reload
  renderEpoch : Nat   -- freshness of the source the paper was rendered from
  deriving DecidableEq, Repr

structure St where
  busy : Bool         -- inFlight ref
  phase : Phase
  gen : Nat           -- generationRef
  reqGen : Nat        -- paperGeneration state
  paperGen : Nat      -- mounted paper's data-generation (0 = none)
  renderEpoch : Nat
  complete : Bool
  decoded : Bool
  mediaFailed : Bool
  epoch : Nat         -- count of successful authoritative reloads
  clickEpoch : Nat
  flowEpoch : Nat
  printed : List Print

/-- Component mount: all refs and state at their initial values. -/
def init : St := ⟨false, .idle, 0, 0, 0, 0, false, false, false, 0, 0, 0, []⟩

def snapshot (s : St) (g : Nat) : Print :=
  ⟨g, s.paperGen, s.complete, s.decoded, s.mediaFailed, s.clickEpoch, s.flowEpoch, s.renderEpoch⟩

inductive Step : St → St → Prop
  /-- Download clicked while no flow is in flight. -/
  | click (s : St) : s.busy = false →
      Step s { s with busy := true, phase := .reloading, mediaFailed := false, clickEpoch := s.epoch }
  /-- `answered.reload()` resolved false or threw. -/
  | reloadFail (s : St) : s.phase = .reloading → Step s { s with busy := false, phase := .idle }
  /-- `answered.reload()` resolved true; `++generationRef`, `setPaperGeneration`. -/
  | reloadOk (s : St) : s.phase = .reloading →
      Step s { s with epoch := s.epoch + 1, flowEpoch := s.epoch + 1, gen := s.gen + 1,
                      reqGen := s.gen + 1, phase := .polling (s.gen + 1) }
  /-- React mounts the paper for the requested generation (key change); its
      completeness and figure decoding are arbitrary. -/
  | render (s : St) (c d : Bool) : 0 < s.reqGen →
      Step s { s with paperGen := s.reqGen, renderEpoch := s.epoch, complete := c, decoded := d }
  /-- The mounted paper re-renders from the current source or images settle. -/
  | env (s : St) (c d : Bool) : 0 < s.paperGen →
      Step s { s with renderEpoch := s.epoch, complete := c, decoded := d }
  /-- A figure reports `onMediaFailure`. -/
  | mediaFail (s : St) : Step s { s with mediaFailed := true }
  /-- Poll tick: `if (mediaFailed.current) break`. -/
  | pollFail (s : St) (g : Nat) : s.phase = .polling g → s.mediaFailed = true →
      Step s { s with busy := false, phase := .idle }
  /-- Poll tick: generation matches and `answeredPaperReady` → `window.print()`. -/
  | pollPrint (s : St) (g : Nat) : s.phase = .polling g → s.mediaFailed = false →
      s.paperGen = g → s.complete = true → s.decoded = true →
      Step s { s with busy := false, phase := .idle, printed := s.printed ++ [snapshot s g] }
  /-- Deadline passed: explicit failure. -/
  | timeout (s : St) (g : Nat) : s.phase = .polling g →
      Step s { s with busy := false, phase := .idle }

inductive Reachable : St → Prop
  | init : Reachable init
  | step (s s' : St) : Reachable s → Step s s' → Reachable s'

/-- Before the fix: the button called `window.print()` on whatever was mounted. -/
inductive OldStep : St → St → Prop
  | click (s : St) : OldStep s { s with printed := s.printed ++
      [⟨s.gen, s.paperGen, s.complete, s.decoded, s.mediaFailed, s.epoch, s.epoch, s.renderEpoch⟩] }

end PrintGate

/-! ## CloseAck — useSatExamController `applyCloseAck` vs. the authoritative read -/
namespace CloseAck

structure St (α : Type) where
  server : Option α      -- authoritative accepted answer
  cache : Option α       -- client source the paper renders from
  isOpen : Bool          -- module accepts saves
  inflight : Option α    -- a save not yet applied by the server

inductive Step {α : Type} : St α → St α → Prop
  | edit (s : St α) (v : α) : s.isOpen = true → Step s { s with cache := some v, inflight := some v }
  | deliver (s : St α) (v : α) : s.inflight = some v →
      Step s { s with server := if s.isOpen then some v else s.server, inflight := none }
  | close (s : St α) : Step s { s with isOpen := false }
  /-- `applyCloseAck` keeps the cached responses. -/
  | closeAck (s : St α) : Step s s
  /-- `reloadAttempt`: authoritative bootstrap read (read-after-write). -/
  | reload (s : St α) : Step s { s with cache := s.server }

inductive Star {α : Type} : St α → St α → Prop
  | refl (s : St α) : Star s s
  | tail (s t u : St α) : Star s t → Step t u → Star s u

end CloseAck
