import Safety

/-! # Counterexamples and anti-vacuity witnesses

Concrete, kernel-evaluated traces: each pre-fix behaviour that violated
docs/sat-result.md, each documented limitation, and a witness that every
"only if" theorem in Safety.lean has a reachable positive case. -/

inductive SecK | rw | math
  deriving DecidableEq, Repr

/-! ## Convert -/
namespace Convert

/-- A table whose only entry for raw 5 is `null`. -/
def nullTable : Table := fun _ _ r => if r = 5 then some .null else none

/-- BUG (fixed): `null` yielded a fabricated 0 with no table integer. -/
theorem old_fabricates_from_null :
    convertGoOld nullTable "math" "lower" 5 = some 0 ∧
    nullTable "math" "lower" 5 ≠ some (.int 0) ∧
    convert nullTable "math" "lower" 5 = none := by
  decide

/-- BUG (fixed): an out-of-scale integer (a typo 7000) was reported. -/
theorem old_accepts_out_of_range :
    convertGoOld (fun _ _ _ => some (.int 7000)) "math" "lower" 0 = some 7000 ∧
    convert (fun _ _ _ => some (.int 7000)) "math" "lower" 0 = none := by
  decide

end Convert

/-! ## Report -/
namespace Report

/-- RW and Math modules interleaved in query order. -/
def rows4 : List (SRow SecK Nat) :=
  [⟨.rw, 1, 5, 10⟩, ⟨.math, 1, 4, 10⟩, ⟨.rw, 2, 6, 10⟩, ⟨.math, 2, 3, 10⟩]

/-- BUG (fixed). Cited by terminalization/classroom_raw_test.go: adjacency
    grouping emitted four sections with duplicate keys; the keyed grouping
    emits one section per key with the module scores summed. -/
theorem adjacent_duplicates :
    (groupOld rows4).map (·.key) = [.rw, .math, .rw, .math] ∧
    (groupOld rows4).map (fun s => (s.raw, s.total)) = [(5, 10), (4, 10), (6, 10), (3, 10)] ∧
    (groupNew rows4).map (·.key) = [.rw, .math] ∧
    (groupNew rows4).map (fun s => (s.raw, s.total)) = [(11, 20), (7, 20)] := by
  decide

def dbRows4 : List (DbRow SecK Nat) := rows4.map fun r => ⟨r.sec, r.mod, some r.raw, some r.op⟩

/-- Anti-vacuity: a fully scored attempt does get a report. -/
theorem report_exists :
    (reportOf dbRows4).map (fun r => (r.raw, r.total, r.sections.length)) = some (18, 40, 2) := by
  decide

/-- One unscored (NULL) module, or a zero-operational module, withholds it. -/
theorem report_withheld :
    (reportOf (dbRows4 ++ [⟨.math, 3, none, none⟩])).isNone = true ∧
    (reportOf (dbRows4 ++ [⟨.math, 3, some 0, some 0⟩])).isNone = true := by
  decide

end Report

/-! ## Attach -/
namespace Attach

def mods2 : List (ModRow SecK Nat) := [⟨.rw, 1⟩, ⟨.math, 1⟩]

/-- BUG (fixed): module key 1 exists in both sections; last-write-wins put both
    under Math and left RW empty. -/
theorem old_misattaches :
    attachOld [.rw, .math] mods2 = [(.rw, []), (.math, [1, 1])] ∧
    attachNew [.rw, .math] mods2 = [(.rw, [1]), (.math, [1])] := by
  decide

end Attach

/-! ## Paper -/
namespace Paper

/-- BUG (fixed): an answer matching no option circled nothing and was not
    "Unanswered" — the paper showed no indication at all. The unmatched note
    now covers it. -/
theorem unmatched_was_silent :
    circled [1, 2, 3] (some 9) = [] ∧ unanswered (some 9) = false ∧
    unmatched [1, 2, 3] (some 9) = true := by
  decide

/-- Assumption A-OPT needed: with duplicate option ids two rings are drawn. -/
theorem duplicate_ids_double_circle : circled [1, 1, 2] (some 1) = [1, 1] := by decide

end Paper

/-! ## Release -/
namespace Release

/-- A released result whose stored payload holds a raw summary. -/
def rel1 : Result Nat Nat := ⟨"scored", "released", none, [("classroomRaw", 7), ("answers", 1)], []⟩

/-- Anti-vacuity and the live flag: the report is shown with the flag on and
    hidden again once staff turn it off. -/
theorem flag_off_hides_released :
    clientReport (studentView true id "sat" rel1) = some 7 ∧
    clientReport (studentView false id "sat" rel1) = none := by
  decide

end Release

/-! ## ResultMachine -/
namespace ResultMachine

