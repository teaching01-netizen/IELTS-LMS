/-!
# Answer retention: a typed answer is never silently lost

Write ids are `Nat`. The client record of a write is what
`DurableResponseEngine` keeps in memory + IndexedDB/localStorage; the server
record is `attempt_responses_v2`; `snapshot` is the module-close scoring
snapshot; `evidence` is `assessment_late_answer_evidence`.

Environment faults are explicit actions: transient send failure (401, 5xx,
timeout, offline), ACK loss, crash/reload. Wiping browser storage is NOT an
action of the proved model; `wipe_breaks_retention` shows it is the boundary.
-/
namespace SatSessionContinuity.Retention

inductive WStatus where
  /-- durably accepted on the device, not yet acknowledged by the server -/
  | pending
  /-- server acknowledged -/
  | acked
  /-- refused because its module closed; archived on device as evidence -/
  | quarantined
  deriving DecidableEq, Repr

structure RState where
  status : Nat → Option WStatus
  server : Nat → Bool
  closed : Bool
  snapshot : Nat → Bool
  evidence : Nat → Bool

def init : RState where
  status := fun _ => none
  server := fun _ => false
  closed := false
  snapshot := fun _ => false
  evidence := fun _ => false

def setStatus (s : RState) (w : Nat) (v : WStatus) : RState :=
  { s with status := fun x => if x = w then some v else s.status x }

def setServer (s : RState) (w : Nat) : RState :=
  { s with server := fun x => if x = w then true else s.server x }

inductive Step : RState → RState → Prop where
  /-- student answers; the engine durably accepts the write locally -/
  | create (s : RState) (w : Nat) (h : s.status w = none) :
      Step s (setStatus s w .pending)
  /-- server commits the write (module open) and the ACK arrives -/
  | sendAck (s : RState) (w : Nat) (h : s.status w = some .pending) (ho : s.closed = false) :
      Step s (setStatus (setServer s w) w .acked)
  /-- server commits the write but the ACK is lost (client keeps it pending) -/
  | sendAckLost (s : RState) (w : Nat) (h : s.status w = some .pending) (ho : s.closed = false) :
      Step s (setServer s w)
  /-- 401 / 5xx / timeout / offline: nothing changes; the engine retries -/
  | sendTransient (s : RState) (w : Nat) (h : s.status w = some .pending) :
      Step s s
  /-- recovery reads the server snapshot and finds the exact write id -/
  | recoverAcked (s : RState) (w : Nat) (h : s.status w = some .pending) (hs : s.server w = true) :
      Step s (setStatus s w .acked)
  /-- server refuses because the module closed: archive-before-delete quarantine -/
  | sendClosed (s : RState) (w : Nat) (h : s.status w = some .pending) (hc : s.closed = true) :
      Step s (setStatus s w .quarantined)
  /-- module close freezes the scoring snapshot from the server rows -/
  | close (s : RState) (ho : s.closed = false) :
      Step s { s with closed := true, snapshot := s.server }
  /-- page crash / reload / iPad sleep: durable client state survives -/
  | reload (s : RState) : Step s s
  /-- late evidence upload of a quarantined write (needs a working session) -/
  | uploadLate (s : RState) (w : Nat) (h : s.status w = some .quarantined) :
      Step s { s with evidence := fun x => if x = w then true else s.evidence x }

inductive Reach : RState → Prop where
  | init : Reach init
  | step {s t : RState} : Reach s → Step s t → Reach t

/-- Conjunction of the retention invariants. -/
structure Good (s : RState) : Prop where
  /-- an ACK shown to the student means the server holds the write -/
  ackTruthful : ∀ w, s.status w = some .acked → s.server w = true
  /-- the server never holds a write the client never made -/
  serverFromClient : ∀ w, s.server w = true → s.status w ≠ none
  /-- after close, the scoring snapshot is exactly the server rows -/
  snapshotExact : ∀ w, s.closed = true → s.snapshot w = s.server w
  /-- before close nothing is in a snapshot -/
  noEarlySnapshot : ∀ w, s.closed = false → s.snapshot w = false
  /-- only quarantined writes become evidence -/
  evidenceQuarantined : ∀ w, s.evidence w = true → s.status w = some .quarantined
  /-- quarantine only ever happens after close -/
  quarantineAfterClose : ∀ w, s.status w = some .quarantined → s.closed = true

