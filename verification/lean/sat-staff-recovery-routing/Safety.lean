import Model

/-!
# SAT staff recovery routing — safety, refinement and at-most-once obligations

Every theorem below is about the model in `Model.lean` only: it proves
properties of the `resolve`, `consume` and `roomStep` functions as defined
there. `TRACEABILITY.md` maps each one to the source function and test that
justify reading it as a statement about the shipped TypeScript.
-/

namespace SatStaffRecoveryRouting

/-- A guard that is not `true` is `false`: used to turn a failed match condition
into the concrete `false` the resolver's branches are defined over. -/
theorem bool_eq_false_of_not (b : Bool) (h : ¬ (b = true)) : b = false := by
  cases b with
  | false => rfl
  | true => exact absurd rfl h

/-! ## 1. `Routing` — a Fix press always has an honourable destination -/

namespace Routing

/-- The `examQuestion:` branch can only produce a question destination with a
non-empty id: `parseQuestion` refuses a blank id, the same way `parseIssueLink`
refuses to navigate to an empty `?question=` target. -/
theorem parseQuestion_id_ne_nil (p : Chars) (id : Chars) (f : Option Chars)
    (h : parseQuestion p = some (id, f)) : id ≠ [] := by
  unfold parseQuestion at h
  cases hs : splitOnChar ':' p with
  | nil => simp only [hs] at h; cases h
  | cons head rest =>
      cases rest with
      | nil => simp only [hs] at h; cases h
      | cons second tail =>
          simp only [hs] at h
          by_cases hh : head = examQuestionWord
          · rw [if_pos hh] at h
            by_cases hq : trimChars second = []
            · rw [if_pos hq] at h; cases h
            · rw [if_neg hq] at h
              intro hid
              rw [hid] at h
              injection h with h1
              exact hq (congrArg Prod.fst h1)
          · rw [if_neg hh] at h; cases h

/-- No destination can send the author to a blank question. -/
theorem question_destination_has_id (p : Chars) (sh : Option Shell) (id : Chars)
    (f : Option Chars) (h : resolve p sh = .question id f) : id ≠ [] := by
  unfold resolve at h
  by_cases hq : hasPrefix examQuestionPrefix p = true
  · rw [if_pos hq] at h
    cases hp : parseQuestion p with
    | none => simp only [hp] at h; cases h
    | some pair =>
        obtain ⟨q, g⟩ := pair
        simp only [hp] at h
        injection h with h1 h2
        rw [← h1]
        exact parseQuestion_id_ne_nil p q g hp
  · rw [if_neg hq] at h
    by_cases hs : p = scoringPolicyKey ∨ hasPrefix (scoringPolicyKey ++ ['.']) p = true
    · rw [if_pos hs] at h; cases h
    · rw [if_neg hs] at h
      cases hm : moduleParts p with
      | none => simp only [hm] at h; cases h
      | some pair =>
          obtain ⟨sec, mod⟩ := pair
          simp only [hm] at h
          by_cases hks : knownSection sh sec = true
          · rw [if_pos hks] at h
            by_cases hd : shellDeniesModule sh sec mod = true
            · rw [if_pos hd] at h; cases h
            · rw [if_neg hd] at h; cases h
          · rw [if_neg hks] at h; cases h

/-- A module destination can only name a section the loaded shell (or the SAT
section contract, when no shell is loaded) recognises. This is what stops an
unprefixed field path such as `answer.options` — which the module regex DOES
match — from being routed as a module. -/
theorem module_destination_requires_known_section (p : Chars) (sh : Option Shell)
    (sec mod : Chars) (h : resolve p sh = .module sec mod) : knownSection sh sec = true := by
  unfold resolve at h
  by_cases hq : hasPrefix examQuestionPrefix p = true
  · rw [if_pos hq] at h
    cases hp : parseQuestion p with
    | none => simp only [hp] at h; cases h
    | some pair => simp only [hp] at h; cases h
  · rw [if_neg hq] at h
    by_cases hs : p = scoringPolicyKey ∨ hasPrefix (scoringPolicyKey ++ ['.']) p = true
    · rw [if_pos hs] at h; cases h
    · rw [if_neg hs] at h
      cases hm : moduleParts p with
      | none => simp only [hm] at h; cases h
      | some pair =>
          obtain ⟨s, m⟩ := pair
          simp only [hm] at h
          by_cases hks : knownSection sh s = true
          · rw [if_pos hks] at h
            by_cases hd : shellDeniesModule sh s m = true
            · rw [if_pos hd] at h; cases h
            · rw [if_neg hd] at h
              injection h with h1 _
              rw [← h1]
              exact hks
          · rw [if_neg hks] at h; cases h

