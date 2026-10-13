import Safety

namespace SingleModuleImport

def questions27 : List Question :=
  (List.range' 1 27).map fun n => { order := n, canonical := "synthetic checked content" }

def fixture : Request :=
  { key := { actor := 1, exam := 1, operation := 1 }, importId := 1,
    target := .rw1, version := 1, revision := 12, questions := questions27,
    selected := [8, 19], source := some .staffDefined, confirmed := true }

def fixtureDraft : Draft :=
  { exam := 1, version := 1, revision := 12, editable := true, placements := fun _ => [],
    targets := expected,
    routing := "unchanged routing", scoring := "unchanged scoring" }

def fixturePreview : Preview :=
  { actor := 1, exam := 1, target := .rw1, version := 1, revision := 12,
    questions := questions27, expiresAt := 100,
    contentChecked := true, assetsChecked := true }

def fixtureState : State :=
  initial fixtureDraft (fun i => if i = 1 then some fixturePreview else none)

theorem fixture_ready : Ready 99 fixtureDraft fixture fixturePreview := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]

theorem meaningful_commit : Step fixtureState (.commit fixture) (committed fixtureState fixture) :=
  Step.commit fixtureState fixture fixturePreview 99 (by rfl) fixture_ready (by rfl) (by rfl) (by rfl)

theorem committed_reachable : Reachable (committed fixtureState fixture) :=
  Reachable.step (Reachable.init ⟨fixtureDraft, _, true, rfl⟩) meaningful_commit

theorem fixture_pretest_flags :
    ((imported fixture).filter fun p => p.isPretest).length = 2 := by decide

theorem no_resolution : ¬ PretestsOK { fixture with source := none } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem one_pretest : ¬ PretestsOK { fixture with selected := [8] } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem three_pretests : ¬ PretestsOK { fixture with selected := [8, 19, 20] } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem duplicate_pretests : ¬ PretestsOK { fixture with selected := [8, 8] } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem zero_order : ¬ PretestsOK { fixture with selected := [0, 19] } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem overflow_order : ¬ PretestsOK { fixture with selected := [8, 28] } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem unconfirmed : ¬ PretestsOK { fixture with confirmed := false } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem wrong_count : ¬ ShapeOK { fixture with questions := questions27.drop 1 } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem duplicate_order : ¬ ShapeOK { fixture with
    questions := { order := 2, canonical := "changed" } :: questions27.drop 1 } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem tampered_content : ¬ Bound { fixture with questions := [] } fixturePreview := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem wrong_actor : ¬ Bound { fixture with key := { fixture.key with actor := 2 } }
    fixturePreview := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem wrong_module : ¬ Bound { fixture with target := .math1 } fixturePreview := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem expired_at_boundary : ¬ Ready 100 fixtureDraft fixture fixturePreview := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem stale_fixture : ¬ Ready 99 { fixtureDraft with revision := 13 }
    fixture fixturePreview := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]
theorem single_rw_not_publishable :
    ¬ PublishReady (replace fixtureDraft fixture) .rw := by
  intro h
  have lower := (h .rwLower rfl).1
  simp [replace, fixtureDraft, fixture, expected] at lower

-- A second fresh transaction cannot use the old expected revision, even if
-- another preview exists and a different actor/key is used.
theorem competing_stale_commit :
    ¬ Ready 99 (replace fixtureDraft fixture)
      { fixture with key := { actor := 2, exam := 1, operation := 2 } }
      { fixturePreview with actor := 2 } := by
  simp [Ready, Bound, ShapeOK, PretestsOK, fixture, fixtureDraft, fixturePreview,
    questions27, replace, expected, Function.comp_def, List.range'_succ]

-- Minimal unsafe algorithms: observations false,false before either write.
def uncheckedWrite (effects : Nat) (_cachedUnused : Bool) : Nat := effects + 1
theorem naive_two_read_two_write : uncheckedWrite (uncheckedWrite 0 true) true = 2 := rfl

-- Bad partial-import workaround deletes every placement before target insertion.
def badReplace (d : Draft) (r : Request) : Draft :=
  { d with placements := fun m => if m = r.target then imported r else [] }

def populatedDraft : Draft :=
  { fixtureDraft with placements := fun _ =>
      [{ id := 77, question := { order := 1, canonical := "existing" }, isPretest := false }] }

theorem deleting_other_modules_loses_content :
    (badReplace populatedDraft fixture).placements .math1 ≠ populatedDraft.placements .math1 := by
  decide

end SingleModuleImport