/-- A started classroom attempt whose only module is fully scored. -/
def good : St SecK Nat := ⟨true, true, true, [⟨.rw, 1, some 7, some 10⟩], false, none⟩

/-- A started classroom attempt whose only module has no operational questions. -/
def zeroOp : St SecK Nat := ⟨true, true, true, [⟨.rw, 1, some 0, some 0⟩], false, none⟩

/-- The same fully scored attempt in a Standard Practice session of an exam
    whose report switch is on (e.g. backfilled by migration 0085). -/
def practice : St SecK Nat := { good with classroom := false }

/-- BUG (fixed, REG-01): gating on the switch alone released the report of a
    Standard Practice sitting. `classroomRaw` with the old gate (`enabled`) is
    the pre-fix `classroomRawScoreTx`. -/
theorem old_gate_releases_practice :
    practice.classroom = false ∧
      (Report.classroomRaw practice.enabled practice.mods).isSome = true := by
  decide

/-- Fixed: the same sitting stays withheld at submit and under every later
    schedule. -/
theorem practice_withheld :
    (submit practice false).result.map (·.rel) = some .pending ∧
    ∀ s', Star (submit practice false) s' → ∀ row, s'.result = some row → row.rel ≠ .released := by
  refine ⟨by decide, fun s' hs => practice_never_released _ s' hs rfl ?_⟩
  intro row h
  have hr : (submit practice false).result.map (·.rel) = some .pending := by decide
  rw [h] at hr; simp at hr; rw [hr]; decide

theorem good_init : Init good := ⟨rfl, rfl⟩
theorem zeroOp_init : Init zeroOp := ⟨rfl, rfl⟩

/-- Anti-vacuity: the released state of `released_report_faithful` is reachable. -/
theorem release_reachable :
    Reachable (submit good false) ∧
    (submit good false).result.map (·.rel) = some .released := by
  exact ⟨.step _ _ (.init _ good_init) (.submit _ false), by decide⟩

/-- LIMITATION (liveness): a zero-operational module leaves the result pending
    forever — reachable, and stuck under every later schedule. -/
theorem zero_op_stuck :
    Reachable (submit zeroOp false) ∧
    (submit zeroOp false).result.map (fun r => (r.outcome, r.rel)) = some (.pending, .pending) ∧
    ∀ s', Star (submit zeroOp false) s' → ∀ row, s'.result = some row → row.rel ≠ .released := by
  refine ⟨.step _ _ (.init _ zeroOp_init) (.submit _ false), by decide, ?_⟩
  intro s' hs
  exact zero_op_never_released _ s' 0 ⟨.rw, 1, some 0, some 0⟩ 0 0 rfl rfl rfl rfl
    (Int.le_refl 0) (by
      intro row h
      have hr : (submit zeroOp false).result.map (·.rel) = some .pending := by decide
      rw [h] at hr; simp at hr; rw [hr]; decide) hs

/-- LIMITATION: a released result is invalidated by a later termination. -/
theorem released_then_invalidated :
    (terminate (submit good false) .proctor).result.map (fun r => (r.outcome, r.rel)) =
      some (.invalidatedProctor, .invalidated) := by
  decide

/-- LIMITATION (spec question): turning the flag on after submission lets the
    repair job release an older pending result. -/
theorem flag_late_release :
    let a := submit { good with enabled := false } false
    a.result.map (·.rel) = some .pending ∧
    (repair { a with enabled := true }).result.map (·.rel) = some .released := by
  decide

end ResultMachine

/-! ## PrintGate -/
namespace PrintGate

/-- Anti-vacuity: the gate can print (click → reload → render → poll). -/
theorem print_reachable : ∃ s, Reachable s ∧ s.printed ≠ [] := by
  refine ⟨_, .step _ _ (.step _ _ (.step _ _ (.step _ _ .init (.click _ rfl))
    (.reloadOk _ rfl)) (.render _ true true (by decide))) (.pollPrint _ 1 rfl rfl rfl rfl rfl), ?_⟩
  simp

/-- BUG (fixed): printing on click captured whatever was mounted — here an
    incomplete paper not refreshed after the click. -/
theorem old_prints_unready :
    ∃ s, OldStep init s ∧ ∃ p ∈ s.printed, p.complete = false ∧ ¬ p.clickEpoch < p.flowEpoch := by
  refine ⟨_, .click init, ?_⟩
  simp [init]

end PrintGate

/-! ## CloseAck -/
namespace CloseAck

/-- BUG (fixed): an edit in flight at close is rejected by the server, yet the
    close ack keeps it in the client cache, so a paper printed from the cache
    shows an answer the server never accepted. -/