/-- A module destination is never a module the loaded shell maps as absent.
Together with the previous theorem: every module Fix press names a section the
editor has and a module this draft really contains. -/
theorem module_destination_is_not_denied_by_the_shell (p : Chars) (sh : Option Shell)
    (sec mod : Chars) (h : resolve p sh = .module sec mod) :
    shellDeniesModule sh sec mod = false := by
  unfold resolve at h
  by_cases hq : hasPrefix examQuestionPrefix p = true
  · rw [if_pos hq] at h
    cases hp : parseQuestion p with
    | none => simp only [hp] at h; cases h
    | some pair => simp only [hp] at h; cases h
  · rw [if_neg hq] at h
    by_cases hs : p = scoringPolicyKey ∨ hasPrefix (scoringPolicyKey ++ ['.']) p = true
    · rw [if_pos hs] at h; cases h
    · rw [if_neg hs] at h
      cases hm : moduleParts p with
      | none => simp only [hm] at h; cases h
      | some pair =>
          obtain ⟨s, m⟩ := pair
          simp only [hm] at h
          by_cases hks : knownSection sh s = true
          · rw [if_pos hks] at h
            by_cases hd : shellDeniesModule sh s m = true
            · rw [if_pos hd] at h; cases h
            · rw [if_neg hd] at h
              injection h with h1 h2
              rw [← h1, ← h2]
              exact bool_eq_false_of_not _ hd
          · rw [if_neg hks] at h; cases h

/-- The business corollary the UI depends on: a module Fix press is always
actionable (a section the editor has) and never a module this draft lacks. -/
theorem module_destination_is_honourable (p : Chars) (sh : Option Shell) (sec mod : Chars)
    (h : resolve p sh = .module sec mod) :
    knownSection sh sec = true ∧ shellDeniesModule sh sec mod = false :=
  ⟨module_destination_requires_known_section p sh sec mod h,
   module_destination_is_not_denied_by_the_shell p sh sec mod h⟩

/-- Completeness, stated for the branches the resolver's own control flow
actually reaches: past the two prefix tests, a module path whose section is
known and whose module the shell does not deny IS the destination. The concrete
instances below discharge the prefix hypotheses for the real paths by
evaluation. -/
theorem module_path_resolves_to_that_module (p : Chars) (sh : Option Shell) (sec mod : Chars)
    (hpre : hasPrefix examQuestionPrefix p = false)
    (hscore : ¬ (p = scoringPolicyKey ∨ hasPrefix (scoringPolicyKey ++ ['.']) p = true))
    (hparts : moduleParts p = some (sec, mod))
    (hsec : knownSection sh sec = true)
    (hdeny : shellDeniesModule sh sec mod = false) : resolve p sh = .module sec mod := by
  unfold resolve
  rw [if_neg (by simp [hpre]), if_neg hscore, hparts]
  simp [hsec, hdeny]

/-- When the loaded shell maps modules but not this one, the finding is refused
with a reason instead of being pointed at some other module. -/
theorem denied_module_is_refused_not_guessed (p : Chars) (sh : Option Shell) (sec mod : Chars)
    (hpre : hasPrefix examQuestionPrefix p = false)
    (hscore : ¬ (p = scoringPolicyKey ∨ hasPrefix (scoringPolicyKey ++ ['.']) p = true))
    (hparts : moduleParts p = some (sec, mod))
    (hsec : knownSection sh sec = true)
    (hdeny : shellDeniesModule sh sec mod = true) :
    resolve p sh = .unresolved unresolvedModuleMissing := by
  unfold resolve
  rw [if_neg (by simp [hpre]), if_neg hscore, hparts]
  simp [hsec, hdeny]

/-- The action label is absent for exactly the destination that has nowhere to
go: a surface can therefore never render a press that goes nowhere. -/
theorem label_none_is_unresolved (d : Destination) (h : destinationLabel d = none) :
    ∃ r, d = .unresolved r := by
  cases d with
  | question id f => cases h
  | module sec mod => cases h
  | scorePolicy => cases h
  | unresolved r => exact ⟨r, rfl⟩