theorem good_init : Good init := by
  refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩ <;> intros <;> simp_all [init]

theorem good_step {s t : RState} (hg : Good s) (hs : Step s t) : Good t := by
  obtain ⟨hA, hSF, hSE, hNE, hEQ, hQC⟩ := hg
  cases hs with
  | create w h =>
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩ <;> intro x <;> simp only [setStatus] <;>
      by_cases hx : x = w <;> (try simp_all) <;>
      first | done | exact hQC x | exact hA x | exact hSF x |
        (cases hev : s.evidence w <;> (try have := hEQ w hev) <;> (try simp_all))
  | sendAck w h ho =>
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩ <;> intro x <;> simp only [setStatus, setServer] <;>
      by_cases hx : x = w <;> (try simp_all) <;>
      first | done | exact hQC x | exact hA x | exact hSF x |
        (cases hev : s.evidence w <;> (try have := hEQ w hev) <;> (try simp_all))
  | sendAckLost w h ho =>
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩ <;> intro x <;> simp only [setServer] <;>
      by_cases hx : x = w <;> (try simp_all) <;>
      first | done | exact hQC x | exact hA x | exact hSF x |
        (cases hev : s.evidence w <;> (try have := hEQ w hev) <;> (try simp_all))
  | sendTransient w h => exact ⟨hA, hSF, hSE, hNE, hEQ, hQC⟩
  | recoverAcked w h hsv =>
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩ <;> intro x <;> simp only [setStatus] <;>
      by_cases hx : x = w <;> (try simp_all) <;>
      first | done | exact hQC x | exact hA x | exact hSF x |
        (cases hev : s.evidence w <;> (try have := hEQ w hev) <;> (try simp_all))
  | sendClosed w h hc =>
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩ <;> intro x <;> simp only [setStatus] <;>
      by_cases hx : x = w <;> (try simp_all) <;>
      first | done | exact hQC x | exact hA x | exact hSF x |
        (cases hev : s.evidence w <;> (try have := hEQ w hev) <;> (try simp_all))
  | close ho =>
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩ <;> intro x <;> simp_all
  | reload => exact ⟨hA, hSF, hSE, hNE, hEQ, hQC⟩
  | uploadLate w h =>
    refine ⟨hA, hSF, hSE, hNE, ?_, hQC⟩
    intro x hx'
    by_cases hx : x = w
    · subst hx; exact h
    · simp only [hx, if_false] at hx'; exact hEQ x hx'

theorem good_reach {s : RState} (h : Reach s) : Good s := by
  induction h with
  | init => exact good_init
  | step _ hs ih => exact good_step ih hs

/-- No step ever forgets a write the client has recorded. -/
theorem step_keeps_record {s t : RState} (hs : Step s t) (w : Nat)
    (hw : s.status w ≠ none) : t.status w ≠ none := by
  cases hs <;> simp_all [setStatus, setServer] <;> split <;> simp_all

/-- A server row is never removed. -/
theorem step_keeps_server {s t : RState} (hs : Step s t) (w : Nat)
    (hw : s.server w = true) : t.server w = true := by
  cases hs <;> simp_all [setStatus, setServer] <;> split <;> simp_all

inductive ReachFrom : RState → RState → Prop where
  | refl (s : RState) : ReachFrom s s
  | step {s t u : RState} : ReachFrom s t → Step t u → ReachFrom s u

/-- **Theorem R1 (no silent loss).** Once the student's answer is durably
accepted on the device, in every later state — through 401s, server errors,
lost ACKs, reloads and module close — it is still recorded: pending on the
device, acknowledged by the server, or quarantined as evidence. -/
theorem answer_never_silently_lost {s u : RState} (h : ReachFrom s u) (w : Nat)
    (hw : s.status w ≠ none) : u.status w ≠ none := by
  induction h with
  | refl => exact hw
  | step _ hs ih => exact step_keeps_record hs w ih

/-- **Theorem R2 (every saved answer is scored).** In every reachable state
after module close, a write the server accepted is in the scoring snapshot,
and every write the student was shown as saved (ACK) is in the snapshot. -/
theorem saved_answer_scored {s : RState} (h : Reach s) (hc : s.closed = true) (w : Nat)
    (hs : s.server w = true ∨ s.status w = some .acked) : s.snapshot w = true := by
  have g := good_reach h
  rw [g.snapshotExact w hc]
  rcases hs with hs | hs
  · exact hs
  · exact g.ackTruthful w hs

