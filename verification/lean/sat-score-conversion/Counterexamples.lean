import Safety

/-!
# Counterexamples and anti-vacuity witnesses

1. `naive_publish_forks`: a publish that checks the base against a stale read (no pointer
   row lock) forks the history. This is the schedule `SELECT ... FOR UPDATE` on
   `sat_score_conversion_active` removes; it is why the model's atomic publish is an
   obligation on the database and not a free assumption.
2. `superseded_publish_is_rejected`: the second publisher on a stale base cannot commit.
3. Witnesses that the invariants are not vacuous: a policy can be published and then
   changes what a released result displays.
-/

namespace SatScoreConversion

/-- Publish WITHOUT the base-equals-active guard (what happens if the check and the write
are not serialized). -/
inductive NaiveStep : St → Act → St → Prop
  | safe {s s' : St} {a : Act} : Step s a s' → NaiveStep s a s'
  | publish (s : St) (id : Nat) (d : Rev) :
      s.revs id = some d → d.status = .draft → Publishable d.content →
      NaiveStep s (.publish id)
        { s with revs := upd s.revs id (d.published s.nextNum), active := some id, nextNum := s.nextNum + 1 }

inductive NaiveReach : St → Prop
  | init (s : St) : Init s → NaiveReach s
  | step (s s' : St) (a : Act) : NaiveReach s → NaiveStep s a s' → NaiveReach s'

def s0 : St := { revs := fun _ => none, active := none, nextNum := 1, results := fun _ => none }

def good : Content := { tables := [{ m1Ops := 0, m2Ops := 0, cell := fun _ _ => some 200 }] }

theorem good_publishable : Publishable good := by
  refine ⟨by simp [good], ?_⟩
  intro t ht i j hi hj
  simp [good] at ht
  subst ht
  simp at hi hj
  subst hi; subst hj
  exact ⟨200, rfl, by decide⟩

def s1 : St := { s0 with revs := upd s0.revs 1 (Rev.fresh s0.active good) }
def s2 : St := { s1 with revs := upd s1.revs 2 (Rev.fresh s1.active good) }
def s3 : St :=
  { s2 with revs := upd s2.revs 1 ((Rev.fresh none good).published s2.nextNum),
            active := some 1, nextNum := s2.nextNum + 1 }
def s4 : St :=
  { s3 with revs := upd s3.revs 2 ((Rev.fresh none good).published s3.nextNum),
            active := some 2, nextNum := s3.nextNum + 1 }

theorem s0_init : Init s0 := ⟨fun _ => rfl, rfl, rfl, fun _ => rfl⟩

/-- Two published revisions with the same (empty) base: the history forked. -/
theorem naive_publish_forks :
    NaiveReach s4 ∧ ∃ i j ri rj, i ≠ j ∧ s4.revs i = some ri ∧ s4.revs j = some rj ∧
      ri.status = .published ∧ rj.status = .published ∧ ri.base = rj.base := by
  have h1 : NaiveStep s0 (.createDraft 1 good) s1 :=
    .safe (.createDraft s0 1 good rfl)
  have h2 : NaiveStep s1 (.createDraft 2 good) s2 :=
    .safe (.createDraft s1 2 good (by simp [s1, s0, upd]))
  have h3 : NaiveStep s2 (.publish 1) s3 :=
    .publish s2 1 (Rev.fresh none good) (by simp [s2, s1, s0, upd]) rfl good_publishable
  have h4 : NaiveStep s3 (.publish 2) s4 :=
    .publish s3 2 (Rev.fresh none good) (by simp [s3, s2, s1, s0, upd]) rfl good_publishable
  refine ⟨.step _ _ _ (.step _ _ _ (.step _ _ _ (.step _ _ _ (.init _ s0_init) h1) h2) h3) h4, 1, 2,
    (Rev.fresh none good).published 1, (Rev.fresh none good).published 2, by decide, ?_, ?_, rfl, rfl, rfl⟩
  · simp [s4, s3, upd, s2, s1, s0]
  · simp [s4, upd, s3, s2, s1, s0]

/-- The real publish rejects the second publisher: after revision 1 is active, a draft
based on the old (empty) active pointer cannot commit. -/
theorem superseded_publish_is_rejected {s' : St} (hs : Step s3 (.publish 2) s') : s' = s3 := by
  refine Classical.byContradiction fun hne => ?_
  obtain ⟨d, hd, _, hbase, _, _⟩ := publish_requires_active_base hs hne
  have : d = Rev.fresh none good := by
    simp [s3, s2, s1, s0, upd] at hd
    exact hd.symm
  subst this
  simp [Rev.fresh, s3] at hbase

/-! ## Non-vacuity -/

def r0 : Result := { raw := { m1Ops := 0, m2Ops := 0, m1 := 0, m2 := 0 }, released := true, legacy := some 555 }

/-- With no policy the stored legacy score shows... -/
theorem witness_legacy_before_publish : display s0 r0 = some 555 := by
  simp [display, r0, s0]

def sp : St :=
  { s1 with revs := upd s1.revs 1 ((Rev.fresh none good).published s1.nextNum),
            active := some 1, nextNum := s1.nextNum + 1 }

/-- ...and after a publish the same released result shows the policy's score (200), so the
retroactivity theorem is not vacuously true. -/
theorem witness_display_changes :
    ∃ s, Reach s ∧ s.active = some 1 ∧ display s r0 = some 200 := by
  have h1 : Step s0 (.createDraft 1 good) s1 := .createDraft s0 1 good rfl
  have h2 : Step s1 (.publish 1) sp :=
    .publish s1 1 (Rev.fresh none good) (by simp [s1, s0, upd]) rfl rfl good_publishable
  refine ⟨sp, .step _ _ _ (.step _ _ _ (.init _ s0_init) h1) h2, rfl, ?_⟩
  simp [display, r0, sp, s1, s0, upd, Content.resolve, good, Rev.fresh, List.find?, ValidScore]

end SatScoreConversion