/-- ... and every actionable destination does carry its label. -/
theorem actionable_destination_has_a_label (d : Destination)
    (h : ∀ r, d ≠ .unresolved r) : ∃ s, destinationLabel d = some s := by
  cases d with
  | question id f => exact ⟨"Open question", rfl⟩
  | module sec mod => exact ⟨"Open module", rfl⟩
  | scorePolicy => exact ⟨"Open score settings", rfl⟩
  | unresolved r => exact absurd rfl (h r)

/-! ### Kernel-evaluated instances on the real paths

These are the model's resolver run by the kernel on the strings the product
actually produces. They are the non-vacuity evidence for the theorems above and
the concrete discharge of the prefix hypotheses. -/

theorem resolve_module_finding : resolve pathModuleRW (some fullShell) =
    .module readingWriting rwM1 := by decide

theorem resolve_module_finding_without_a_module_map :
    resolve pathModuleRW (some modulelessShell) = .module readingWriting rwM1 := by decide

theorem resolve_module_finding_without_a_shell :
    resolve pathModuleRW none = .module readingWriting rwM1 := by decide

theorem resolve_missing_module_is_refused :
    resolve pathModuleMissing (some fullShell) = .unresolved unresolvedModuleMissing := by
  decide

theorem resolve_leaked_field_path_is_refused :
    resolve pathLeakedField (some fullShell) = .unresolved unresolvedUnlinked := by decide

theorem resolve_leaked_field_path_without_a_shell_is_refused :
    resolve pathLeakedField none = .unresolved unresolvedUnlinked := by decide

theorem resolve_question_link :
    resolve pathQuestionLink (some fullShell) = .question qId (some fldPrompt) := by decide

theorem resolve_scoring_policy : resolve pathScoringPolicy (some fullShell) = .scorePolicy := by
  decide

theorem resolve_scoring_policy_subsection :
    resolve pathScoringPolicySub (some fullShell) = .scorePolicy := by decide

theorem resolve_unrecognised_path_is_refused :
    resolve (['n','o','p','e']) (some fullShell) = .unresolved unresolvedUnlinked := by decide

theorem labels_match_the_destinations :
    destinationLabel (.module readingWriting rwM1) = some "Open module" ∧
    destinationLabel (.unresolved unresolvedUnlinked) = none := by decide

end Routing

/-! ## 2. `DeepLink` — the `?module=` link is consumed exactly once -/

namespace DeepLink

theorem fallback_pending (sh : ModuleShell) (e : Editor) :
    (fallback sh e).pendingModuleLink = e.pendingModuleLink := by
  unfold fallback
  by_cases h : selectionExists sh e.selModule = true
  · simp [h]
  · simp [h]

theorem fallback_injected (sh : ModuleShell) (e : Editor) :
    (fallback sh e).linkInjected = e.linkInjected := by
  unfold fallback
  by_cases h : selectionExists sh e.selModule = true
  · simp [h]
  · simp [h]

theorem fallback_adopted (sh : ModuleShell) (e : Editor) :
    (fallback sh e).linkAdopted = e.linkAdopted := by
  unfold fallback
  by_cases h : selectionExists sh e.selModule = true
  · simp [h]
  · simp [h]

/-- Settledness does not depend on the pending link, so the effect's own URL
bookkeeping cannot disturb the rule that decides whether the selection is
usable. -/
theorem settled_of_pending_change (sh : ModuleShell) (e : Editor) (p : Option Chars)
    (h : Settled sh e) : Settled sh { e with pendingModuleLink := p } := by
  rcases h with h | ⟨h1, h2, h3⟩
  · exact Or.inl h
  · exact Or.inr ⟨h1, h2, h3⟩

/-- A run of the effect with no pending link is the fallback alone. -/
theorem consume_of_no_pending (sh : ModuleShell) (e : Editor)
    (h : e.pendingModuleLink = none) : consume sh e = fallback sh e := by
  unfold consume
  rw [h]

theorem selectionExists_nil (sel : Option Nat) : selectionExists [] sel = false := by
  cases sel with
  | none => rfl
  | some id => rfl

theorem moduleById_isSome_of_mem : ∀ {sh : ModuleShell} {m : ShellModule},
    m ∈ sh → (moduleById sh m.id).isSome = true
  | [], m, h => by cases h
  | x :: xs, m, h => by
      unfold moduleById
      by_cases hx : x.id = m.id
      · rw [if_pos hx]; rfl
      · rw [if_neg hx]
        rcases List.mem_cons.mp h with hhead | hmem
        · rw [← hhead] at hx; exact absurd rfl hx
        · exact moduleById_isSome_of_mem hmem