theorem close_ack_stale :
    ∃ s : St Nat, Star ⟨none, none, true, none⟩ s ∧
      s.isOpen = false ∧ s.cache = some 7 ∧ s.server = none := by
  exact ⟨_, .tail _ _ _ (.tail _ _ _ (.tail _ _ _ (.tail _ _ _ (.refl _) (.edit _ 7 rfl))
    (.close _)) (.deliver _ 7 rfl)) (.closeAck _), rfl, rfl, rfl⟩

end CloseAck

/-! ## ConvertTopo -/
namespace ConvertTopo

/-- A converter with 22-question full tables only, and no standalone table. -/
def fullOnly : Conv := ⟨fun _ τ => if τ.full then some ⟨22, fun _ => ⟨500, 500⟩⟩ else none⟩

theorem fullOnly_valid : fullOnly.valid := by
  intro sec τ t h
  cases τ <;> simp [fullOnly, Topology.full] at h <;> subst h <;>
    exact ⟨by decide, fun _ _ => by simp only [Score.valid]; decide⟩

/-- BUG (fixed, SC-04): keyed by route, a standalone lower Module 2 read the
    full lower table and got a number; the topology-exact converter refuses. -/
theorem old_reuses_full_for_standalone :
    convertOld (some fullOnly) "math" .m2LowerOnly 10 = some ⟨500, 500⟩ ∧
      convert (some fullOnly) "math" .m2LowerOnly 10 22 = none := ⟨rfl, rfl⟩

/-- BUG (fixed, SC-05): without an operational-count check a 21-question
    attempt read the 22-question table; the new converter refuses. -/
theorem old_ignores_operational_count :
    convertOld (some fullOnly) "math" .fullLower 10 = some ⟨500, 500⟩ ∧
      convert (some fullOnly) "math" .fullLower 10 21 = none := ⟨rfl, rfl⟩

/-- A range entry (raw 1) next to point entries. -/
def ranged : Conv := ⟨fun _ τ => if τ.full then some ⟨2, fun r => if r = 1 then ⟨210, 230⟩ else ⟨500, 500⟩⟩ else none⟩

/-- Anti-vacuity: two full sections give a section pair and a total; ranges
    are preserved and summed (§2), so `total_sound` has a positive case. -/
theorem total_witness :
    sectionScore (some ranged) "reading-writing" [.base, .lower] 1 2 = some (.fullLower, ⟨210, 230⟩) ∧
      sectionScore (some ranged) "math" [.higher, .base] 2 2 = some (.fullHigher, ⟨500, 500⟩) ∧
      total (some (.fullLower, ⟨210, 230⟩)) (some (.fullHigher, ⟨500, 500⟩)) = some ⟨710, 730⟩ := by
  decide

/-- Anti-vacuity: a standalone section with its own table converts, but never
    contributes to a total (SC-02). -/
theorem standalone_witness :
    sectionScore (some ⟨fun _ _ => some ⟨2, fun _ => ⟨400, 400⟩⟩⟩) "math" [.lower] 1 2 =
        some (.m2LowerOnly, ⟨400, 400⟩) ∧
      total (some (.fullLower, ⟨500, 500⟩)) (some (.m2LowerOnly, ⟨400, 400⟩)) = none := by
  decide

/-- Anti-vacuity: the gate has a converter that passes it. -/
theorem gate_witness : gateOk fullOnly "math" .full (fun _ => 22) := by
  intro τ hτ
  simp [topologiesFor] at hτ
  rcases hτ with rfl | rfl <;> exact ⟨_, rfl, rfl⟩

end ConvertTopo

/-! ## RepairQueue -/
namespace RepairQueue

/-- BUG (fixed). Cited by TestSATClassroomRepairNotStarvedByWithheldMySQL: one
    withheld row (`false`) ahead of a releasable one (`true`), batch 1. Pre-fix
    the releasable row survives every number of sweeps; post-fix one sweep
    releases it. -/
theorem old_starves_ready (n : Nat) :
    true ∈ runs (sweepOld id 1) n [false, true] ∧
    (runs (sweep id 1) 1 [false, true]).filter id = [] := by
  rw [old_runs_stuck id 1 n [false, true] (by decide)]
  decide

/-- Anti-vacuity for `sqlReady_iff`: the filter admits a scored row and rejects
    no rows, a NULL score, and a zero operational count. -/
theorem sqlReady_witness :
    sqlReady ([] : List (Report.DbRow SecK Nat)) = false ∧
    sqlReady [(⟨.rw, 1, some 2, some 3⟩ : Report.DbRow SecK Nat)] = true ∧
    sqlReady [(⟨.rw, 1, none, some 3⟩ : Report.DbRow SecK Nat)] = false ∧
    sqlReady [(⟨.rw, 1, some 0, some 0⟩ : Report.DbRow SecK Nat)] = false := by
  decide
end RepairQueue