/-- **Theorem R3 (complete accounting).** Every answer the student ever made
is scored (a server row) or still on the device — pending for retry, or
quarantined as late evidence. A write whose ACK was lost before close can be
both scored and quarantined: a duplicate, never a loss. -/
theorem answer_accounted {s : RState} (h : Reach s) (w : Nat) (hw : s.status w ≠ none) :
    s.server w = true ∨ s.status w = some .pending ∨ s.status w = some .quarantined := by
  have g := good_reach h
  cases hst : s.status w with
  | none => exact absurd hst hw
  | some v =>
    cases v with
    | pending => exact Or.inr (Or.inl rfl)
    | acked => exact Or.inl (g.ackTruthful w hst)
    | quarantined => exact Or.inr (Or.inr rfl)

/-- The duplicate case is real (anti-vacuity for R3's wording): the server
holds the write AND the device quarantined it. -/
theorem ackLost_then_closed_is_duplicate :
    ∃ s, Reach s ∧ s.server 0 = true ∧ s.snapshot 0 = true ∧
      s.status 0 = some .quarantined := by
  let s1 := setStatus init 0 .pending
  let s2 := setServer s1 0
  let s3 : RState := { s2 with closed := true, snapshot := s2.server }
  let s4 := setStatus s3 0 .quarantined
  have r1 : Reach s1 := .step .init (.create init 0 rfl)
  have r2 : Reach s2 := .step r1 (.sendAckLost s1 0 (by simp [s1, setStatus]) rfl)
  have r3 : Reach s3 := .step r2 (.close s2 rfl)
  have r4 : Reach s4 := .step r3
    (.sendClosed s3 0 (by simp [s3, s2, s1, setStatus, setServer]) rfl)
  exact ⟨s4, r4, by simp [s4, s3, s2, setStatus, setServer],
    by simp [s4, s3, s2, setStatus, setServer], by simp [s4, setStatus]⟩

/-- Boundary (anti-vacuity): if browser storage could be wiped, R1 fails. -/
def wipe (s : RState) : RState := { s with status := fun _ => none }

theorem wipe_breaks_retention :
    ∃ s : RState, s.status 0 ≠ none ∧ (wipe s).status 0 = none :=
  ⟨setStatus init 0 .pending, by simp [setStatus], rfl⟩

/-- Non-vacuity: the model can actually reach a closed module with a scored
answer, a lost-ACK answer and a quarantined late answer. -/
theorem nonvacuous_trace :
    ∃ s, Reach s ∧ s.closed = true ∧ s.snapshot 0 = true ∧ s.snapshot 1 = true ∧
      s.status 2 = some .quarantined := by
  let s1 := setStatus init 0 .pending
  let s2 := setStatus (setServer s1 0) 0 .acked
  let s3 := setStatus s2 1 .pending
  let s4 := setServer s3 1
  let s5 := setStatus s4 2 .pending
  let s6 : RState := { s5 with closed := true, snapshot := s5.server }
  let s7 := setStatus s6 2 .quarantined
  have r1 : Reach s1 := .step .init (.create init 0 rfl)
  have r2 : Reach s2 := .step r1 (.sendAck s1 0 (by simp [s1, setStatus]) rfl)
  have r3 : Reach s3 := .step r2 (.create s2 1 (by simp [s2, s1, setStatus, setServer, init]))
  have r4 : Reach s4 := .step r3 (.sendAckLost s3 1 (by simp [s3, setStatus]) rfl)
  have r5 : Reach s5 := .step r4 (.create s4 2 (by simp [s4, s3, s2, s1, setStatus, setServer, init]))
  have r6 : Reach s6 := .step r5 (.close s5 rfl)
  have r7 : Reach s7 := .step r6 (.sendClosed s6 2 (by simp [s6, s5, setStatus]) rfl)
  exact ⟨s7, r7, rfl, by simp [s7, s6, s5, s4, s3, s2, s1, setStatus, setServer],
    by simp [s7, s6, s5, s4, s3, s2, s1, setStatus, setServer], by simp [s7, setStatus]⟩

end SatSessionContinuity.Retention