theorem selectionExists_of_mem {sh : ModuleShell} {m : ShellModule} (h : m ∈ sh) :
    selectionExists sh (some m.id) = true := by
  unfold selectionExists
  exact moduleById_isSome_of_mem h

theorem moduleInSection_mem {sh : ModuleShell} {sec mod : Chars} {m : ShellModule}
    (h : moduleInSection sh sec mod = some m) : m ∈ sh := by
  induction sh with
  | nil => simp only [moduleInSection] at h; cases h
  | cons x xs ih =>
      simp only [moduleInSection] at h
      by_cases hc : (x.sectionKey = sec && x.moduleKey = mod) = true
      · rw [if_pos hc] at h
        injection h with hm
        rw [← hm]
        exact List.mem_cons_self
      · rw [if_neg hc] at h
        exact List.mem_cons_of_mem x (ih h)

theorem moduleByKey_mem {sh : ModuleShell} {mod : Chars} {m : ShellModule}
    (h : moduleByKey sh mod = some m) : m ∈ sh := by
  induction sh with
  | nil => simp only [moduleByKey] at h; cases h
  | cons x xs ih =>
      simp only [moduleByKey] at h
      by_cases hc : x.moduleKey = mod
      · rw [if_pos hc] at h
        injection h with hm
        rw [← hm]
        exact List.mem_cons_self
      · rw [if_neg hc] at h
        exact List.mem_cons_of_mem x (ih h)

theorem moduleForKey_mem {sh : ModuleShell} {raw : Chars} {m : ShellModule}
    (h : moduleForKey sh raw = some m) : m ∈ sh := by
  unfold moduleForKey at h
  cases hs : splitOnChar '.' raw with
  | nil => simp only [hs] at h; cases h
  | cons a rest =>
      cases rest with
      | nil => simp only [hs] at h; cases h
      | cons b tail =>
          cases tail with
          | nil =>
              simp only [hs] at h
              cases hm : moduleInSection sh a b with
              | some m2 =>
                  simp only [hm] at h
                  injection h with hm2
                  rw [← hm2]
                  exact moduleInSection_mem hm
              | none =>
                  simp only [hm] at h
                  exact moduleByKey_mem h
          | cons c rest3 => simp only [hs] at h; cases h

/-- After any run the selection is usable: the link's own module when it was
found, the shell's first module when the previous selection was gone, or nothing
at all when the shell has no module. -/
theorem fallback_settled (sh : ModuleShell) (e : Editor) : Settled sh (fallback sh e) := by
  cases sh with
  | nil =>
      simp [fallback, firstModule, selectionExists_nil, Settled]
  | cons m ms =>
      unfold fallback
      by_cases h : selectionExists (m :: ms) e.selModule = true
      · rw [if_pos h]
        exact Or.inl h
      · rw [if_neg h]
        unfold Settled
        exact Or.inl (selectionExists_of_mem List.mem_cons_self)

/-- Rewriting the two selection fields with the values the selection already
holds is the identity: the "nothing to fall back to" branch writes `none` into
two fields that already are `none`. -/
theorem update_with_current_values (e : Editor) (h2 : e.selModule = none)
    (h3 : e.selQuestion = none) :
    { e with selModule := none, selQuestion := none } = e := by
  cases e
  simp_all

/-- A settled selection is left exactly as it is. This is the rule that stops a
re-render from stealing focus back or invalidating an open draft. -/
theorem fallback_of_settled (sh : ModuleShell) (e : Editor) (h : Settled sh e) :
    fallback sh e = e := by
  rcases h with h | ⟨h1, h2, h3⟩
  · unfold fallback
    rw [if_pos h]
  · unfold fallback
    rw [if_neg (by simp [h2, selectionExists]), h1]
    exact update_with_current_values e h2 h3

/-- With no pending link, a settled editor is untouched by the effect. -/
theorem consume_of_settled_no_link (sh : ModuleShell) (e : Editor)
    (hp : e.pendingModuleLink = none) (hs : Settled sh e) : consume sh e = e := by
  rw [consume_of_no_pending sh e hp, fallback_of_settled sh e hs]

/-- Whatever happens, the parameter is gone afterwards: a link cannot re-fire on
a later render, not even when the module it names is absent. -/
theorem consume_clears_pending (sh : ModuleShell) (e : Editor) :
    (consume sh e).pendingModuleLink = none := by
  cases hl : e.pendingModuleLink with
  | none => simp only [consume, hl, fallback_pending]
  | some raw =>
      cases hm : moduleForKey sh raw with
      | none => simp only [consume, hl, hm, fallback_pending]
      | some m => simp only [consume, hl, hm]

theorem consume_settled (sh : ModuleShell) (e : Editor) : Settled sh (consume sh e) := by
  cases hl : e.pendingModuleLink with
  | none => simp only [consume, hl]; exact fallback_settled sh e
  | some raw =>
      cases hm : moduleForKey sh raw with
      | none =>
          simp only [consume, hl, hm]
          exact fallback_settled sh { e with pendingModuleLink := none }
      | some m =>
          simp only [consume, hl, hm]
          exact Or.inl (selectionExists_of_mem (moduleForKey_mem hm))

/-- Running the effect twice is running it once — the second run has no pending
link and the selection is already settled. -/
theorem consume_idempotent (sh : ModuleShell) (e : Editor) :
    consume sh (consume sh e) = consume sh e :=
  consume_of_settled_no_link sh (consume sh e) (consume_clears_pending sh e)
    (consume_settled sh e)

theorem consume_injected_unchanged (sh : ModuleShell) (e : Editor) :
    (consume sh e).linkInjected = e.linkInjected := by
  cases hl : e.pendingModuleLink with
  | none => simp only [consume, hl]; rw [fallback_injected]
  | some raw =>
      cases hm : moduleForKey sh raw with
      | none => simp only [consume, hl, hm]; rw [fallback_injected]
      | some m => simp only [consume, hl, hm]

theorem consume_adopted_le (sh : ModuleShell) (e : Editor) :
    (consume sh e).linkAdopted ≤ e.linkAdopted + 1 := by
  cases hl : e.pendingModuleLink with
  | none =>
      simp only [consume, hl]
      rw [fallback_adopted]
      exact Nat.le_succ _
  | some raw =>
      cases hm : moduleForKey sh raw with
      | none =>
          simp only [consume, hl, hm]
          rw [fallback_adopted]
          exact Nat.le_succ _
      | some m =>
          simp only [consume, hl, hm]
          exact Nat.le_refl _

/-- An adoption happens only when a link was pending AND it named a module this
shell contains. -/
theorem adoption_requires_a_resolvable_link (sh : ModuleShell) (e : Editor)
    (h : (consume sh e).linkAdopted ≠ e.linkAdopted) :
    ∃ raw, e.pendingModuleLink = some raw ∧ (moduleForKey sh raw).isSome = true := by
  cases hl : e.pendingModuleLink with
  | none =>
      simp only [consume, hl, fallback_adopted] at h
      exact absurd rfl h
  | some raw =>
      cases hm : moduleForKey sh raw with
      | none =>
          simp only [consume, hl, hm, fallback_adopted] at h
          exact absurd rfl h
      | some m => exact ⟨raw, rfl, by rw [hm]; rfl⟩

/-- A link naming a module this shell does not contain is consumed — the
parameter is stripped — without being adopted and without moving the selection.
That is the "a stale link cannot re-fire" rule. -/
theorem stale_link_is_consumed_without_adopting (sh : ModuleShell) (e : Editor) (raw : Chars)
    (hs : Settled sh e) (h : moduleForKey sh raw = none) :
    consume sh { e with pendingModuleLink := some raw } =
      { e with pendingModuleLink := none } := by
  have hs' : Settled sh { e with pendingModuleLink := none } :=
    settled_of_pending_change sh e none hs
  simp only [consume, h, fallback_of_settled sh { e with pendingModuleLink := none } hs']

/-- A link that IS found moves the selection to that module — not to the first
module of the shell. -/
theorem found_link_selects_its_own_module (sh : ModuleShell) (e : Editor) (raw : Chars)
    (m : ShellModule) (h : moduleForKey sh raw = some m) :
    (consume sh { e with pendingModuleLink := some raw }).selModule = some m.id := by
  simp only [consume, h]

/-! ### Reachability: at most one adoption per injected link -/

theorem editorInit_adopted_le (e : Editor) (h : editorInit e) :
    e.linkAdopted ≤ e.linkInjected := by
  simp only [editorInit] at h
  simp [h.1, h.2]

/-- The accounting invariant implies the raw adoption bound. -/
theorem account_weaken (e : Editor) (h : AdoptionAccount e) :
    e.linkAdopted ≤ e.linkInjected :=
  Nat.le_trans (Nat.le_add_right _ _) h

theorem fallback_account (sh : ModuleShell) (e : Editor) (h : AdoptionAccount e) :
    AdoptionAccount (fallback sh e) := by
  simp only [AdoptionAccount, pendingWeight, fallback_adopted, fallback_injected,
    fallback_pending] at h ⊢
  exact h

/-- Consecution, case by case. The adopting case is the interesting one: it can
only consume a link that was still pending, which is why a pending link's weight
is exactly what the invariant needs. -/
theorem consume_account (sh : ModuleShell) (e : Editor) (h : AdoptionAccount e) :
    AdoptionAccount (consume sh e) := by
  have hbase : e.linkAdopted ≤ e.linkInjected := account_weaken e h
  cases hl : e.pendingModuleLink with
  | none =>
      simp only [consume, hl]
      exact fallback_account sh e h
  | some raw =>
      cases hm : moduleForKey sh raw with
      | none =>
          simp only [consume, hl, hm]
          apply fallback_account
          simp only [AdoptionAccount, pendingWeight]
          exact hbase
      | some m =>
          simp only [consume, hl, hm]
          simp only [AdoptionAccount, pendingWeight, hl] at h ⊢
          simpa using h

theorem inject_account (raw : Chars) (e : Editor) (h : AdoptionAccount e) :
    AdoptionAccount (inject raw e) := by
  have hbase : e.linkAdopted ≤ e.linkInjected := account_weaken e h
  simp only [AdoptionAccount, pendingWeight, inject]
  exact Nat.add_le_add_right hbase 1

/-- Initiation plus consecution: every navigation is either still pending or
already adopted, so no reachable editor state can have adopted more links than
were injected through navigation. Each navigation is therefore responsible for
at most one adoption, and a re-render with no pending link adds none at all. -/
theorem reachable_adoption_account {sh : ModuleShell} {e : Editor} (h : EditorReach sh e) :
    AdoptionAccount e := by
  induction h with
  | init h0 =>
      simp only [AdoptionAccount, pendingWeight, editorInit] at h0 ⊢
      simp [h0.1, h0.2.1, h0.2.2]
  | step a _ ih =>
      cases a with
      | injectLink raw => exact inject_account raw _ ih
      | consumeLink => exact consume_account sh _ ih

theorem reachable_adoptions_le_injections {sh : ModuleShell} {e : Editor}
    (h : EditorReach sh e) : e.linkAdopted ≤ e.linkInjected :=
  account_weaken e (reachable_adoption_account h)

/-! ### End-to-end: the resolver's own deep link opens the finding's module -/

/-- A press on a `reading-writing.rw-m2-higher` finding navigates with that
module's deep link. `studentShell`'s FIRST module is `rw-m1`, so this result is
only reachable if the link was honoured rather than replaced by "the first
module". -/
theorem module_link_opens_the_named_module :
    (consume studentShell (inject linkRW2Higher emptyEditor)).selModule = some 2 ∧
    (consume studentShell (inject linkRW2Higher emptyEditor)).linkAdopted = 1 ∧
    (consume studentShell (inject linkRW2Higher emptyEditor)).pendingModuleLink = none := by
  decide

/-- Pressing the same finding twice does not adopt twice. -/
theorem link_pressed_twice_adopts_once :
    (consume studentShell
      (consume studentShell (inject linkRW2Higher emptyEditor))).linkAdopted = 1 := by
  decide

/-- The starting state of a flow: an editor with nothing selected is settled
only against a shell that has no module to select. -/
theorem empty_shell_settles_and_a_real_shell_does_not :
    Settled [] emptyEditor ∧ ¬ Settled studentShell emptyEditor := by
  constructor
  · exact Or.inr ⟨rfl, rfl, rfl⟩
  · intro h
    rcases h with h | ⟨h1, h2, h3⟩
    · simp only [selectionExists, emptyEditor] at h
      cases h
    · cases h1

end DeepLink

/-! ## 3. `Pinning` — one published target per room setup flow -/

namespace Pinning

theorem observe_does_not_touch_the_target (v : Version) (r : Room) :
    (observe v r).target = r.target := rfl

theorem create_sends_the_target (r : Room) : (createRoom r).sent = r.target := rfl

/-- The guard is the whole property: a target that is already captured is never
re-pointed, so a background refresh cannot change the version this room uses. -/
theorem capture_of_set_target (r : Room) (v : Version) (h : r.target = some v) :
    (freeze r).target = some v := by
  simp [freeze, h]

theorem capture_twice_is_capture_once (r : Room) :
    (freeze (freeze r)).target = (freeze r).target := by
  cases ht : r.target with
  | some v => simp [freeze, ht]
  | none =>
      cases ho : r.observed with
      | none => simp [freeze, ht, ho]
      | some w => simp [freeze, ht, ho]

/-- With nothing pinned yet, the capture takes exactly the version the overview
is reporting at that moment. -/
theorem capture_takes_the_observed_version (r : Room) (v : Version)
    (ht : r.target = none) (ho : r.observed = some v) : (freeze r).target = some v := by
  simp [freeze, ht, ho]

/-- The room is created on the captured version even though a poll answered with
a newer version in between: this is the concurrent-republish case. -/
theorem create_ignores_a_later_snapshot (r : Room) (w : Version) :
    (createRoom (observe w (freeze r))).sent = (freeze r).target := by
  simp [createRoom, observe]

/-- A flow that captures while the first snapshot is still the current one pins
that first snapshot, and the same version arriving again cannot move it. -/
theorem first_snapshot_flow_pin (r : Room) (v : Version) (ht : r.target = none)
    (ho : r.observed = some v) :
    (freeze r).target = some v ∧ (freeze (observe v (freeze r))).target = some v := by
  have h1 : (freeze r).target = some v := capture_takes_the_observed_version r v ht ho
  constructor
  · exact h1
  · exact capture_of_set_target (observe v (freeze r)) v h1

/-- An explicit reopen is a new flow: the old pin is discarded and the
then-current publication is pinned instead. This is a deliberate boundary, not a
safety property — stated so the reset is visible rather than implied. -/
theorem reopen_repins_the_current_version (r : Room) (v : Version) :
    (freeze (observe v (reopen r))).target = some v := by
  simp [freeze, observe, reopen]

/-- Consecution over the room machine: no action of the SAME flow — a snapshot
reporting a republish, a second capture, or a create — can move a target that is
already pinned. -/
theorem same_flow_actions_never_move_the_pin (r : Room) (a : RoomAction) (v : Version)
    (hnot : a ≠ .reopenFlow) (h : r.target = some v) :
    (roomStep r a).target = some v := by
  cases a with
  | observeSnapshot w => simp [roomStep, observe, h]
  | captureTarget => simp [roomStep, freeze, h]
  | create => simp [roomStep, createRoom, h]
  | reopenFlow => exact absurd rfl hnot

/-- Reachability invariant: the version a room was created on is always the
version its flow pinned. A capture cannot produce a `sent` without a `target`,
so no interleaving of snapshots, captures and creates can separate them. -/
theorem roomStep_preserves_sent_implies_target {r : Room} (a : RoomAction)
    (ih : ∀ v, r.sent = some v → r.target = some v) :
    ∀ v, (roomStep r a).sent = some v → (roomStep r a).target = some v := by
  intro v hv
  cases a with
  | observeSnapshot w => exact ih v (by simpa [roomStep, observe] using hv)
  | captureTarget =>
      have hsent : r.sent = some v := by
        cases ht : r.target with
        | some z => simpa [roomStep, freeze, ht] using hv
        | none =>
            cases ho : r.observed with
            | none => simpa [roomStep, freeze, ht, ho] using hv
            | some z => simpa [roomStep, freeze, ht, ho] using hv
      exact capture_of_set_target r v (ih v hsent)
  | create => simpa [roomStep, createRoom] using hv
  | reopenFlow => simp [roomStep, reopen] at hv

theorem reachable_sent_is_the_pinned_target {r : Room} (h : RoomReach r) :
    ∀ v, r.sent = some v → r.target = some v := by
  induction h with
  | init h0 =>
      intro v hv
      rw [h0.2.2.1] at hv
      cases hv
  | step a _ ih => exact roomStep_preserves_sent_implies_target a ih

end Pinning

end SatStaffRecoveryRouting
