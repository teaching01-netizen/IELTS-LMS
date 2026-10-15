import Model

/-! # Safety theorems for the requirements in SPEC.md

Every theorem is kernel-checked; AxiomAudit.lean prints its axioms. -/

/-! ## Convert — SC-01..05, REQ-NF -/
namespace Convert

/-- REQ-NF: a converted score is an explicit integer table entry within 200–800. -/
theorem convert_sound (t : Table) (sec route : String) (raw : Nat) (s : Int)
    (h : convert t sec route raw = some s) :
    t sec route raw = some (.int s) ∧ minScaled ≤ s ∧ s ≤ maxScaled := by
  unfold convert at h
  split at h
  · rename_i n hn
    split at h
    · rename_i hr
      cases h
      exact ⟨hn, hr⟩
    · cases h
  · cases h

theorem convert_complete (t : Table) (sec route : String) (raw : Nat) (s : Int)
    (he : t sec route raw = some (.int s)) (hlo : minScaled ≤ s) (hhi : s ≤ maxScaled) :
    convert t sec route raw = some s := by
  simp [convert, he, hlo, hhi]

/-- Missing key, `null`, or any non-integer always fails closed. -/
theorem convert_fails_closed (t : Table) (sec route : String) (raw : Nat)
    (h : ∀ n, t sec route raw ≠ some (.int n)) :
    convert t sec route raw = none := by
  unfold convert
  split
  · rename_i n hn; exact absurd hn (h n)
  · rfl

/-- The fix only removes outputs; it never invents one the old code lacked. -/
theorem convert_refines_old (t : Table) (sec route : String) (raw : Nat) (s : Int)
    (h : convert t sec route raw = some s) : convertGoOld t sec route raw = some s := by
  have ⟨he, _⟩ := convert_sound t sec route raw s h
  simp [convertGoOld, he]

/-- SC-03/SC-04: the result depends only on the entry at (section, route, raw);
    the other route's table and other sections cannot influence it. -/
theorem convert_local (t₁ t₂ : Table) (sec route : String) (raw : Nat)
    (h : t₁ sec route raw = t₂ sec route raw) :
    convert t₁ sec route raw = convert t₂ sec route raw := by
  simp only [convert, h]

theorem normalizedRaw_bounds (raw op mx : Int) :
    0 ≤ normalizedRaw raw op mx ∧ normalizedRaw raw op mx ≤ max mx 0 := by
  unfold normalizedRaw
  split
  · omega
  · simp only
    split
    · omega
    · split <;> omega

/-- For non-negative inputs Go's truncating division equals Euclidean division. -/
theorem tdiv_eq_ediv_nonneg (a b : Int) (ha : 0 ≤ a) :
    Int.tdiv a b = a / b := Int.tdiv_eq_ediv_of_nonneg ha

theorem normalizedRaw_mono (r₁ r₂ op mx : Int) (h0 : 0 ≤ r₁) (h : r₁ ≤ r₂) :
    normalizedRaw r₁ op mx ≤ normalizedRaw r₂ op mx := by
  unfold normalizedRaw
  split
  · omega
  · rename_i hc
    have hop : 0 < op := by omega
    have hmx : 0 < mx := by omega
    have hh : 0 ≤ op / 2 := Int.ediv_nonneg (by omega) (by omega)
    have a1 : 0 ≤ r₁ * mx + op / 2 := by
      have := Int.mul_nonneg h0 (Int.le_of_lt hmx); omega
    have a2 : r₁ * mx + op / 2 ≤ r₂ * mx + op / 2 := by
      have := Int.mul_le_mul_of_nonneg_right h (Int.le_of_lt hmx); omega
    have d : (r₁ * mx + op / 2) / op ≤ (r₂ * mx + op / 2) / op :=
      Int.ediv_le_ediv hop a2
    simp only [Int.tdiv_eq_ediv_of_nonneg (show (0:Int) ≤ op by omega),
      Int.tdiv_eq_ediv_of_nonneg a1,
      Int.tdiv_eq_ediv_of_nonneg (Int.le_trans a1 a2)]
    split <;> split <;> (try split) <;> (try split) <;> omega

theorem normalizedRaw_full (op mx : Int) (hop : 0 < op) (hmx : 0 < mx) :
    normalizedRaw op op mx = mx := by
  unfold normalizedRaw
  have hh : 0 ≤ op / 2 := Int.ediv_nonneg (by omega) (by omega)
  have hlt : op / 2 < op := Int.ediv_lt_of_lt_mul (by omega) (by omega)
  have a : 0 ≤ op * mx + op / 2 := by
    have := Int.mul_nonneg (Int.le_of_lt hop) (Int.le_of_lt hmx); omega
  have key : (op * mx + op / 2) / op = mx := by
    rw [Int.mul_comm op mx, Int.add_comm, Int.add_mul_ediv_right _ _ (by omega),
      Int.ediv_eq_zero_of_lt hh hlt, Int.zero_add]
  simp only [show ¬(op ≤ 0 ∨ mx ≤ 0) by omega, if_false,
    Int.tdiv_eq_ediv_of_nonneg (show (0:Int) ≤ op by omega),
    Int.tdiv_eq_ediv_of_nonneg a, key]
  split <;> (try split) <;> omega

theorem total_requires_both (rw math : Option Int) (s : Int) (h : total rw math = some s) :
    ∃ a b, rw = some a ∧ math = some b ∧ s = a + b := by
  unfold total at h
  split at h
  · cases h; exact ⟨_, _, rfl, rfl, rfl⟩
  · cases h

/-- SC-01: a displayed total is 400–1600. -/
theorem total_in_range (t : Table) (r₁ r₂ : String) (x y : Nat) (s : Int)
    (h : total (convert t "readingWriting" r₁ x) (convert t "math" r₂ y) = some s) :
    400 ≤ s ∧ s ≤ 1600 := by
  have ⟨a, b, ha, hb, hs⟩ := total_requires_both _ _ s h
  have := (convert_sound _ _ _ _ _ ha).2
  have := (convert_sound _ _ _ _ _ hb).2
  simp [minScaled, maxScaled] at *
  omega

/-- SC-02: a single-section exam never shows a total. -/
theorem total_absent_single_section (a : Int) :
    total (some a) none = none ∧ total none (some a) = none := ⟨rfl, rfl⟩

end Convert

/-! ## Scoring — pretests never count; raw ≤ operational -/
namespace Scoring

theorem score_fold (rows : List Row) (a b : Nat) :
    rows.foldl step (a, b) =
      (a + (rows.filter fun r => !r.pretest && r.correct).length,
       b + (rows.filter fun r => !r.pretest).length) := by
  induction rows generalizing a b with
  | nil => simp
  | cons r rs ih =>
    cases hp : r.pretest <;> cases hc : r.correct <;>
      simp [List.foldl, step, hp, hc, ih, List.filter_cons] <;> omega

theorem score_raw (rows : List Row) :
    (score rows).1 = (rows.filter fun r => !r.pretest && r.correct).length := by
  simp [score, score_fold]

theorem score_op (rows : List Row) :
    (score rows).2 = (rows.filter fun r => !r.pretest).length := by
  simp [score, score_fold]

theorem score_le (rows : List Row) : (score rows).1 ≤ (score rows).2 := by
  rw [score_raw, score_op]
  induction rows with
  | nil => simp
  | cons r rs ih =>
    cases hp : r.pretest <;> cases hc : r.correct <;> simp [List.filter_cons, hp, hc] <;> omega

/-- Pretest rows contribute nothing: dropping them leaves the score unchanged. -/
theorem score_pretest_irrelevant (rows : List Row) :
    score (rows.filter fun r => !r.pretest) = score rows := by
  unfold score
  generalize ((0, 0) : Nat × Nat) = acc
  induction rows generalizing acc with
  | nil => rfl
  | cons r rs ih =>
    cases hp : r.pretest <;> simp [List.filter_cons, hp, List.foldl, step, ih]

end Scoring

/-! ## Report — classroom raw score report -/
namespace Report

section
variable {κ μ : Type} [DecidableEq κ]
set_option linter.unusedSectionVars false

theorem sumBy_append {α : Type} (f : α → Int) (l₁ l₂ : List α) :
    sumBy f (l₁ ++ l₂) = sumBy f l₁ + sumBy f l₂ := by
  induction l₁ with
  | nil => simp [sumBy]
  | cons x xs ih => simp [sumBy, ih]; omega

theorem nodup_concat {α : Type} (l : List α) (a : α) (h : l.Nodup) (ha : a ∉ l) :
    (l ++ [a]).Nodup := by
  induction l with
  | nil => simp
  | cons x xs ih =>
    rw [List.nodup_cons] at h
    simp only [List.mem_cons, not_or] at ha
    simp only [List.cons_append, List.nodup_cons, List.mem_append, List.mem_singleton, not_or]
    exact ⟨⟨h.1, fun e => ha.1 e.symm⟩, ih h.2 ha.2⟩

theorem addRow_key (s : Sec κ μ) (r : SRow κ μ) : (addRow s r).key = s.key := rfl

theorem secOf_key (rows : List (SRow κ μ)) (k : κ) : (secOf rows k).key = k := rfl

/-! ### First-appearance order -/

theorem firstKeys_snoc (rows : List (SRow κ μ)) (r : SRow κ μ) :
    firstKeys (rows ++ [r]) = fkStep (firstKeys rows) r := by
  simp [firstKeys, List.foldl_append]

theorem fk_mem (rows : List (SRow κ μ)) (ks : List κ) (k : κ) :
    k ∈ rows.foldl fkStep ks ↔ k ∈ ks ∨ ∃ r ∈ rows, r.sec = k := by
  induction rows generalizing ks with
  | nil => simp
  | cons r rs ih =>
    simp only [List.foldl, ih, fkStep, List.mem_cons, exists_eq_or_imp]
    split
    · rename_i h
      constructor
      · intro h'; rcases h' with h' | h'
        · exact Or.inl h'
        · exact Or.inr (Or.inr h')
      · intro h'; rcases h' with h' | h' | h'
        · exact Or.inl h'
        · exact Or.inl (h' ▸ h)
        · exact Or.inr h'
    · simp only [List.mem_append, List.mem_singleton]
      constructor
      · intro h'; rcases h' with (h' | h') | h'
        · exact Or.inl h'
        · exact Or.inr (Or.inl h'.symm)
        · exact Or.inr (Or.inr h')
      · intro h'; rcases h' with h' | h' | h'
        · exact Or.inl (Or.inl h')
        · exact Or.inl (Or.inr h'.symm)
        · exact Or.inr h'

theorem firstKeys_mem (rows : List (SRow κ μ)) (k : κ) :
    k ∈ firstKeys rows ↔ ∃ r ∈ rows, r.sec = k := by
  simp [firstKeys, fk_mem]

theorem fk_nodup (rows : List (SRow κ μ)) (ks : List κ) (h : ks.Nodup) :
    (rows.foldl fkStep ks).Nodup := by
  induction rows generalizing ks with
  | nil => exact h
  | cons r rs ih =>
    apply ih
    unfold fkStep
    split
    · exact h
    · rename_i hn; exact nodup_concat ks r.sec h hn

theorem firstKeys_nodup (rows : List (SRow κ μ)) : (firstKeys rows).Nodup :=
  fk_nodup rows [] List.nodup_nil

/-! ### Exact grouping -/

theorem secOf_snoc (rows : List (SRow κ μ)) (r : SRow κ μ) (k : κ) :
    secOf (rows ++ [r]) k = if r.sec = k then addRow (secOf rows k) r else secOf rows k := by
  by_cases h : r.sec = k
  · simp [secOf, addRow, entry, List.filter_append, h, sumBy_append, sumBy]
  · simp [secOf, List.filter_append, h]

theorem secOf_absent (rows : List (SRow κ μ)) (k : κ) (h : ∀ r ∈ rows, r.sec ≠ k) :
    secOf rows k = empty k := by
  have : (rows.filter fun r => decide (r.sec = k)) = [] :=
    List.filter_eq_nil_iff.mpr (fun r hr => by simpa using h r hr)
  simp [secOf, empty, this, sumBy]

theorem upsert_map (r : SRow κ μ) (F : κ → Sec κ μ) (hF : ∀ k, (F k).key = k)
    (ks : List κ) (hnd : ks.Nodup) :
    upsert r (ks.map F) =
      if r.sec ∈ ks then ks.map (fun k => if r.sec = k then addRow (F k) r else F k)
      else ks.map F ++ [addRow (empty r.sec) r] := by
  induction ks with
  | nil => simp [upsert]
  | cons k ks ih =>
    rw [List.nodup_cons] at hnd
    simp only [List.map_cons, upsert, hF]
    by_cases hk : k = r.sec
    · subst hk
      have hrest : ks.map (fun k' => if r.sec = k' then addRow (F k') r else F k') = ks.map F :=
        List.map_congr_left (fun k' hk' => by
          have : r.sec ≠ k' := fun e => hnd.1 (e ▸ hk')
          simp [this])
      simp [hrest]
    · have hk' : r.sec ≠ k := fun e => hk e.symm
      rw [if_neg hk, ih hnd.2]
      by_cases hm : r.sec ∈ ks
      · simp [hm, hk']
      · simp [hm, hk']

theorem upsert_step (pre : List (SRow κ μ)) (r : SRow κ μ) :
    upsert r ((firstKeys pre).map (secOf pre)) =
      (firstKeys (pre ++ [r])).map (secOf (pre ++ [r])) := by
  rw [upsert_map r (secOf pre) (secOf_key pre) _ (firstKeys_nodup pre), firstKeys_snoc]
  unfold fkStep
  by_cases hm : r.sec ∈ firstKeys pre
  · simp only [hm, if_true]
    exact List.map_congr_left (fun k _ => (secOf_snoc pre r k).symm)
  · simp only [hm, if_false, List.map_append, List.map_cons, List.map_nil]
    have habs : ∀ x ∈ pre, x.sec ≠ r.sec := fun x hx e =>
      hm ((firstKeys_mem pre r.sec).mpr ⟨x, hx, e⟩)
    congr 1
    · exact List.map_congr_left (fun k hk => by
        have : r.sec ≠ k := fun e => hm (e ▸ hk)
        rw [secOf_snoc]; simp [this])
    · rw [secOf_snoc, if_pos rfl, secOf_absent pre r.sec habs]

theorem group_fold (rest pre : List (SRow κ μ)) :
    rest.foldl (fun acc r => upsert r acc) ((firstKeys pre).map (secOf pre)) =
      (firstKeys (pre ++ rest)).map (secOf (pre ++ rest)) := by
  induction rest generalizing pre with
  | nil => simp
  | cons r rs ih =>
    simp only [List.foldl]
    rw [upsert_step, ih]
    simp

/-- The fixed grouping is exactly one section per key, in first-appearance
    order, each holding exactly the rows with that key. -/
theorem group_exact (rows : List (SRow κ μ)) :
    groupNew rows = (firstKeys rows).map (secOf rows) := by
  have := group_fold rows []
  simpa [firstKeys] using this

/-- Cited by terminalization/service.go `classroomRawScoreTx`. -/
theorem group_keys_unique (rows : List (SRow κ μ)) :
    ((groupNew rows).map (·.key)).Nodup := by
  rw [group_exact, List.map_map]
  have : ((·.key) ∘ secOf rows) = id := funext fun k => secOf_key rows k
  rw [this, List.map_id]
  exact firstKeys_nodup rows

theorem group_keys_cover (rows : List (SRow κ μ)) (k : κ) :
    k ∈ (groupNew rows).map (·.key) ↔ ∃ r ∈ rows, r.sec = k := by
  rw [group_exact, List.map_map]
  have : ((·.key) ∘ secOf rows) = id := funext fun k => secOf_key rows k
  rw [this, List.map_id, firstKeys_mem]

theorem group_section_exact (rows : List (SRow κ μ)) (s : Sec κ μ) (h : s ∈ groupNew rows) :
    s = secOf rows s.key := by
  rw [group_exact, List.mem_map] at h
  obtain ⟨k, _, rfl⟩ := h
  rfl

theorem sumBy_upsert_raw (r : SRow κ μ) (acc : List (Sec κ μ)) :
    sumBy (·.raw) (upsert r acc) = sumBy (·.raw) acc + r.raw := by
  induction acc with
  | nil => simp [upsert, sumBy, addRow, empty]
  | cons s ss ih =>
    simp only [upsert]; split
    · simp [sumBy, addRow]; omega
    · simp [sumBy, ih]; omega

theorem sumBy_upsert_total (r : SRow κ μ) (acc : List (Sec κ μ)) :
    sumBy (·.total) (upsert r acc) = sumBy (·.total) acc + r.op := by
  induction acc with
  | nil => simp [upsert, sumBy, addRow, empty]
  | cons s ss ih =>
    simp only [upsert]; split
    · simp [sumBy, addRow]; omega
    · simp [sumBy, ih]; omega

/-- Section raw scores add up to the overall raw score, and likewise totals. -/
theorem group_totals (rows : List (SRow κ μ)) :
    sumBy (·.raw) (groupNew rows) = sumBy (·.raw) rows ∧
    sumBy (·.total) (groupNew rows) = sumBy (·.op) rows := by
  suffices h : ∀ acc : List (Sec κ μ),
      sumBy (·.raw) (rows.foldl (fun acc r => upsert r acc) acc) = sumBy (·.raw) acc + sumBy (·.raw) rows ∧
      sumBy (·.total) (rows.foldl (fun acc r => upsert r acc) acc) = sumBy (·.total) acc + sumBy (·.op) rows by
    have := h []; simpa [groupNew, sumBy] using this
  induction rows with
  | nil => intro acc; simp [sumBy]
  | cons r rs ih =>
    intro acc
    simp only [List.foldl]
    rw [(ih _).1, (ih _).2, sumBy_upsert_raw, sumBy_upsert_total]
    simp [sumBy]; omega

/-! ### The report gate -/

theorem scoreAll_spec (rows : List (DbRow κ μ)) (srows : List (SRow κ μ))
    (h : scoreAll rows = some srows) : rows.map scored = srows.map some := by
  induction rows generalizing srows with
  | nil => simp [scoreAll] at h; subst h; rfl
  | cons r rs ih =>
    simp only [scoreAll] at h
    split at h
    · rename_i s ss hs hss
      cases h
      simp [hs, ih ss hss]
    · cases h

theorem scored_spec (r : DbRow κ μ) (s : SRow κ μ) (h : scored r = some s) :
    s.sec = r.sec ∧ s.mod = r.mod ∧ r.raw = some s.raw ∧ r.op = some s.op ∧ 0 < s.op := by
  unfold scored at h
  split at h
  · rename_i c t hc ht
    split at h
    · cases h
    · cases h; exact ⟨rfl, rfl, hc, ht, show (0:Int) < t by omega⟩
  · cases h

theorem scoreAll_mem (rows : List (DbRow κ μ)) (srows : List (SRow κ μ))
    (h : scoreAll rows = some srows) (r : DbRow κ μ) (hr : r ∈ rows) :
    ∃ c t, r.raw = some c ∧ r.op = some t ∧ 0 < t := by
  have hm := scoreAll_spec rows srows h
  have : scored r ∈ srows.map some := hm ▸ List.mem_map_of_mem hr
  rw [List.mem_map] at this
  obtain ⟨s, _, hs⟩ := this
  have := scored_spec r s hs.symm
  exact ⟨s.raw, s.op, this.2.2.1, this.2.2.2.1, this.2.2.2.2⟩

theorem scoreAll_complete (rows : List (DbRow κ μ))
    (h : ∀ r ∈ rows, ∃ c t, r.raw = some c ∧ r.op = some t ∧ 0 < t) :
    ∃ srows, scoreAll rows = some srows ∧ srows.length = rows.length := by
  induction rows with
  | nil => exact ⟨[], rfl, rfl⟩
  | cons r rs ih =>
    obtain ⟨c, t, hc, ht, hp⟩ := h r (List.mem_cons_self)
    obtain ⟨ss, hss, hl⟩ := ih (fun x hx => h x (List.mem_cons_of_mem _ hx))
    refine ⟨⟨r.sec, r.mod, c, t⟩ :: ss, ?_, by simp [hl]⟩
    have : ¬ t ≤ 0 := by omega
    simp [scoreAll, scored, hc, ht, this, hss]

theorem reportOf_spec (rows : List (DbRow κ μ)) (rep : Summary κ μ)
    (h : reportOf rows = some rep) :
    ∃ srows, scoreAll rows = some srows ∧ srows ≠ [] ∧
      rep = ⟨sumBy (·.raw) srows, sumBy (·.op) srows, (firstKeys srows).map (secOf srows)⟩ := by
  unfold reportOf at h
  split at h
  · cases h
  · rename_i srows hs
    split at h
    · cases h
    · rename_i hne
      cases h
      refine ⟨srows, hs, ?_, by rw [group_exact]⟩
      intro e; subst e; exact hne rfl

/-- SC-06/§3: a report exists only when every module attempt is fully scored
    with a positive operational count, and there is at least one. -/
theorem report_requires_all_scored (rows : List (DbRow κ μ)) (rep : Summary κ μ)
    (h : reportOf rows = some rep) :
    rows ≠ [] ∧ ∀ r ∈ rows, ∃ c t, r.raw = some c ∧ r.op = some t ∧ 0 < t := by
  obtain ⟨srows, hs, hne, _⟩ := reportOf_spec rows rep h
  refine ⟨?_, scoreAll_mem rows srows hs⟩
  intro e; subst e; simp [scoreAll] at hs; exact hne hs

theorem report_complete (rows : List (DbRow κ μ)) (hne : rows ≠ [])
    (h : ∀ r ∈ rows, ∃ c t, r.raw = some c ∧ r.op = some t ∧ 0 < t) :
    ∃ rep, reportOf rows = some rep := by
  obtain ⟨srows, hs, hl⟩ := scoreAll_complete rows h
  have hsne : srows ≠ [] := by
    intro e; subst e; exact hne (List.eq_nil_of_length_eq_zero hl.symm)
  obtain ⟨s0, rest, rfl⟩ := List.exists_cons_of_ne_nil hsne
  have hk : s0.sec ∈ (groupNew (s0 :: rest)).map (·.key) :=
    (group_keys_cover _ _).mpr ⟨s0, List.mem_cons_self, rfl⟩
  have hg : (groupNew (s0 :: rest)).isEmpty = false := by
    cases hgn : groupNew (s0 :: rest) with
    | nil => rw [hgn] at hk; simp at hk
    | cons _ _ => rfl
  exact ⟨⟨sumBy (·.raw) (s0 :: rest), sumBy (·.op) (s0 :: rest), groupNew (s0 :: rest)⟩,
    by unfold reportOf; rw [hs]; simp [hg]⟩

theorem sumBy_zero {α : Type} (l : List α) : sumBy (fun _ => (0:Int)) l = 0 := by
  induction l with
  | nil => rfl
  | cons _ _ ih => simp [sumBy, ih]

theorem sumBy_le {α : Type} (f g : α → Int) (l : List α) (h : ∀ x ∈ l, f x ≤ g x) :
    sumBy f l ≤ sumBy g l := by
  induction l with
  | nil => simp [sumBy]
  | cons x xs ih =>
    simp only [sumBy]
    have := h x (List.mem_cons_self)
    have := ih (fun y hy => h y (List.mem_cons_of_mem _ hy))
    omega

theorem sumBy_pos {α : Type} (f : α → Int) (l : List α) (hne : l ≠ []) (h : ∀ x ∈ l, 0 < f x) :
    0 < sumBy f l := by
  induction l with
  | nil => exact absurd rfl hne
  | cons x xs ih =>
    simp only [sumBy]
    have := h x (List.mem_cons_self)
    have : 0 ≤ sumBy f xs := by
      cases xs with
      | nil => simp [sumBy]
      | cons y ys =>
        exact Int.le_of_lt (ih (by simp) (fun y hy => h y (List.mem_cons_of_mem _ hy)))
    omega

/-- §3 bounds: given `0 ≤ raw ≤ op` per module (Scoring.score_le), the report
    and every section satisfy `0 ≤ rawCorrect ≤ total` and `0 < total`. -/
theorem report_bounds (rows : List (DbRow κ μ)) (rep : Summary κ μ)
    (h : reportOf rows = some rep)
    (hrow : ∀ r ∈ rows, ∀ c t, r.raw = some c → r.op = some t → 0 ≤ c ∧ c ≤ t) :
    0 ≤ rep.raw ∧ rep.raw ≤ rep.total ∧ 0 < rep.total ∧
    ∀ s ∈ rep.sections, 0 ≤ s.raw ∧ s.raw ≤ s.total ∧ 0 < s.total := by
  obtain ⟨srows, hs, hne, rfl⟩ := reportOf_spec rows rep h
  have hm := scoreAll_spec rows srows hs
  have hsr : ∀ s ∈ srows, 0 ≤ s.raw ∧ s.raw ≤ s.op ∧ 0 < s.op := by
    intro s hsm
    have : some s ∈ rows.map scored := hm ▸ List.mem_map_of_mem hsm
    rw [List.mem_map] at this
    obtain ⟨r, hr, hrs⟩ := this
    have hsp := scored_spec r s hrs
    have := hrow r hr s.raw s.op hsp.2.2.1 hsp.2.2.2.1
    exact ⟨this.1, this.2, hsp.2.2.2.2⟩
  refine ⟨?_, ?_, ?_, ?_⟩
  · have := sumBy_le (fun _ => (0:Int)) (·.raw) srows (fun s hs => (hsr s hs).1)
    simpa [sumBy_zero] using this
  · exact sumBy_le _ _ srows (fun s hs => (hsr s hs).2.1)
  · exact sumBy_pos _ srows hne (fun s hs => (hsr s hs).2.2)
  · intro sec hsec
    simp only [List.mem_map] at hsec
    obtain ⟨k, hk, rfl⟩ := hsec
    have hsub : ∀ s ∈ srows.filter (fun r => decide (r.sec = k)), 0 ≤ s.raw ∧ s.raw ≤ s.op ∧ 0 < s.op :=
      fun s hs => hsr s (List.mem_filter.mp hs).1
    obtain ⟨r0, hr0, hr0k⟩ := (firstKeys_mem srows k).mp hk
    have hfne : srows.filter (fun r => decide (r.sec = k)) ≠ [] := by
      intro e
      have : r0 ∈ srows.filter (fun r => decide (r.sec = k)) := List.mem_filter.mpr ⟨hr0, by simp [hr0k]⟩
      rw [e] at this; simp at this
    refine ⟨?_, sumBy_le _ _ _ (fun s hs => (hsub s hs).2.1), sumBy_pos _ _ hfne (fun s hs => (hsub s hs).2.2)⟩
    have := sumBy_le (fun _ => (0:Int)) (·.raw) _ (fun s hs => (hsub s hs).1)
    simpa [secOf, sumBy_zero] using this

/-- REG-01 (data side): the report flag off means no report at all. -/
theorem classroomRaw_disabled (rows : List (DbRow κ μ)) : classroomRaw false rows = none := rfl

end
end Report

/-! ## Attach — staff module breakdown -/
namespace Attach

variable {κ μ : Type} [DecidableEq κ] [DecidableEq μ]
set_option linter.unusedSectionVars false

/-- Each section carries exactly its own module rows, in order. -/
theorem attach_exact (secs : List κ) (mods : List (ModRow κ μ)) (k : κ) (ms : List μ)
    (h : (k, ms) ∈ attachNew secs mods) :
    k ∈ secs ∧ ms = (mods.filter fun r => decide (r.sec = k)).map (·.mod) := by
  simp only [attachNew, List.mem_map, Prod.mk.injEq] at h
  obtain ⟨k', hk', rfl, rfl⟩ := h
  exact ⟨hk', rfl⟩

theorem attach_sound (secs : List κ) (mods : List (ModRow κ μ)) (k : κ) (ms : List μ)
    (h : (k, ms) ∈ attachNew secs mods) (m : μ) (hm : m ∈ ms) :
    ∃ r ∈ mods, r.sec = k ∧ r.mod = m := by
  obtain ⟨_, rfl⟩ := attach_exact secs mods k ms h
  simp only [List.mem_map, List.mem_filter, decide_eq_true_eq] at hm
  obtain ⟨r, ⟨hr, hk⟩, rfl⟩ := hm
  exact ⟨r, hr, hk, rfl⟩

theorem attach_complete (secs : List κ) (mods : List (ModRow κ μ)) (r : ModRow κ μ)
    (hr : r ∈ mods) (hs : r.sec ∈ secs) :
    ∃ ms, (r.sec, ms) ∈ attachNew secs mods ∧ r.mod ∈ ms := by
  refine ⟨_, List.mem_map.mpr ⟨r.sec, hs, rfl⟩, ?_⟩
  exact List.mem_map.mpr ⟨r, List.mem_filter.mpr ⟨hr, by simp⟩, rfl⟩

end Attach

/-! ## Release — student-visible score data -/
namespace Release

variable {V S : Type}

/-- Server: a score is visible only when the normalized release status is "released". -/
theorem visible_only_released (norm : String → String) (p st : String)
    (h : scoreVisible norm p st = true) : norm st = "released" := by
  unfold scoreVisible at h
  by_cases he : norm st = ""
  · rw [if_pos he] at h; cases h
  · rw [if_neg he] at h
    unfold visibleTable at h
    by_cases hp : norm p = "sat" ∨ norm p = "act"
    · rw [if_pos hp] at h; simpa using h
    · rw [if_neg hp] at h; simpa using h

theorem studentSafe_release (norm : String → String) (p : String) (r : Result V S) :
    (studentSafe norm p r).release = r.release := by
  unfold studentSafe; split <;> rfl

/-- A student-visible payload holds nothing but the stored `classroomRaw`, and
    only for a released result. -/
theorem studentSafe_payload (norm : String → String) (p : String) (r : Result V S)
    (key : String) (v : V) (h : (key, v) ∈ (studentSafe norm p r).payload) :
    key = "classroomRaw" ∧ r.payload.lookup "classroomRaw" = some v ∧
    norm r.release = "released" := by
  unfold studentSafe at h
  split at h
  · rename_i hv
    unfold releasedProjection at h
    split at h
    · rename_i v' hl
      simp only [List.mem_singleton, Prod.mk.injEq] at h
      obtain ⟨rfl, rfl⟩ := h
      exact ⟨rfl, hl, visible_only_released norm p _ hv⟩
    · simp at h
  · simp [receiptProjection] at h

/-- Not released → every score-bearing field is withheld. -/
theorem studentSafe_withheld (norm : String → String) (p : String) (r : Result V S)
    (h : scoreVisible norm p r.release = false) :
    (studentSafe norm p r).totalScore = none ∧ (studentSafe norm p r).payload = [] ∧
    (studentSafe norm p r).sections = [] := by
  simp [studentSafe, h, receiptProjection]

theorem client_gate (r : Result V S) (v : V) (h : clientReport r = some v) :
    r.release = "released" ∧ r.payload.lookup "classroomRaw" = some v := by
  unfold clientReport at h
  split at h
  · rename_i hr; exact ⟨hr, h⟩
  · cases h

/-- End to end: what the student page renders is the stored `classroomRaw` of
    a result released by both the server and the client check. -/
theorem student_sees_only_released_raw (norm : String → String) (p : String) (r : Result V S)
    (v : V) (h : clientReport (studentSafe norm p r) = some v) :
    r.release = "released" ∧ norm r.release = "released" ∧
    r.payload.lookup "classroomRaw" = some v := by
  have ⟨hr, hl⟩ := client_gate _ v h
  rw [studentSafe_release] at hr
  refine ⟨hr, ?_⟩
  unfold studentSafe at hl
  split at hl
  · rename_i hv
    unfold releasedProjection at hl
    split at hl
    · rename_i v' hl'
      simp [List.lookup] at hl
      exact ⟨visible_only_released norm p _ hv, hl ▸ hl'⟩
    · simp [List.lookup] at hl
  · simp [receiptProjection, List.lookup] at hl

/-- With the live flag read: the student sees `classroomRaw` only while the
    exam's score-report flag is on and the stored result is released. -/
theorem student_view_gate (enabled : Bool) (norm : String → String) (p : String)
    (r : Result V S) (v : V) (h : clientReport (studentView enabled norm p r) = some v) :
    enabled = true ∧ r.release = "released" ∧ norm r.release = "released" ∧
    r.payload.lookup "classroomRaw" = some v := by
  unfold studentView at h
  split at h
  · simp [clientReport, receiptProjection, List.lookup] at h
  · rename_i hc
    have ⟨h1, h2, h3⟩ := student_sees_only_released_raw norm p r v h
    refine ⟨?_, h1, h2, h3⟩
    cases enabled
    · cases hp : r.payload with
      | nil => rw [hp] at h3; simp [List.lookup] at h3
      | cons x xs => rw [hp] at hc; simp at hc
    · rfl

end Release

/-! ## ResultMachine — result lifecycle -/
namespace ResultMachine
open Report

variable {κ μ : Type} [DecidableEq κ]
set_option linter.unusedSectionVars false

/-- The three legal result shapes. A released result carries exactly the report
    of the current module rows. -/
def RowOK (mods : List (DbRow κ μ)) (row : Row κ μ) : Prop :=
  (row.outcome = .scored ∧ row.rel = .released ∧ ∃ rep, row.raw = some rep ∧ reportOf mods = some rep) ∨
  (row.outcome = .pending ∧ row.rel = .pending ∧ row.raw = none) ∨
  ((row.outcome = .invalidatedTimeout ∨ row.outcome = .invalidatedProctor) ∧
    row.rel = .invalidated ∧ row.raw = none)

def Inv (s : St κ μ) : Prop :=
  ∀ row, s.result = some row → s.sealed = true ∧ s.started = true ∧ RowOK s.mods row

theorem classroomRaw_some (en : Bool) (mods : List (DbRow κ μ)) (rep : Summary κ μ)
    (h : classroomRaw en mods = some rep) : en = true ∧ reportOf mods = some rep := by
  cases en <;> simp_all [classroomRaw]

theorem wantTerminated_invalid (a : Actor) :
    wantTerminated a = .invalidatedTimeout ∨ wantTerminated a = .invalidatedProctor := by
  cases a <;> simp [wantTerminated]

theorem mem_of_get? {α : Type} {l : List α} {i : Nat} {a : α} (h : l[i]? = some a) : a ∈ l := by
  rw [List.getElem?_eq_some_iff] at h
  obtain ⟨hi, rfl⟩ := h
  exact List.getElem_mem hi

/-- A released result's module rows admit no NULL score. -/
theorem released_rows_scored (mods : List (DbRow κ μ)) (rep : Summary κ μ)
    (h : reportOf mods = some rep) (i : Nat) (r : DbRow κ μ) (hi : mods[i]? = some r) :
    r.raw ≠ none ∧ r.op ≠ none := by
  obtain ⟨c, t, hc, ht, _⟩ := (report_requires_all_scored mods rep h).2 r (mem_of_get? hi)
  simp [hc, ht]

/-! ### Transition shapes -/

theorem submit_cases (s : St κ μ) (rf : Bool) :
    (submit s rf).mods = s.mods ∧ (submit s rf).sealed = true ∧
    (submit s rf).started = s.started ∧ (submit s rf).enabled = s.enabled ∧
    ((submit s rf).result = s.result ∨
     (s.result = none ∧ s.started = true ∧
      ((∃ rep, classroomRaw s.reportOpen s.mods = some rep ∧
          (submit s rf).result = some ⟨.scored, .released, some rep⟩) ∨
       (submit s rf).result = some ⟨.pending, .pending, none⟩))) := by
  unfold submit
  split
  · exact ⟨rfl, rfl, rfl, rfl, Or.inl rfl⟩
  · rename_i hst
    have hst' : s.started = true := by simpa using hst
    split
    · exact ⟨rfl, rfl, rfl, rfl, Or.inl rfl⟩
    · rename_i hr
      split
      · rename_i rep hc
        have : classroomRaw s.reportOpen s.mods = some rep := by cases rf <;> simp_all
        exact ⟨rfl, rfl, rfl, rfl, Or.inr ⟨hr, hst', Or.inl ⟨rep, this, rfl⟩⟩⟩
      · exact ⟨rfl, rfl, rfl, rfl, Or.inr ⟨hr, hst', Or.inr rfl⟩⟩

theorem terminate_cases (s : St κ μ) (a : Actor) :
    (terminate s a).mods = s.mods ∧ (terminate s a).sealed = true ∧
    (terminate s a).started = s.started ∧ (terminate s a).enabled = s.enabled ∧
    ((terminate s a).result = s.result ∨
     (s.started = true ∧ (terminate s a).result = some ⟨wantTerminated a, .invalidated, none⟩)) := by
  unfold terminate
  split
  · exact ⟨rfl, rfl, rfl, rfl, Or.inl rfl⟩
  · rename_i hst
    have hst' : s.started = true := by simpa using hst
    split
    · rename_i row hr
      split
      · exact ⟨rfl, rfl, rfl, rfl, Or.inl rfl⟩
      · exact ⟨rfl, rfl, rfl, rfl, Or.inr ⟨hst', rfl⟩⟩
    · exact ⟨rfl, rfl, rfl, rfl, Or.inr ⟨hst', rfl⟩⟩

theorem repair_cases (s : St κ μ) :
    (repair s).mods = s.mods ∧ (repair s).sealed = s.sealed ∧
    (repair s).started = s.started ∧ (repair s).enabled = s.enabled ∧
    ((repair s).result = s.result ∨
     (∃ row rep, s.result = some row ∧ row.outcome = .pending ∧ row.rel = .pending ∧
        classroomRaw s.reportOpen s.mods = some rep ∧
        (repair s).result = some ⟨.scored, .released, some rep⟩)) := by
  unfold repair
  split
  · rename_i row hr
    split
    · rename_i hp
      split
      · rename_i rep hc
        exact ⟨rfl, rfl, rfl, rfl, Or.inr ⟨row, rep, hr, hp.1, hp.2, hc, rfl⟩⟩
      · exact ⟨rfl, rfl, rfl, rfl, Or.inl rfl⟩
    · exact ⟨rfl, rfl, rfl, rfl, Or.inl rfl⟩
  · exact ⟨rfl, rfl, rfl, rfl, Or.inl rfl⟩

/-! ### Invariant -/

theorem inv_init (s : St κ μ) (h : Init s) : Inv s := by
  intro row hr; rw [h.1] at hr; cases hr

theorem inv_step (s s' : St κ μ) (hi : Inv s) (hs : Step s s') : Inv s' := by
  cases hs with
  | lateScore i r c t hr hnull =>
    intro row hrow
    obtain ⟨hse, hst, hok⟩ := hi row hrow
    refine ⟨hse, hst, ?_⟩
    rcases hok with ⟨_, _, rep, _, hrep⟩ | h | h
    · have := released_rows_scored _ rep hrep i r hr
      rcases hnull with e | e <;> simp_all
    · exact Or.inr (Or.inl h)
    · exact Or.inr (Or.inr h)
  | rescore i r c t hse hr =>
    intro row hrow
    have := (hi row hrow).1
    simp_all
  | toggle b => exact hi
  | submit rf =>
    obtain ⟨hm, hse, hst, _, hres⟩ := submit_cases s rf
    intro row hrow
    rw [hm, hse, hst]
    rcases hres with e | ⟨_, hst', (⟨rep, hc, e⟩ | e)⟩
    · rw [e] at hrow; obtain ⟨_, h2, h3⟩ := hi row hrow; exact ⟨rfl, h2, h3⟩
    · rw [e] at hrow; cases hrow
      exact ⟨rfl, hst', Or.inl ⟨rfl, rfl, rep, rfl, (classroomRaw_some _ _ _ hc).2⟩⟩
    · rw [e] at hrow; cases hrow
      exact ⟨rfl, hst', Or.inr (Or.inl ⟨rfl, rfl, rfl⟩)⟩
  | terminate a =>
    obtain ⟨hm, hse, hst, _, hres⟩ := terminate_cases s a
    intro row hrow
    rw [hm, hse, hst]
    rcases hres with e | ⟨hst', e⟩
    · rw [e] at hrow; obtain ⟨_, h2, h3⟩ := hi row hrow; exact ⟨rfl, h2, h3⟩
    · rw [e] at hrow; cases hrow
      exact ⟨rfl, hst', Or.inr (Or.inr ⟨wantTerminated_invalid a, rfl, rfl⟩)⟩
  | repair =>
    obtain ⟨hm, hse, hst, _, hres⟩ := repair_cases s
    intro row hrow
    rw [hm, hse, hst]
    rcases hres with e | ⟨row0, rep, hr0, _, _, hc, e⟩
    · rw [e] at hrow; exact hi row hrow
    · rw [e] at hrow; cases hrow
      obtain ⟨h1, h2, _⟩ := hi row0 hr0
      exact ⟨h1, h2, Or.inl ⟨rfl, rfl, rep, rfl, (classroomRaw_some _ _ _ hc).2⟩⟩

theorem inv_reachable (s : St κ μ) (h : Reachable s) : Inv s := by
  induction h with
  | init s hi => exact inv_init s hi
  | step s s' _ hs ih => exact inv_step s s' ih hs

/-- A released result carries exactly the classroom report of its module rows. -/
theorem released_report_faithful (s : St κ μ) (h : Reachable s) (row : Row κ μ)
    (hr : s.result = some row) (hrel : row.rel = .released) :
    row.outcome = .scored ∧ ∃ rep, row.raw = some rep ∧ reportOf s.mods = some rep := by
  obtain ⟨_, _, hok⟩ := inv_reachable s h row hr
  rcases hok with ⟨h1, _, h3⟩ | ⟨_, h2, _⟩ | ⟨_, h2, _⟩
  · exact ⟨h1, h3⟩
  · rw [hrel] at h2; cases h2
  · rw [hrel] at h2; cases h2

/-- REG-01: no step releases a result unless, in the state it fires from, the
    report flag is on and the attempt sat a classroom session. -/
theorem released_only_when_enabled (s s' : St κ μ) (hs : Step s s')
    (hpre : ∀ row, s.result = some row → row.rel ≠ .released)
    (row' : Row κ μ) (h' : s'.result = some row') (hrel : row'.rel = .released) :
    s.enabled = true ∧ s.classroom = true := by
  suffices h : s.reportOpen = true by simpa [St.reportOpen] using h
  cases hs with
  | lateScore => exact absurd hrel (hpre row' h')
  | rescore => exact absurd hrel (hpre row' h')
  | toggle => exact absurd hrel (hpre row' h')
  | submit rf =>
    rcases (submit_cases s rf).2.2.2.2 with e | ⟨_, _, (⟨rep, hc, e⟩ | e)⟩
    · rw [e] at h'; exact absurd hrel (hpre row' h')
    · exact (classroomRaw_some _ _ _ hc).1
    · rw [e] at h'; cases h'; cases hrel
  | terminate a =>
    rcases (terminate_cases s a).2.2.2.2 with e | ⟨_, e⟩
    · rw [e] at h'; exact absurd hrel (hpre row' h')
    · rw [e] at h'; cases h'; cases hrel
  | repair =>
    rcases (repair_cases s).2.2.2.2 with e | ⟨_, rep, _, _, _, hc, _⟩
    · rw [e] at h'; exact absurd hrel (hpre row' h')
    · exact (classroomRaw_some _ _ _ hc).1

/-- The session mode is fixed: no step changes it. -/
theorem step_classroom (s s' : St κ μ) (hs : Step s s') : s'.classroom = s.classroom := by
  cases hs with
  | lateScore => rfl
  | rescore => rfl
  | toggle => rfl
  | submit rf =>
    unfold submit
    by_cases h : s.started = false
    · simp only [h, if_true]
    · simp only [h, if_false]; cases s.result <;> simp only <;> (repeat' split) <;> rfl
  | terminate a =>
    unfold terminate
    by_cases h : s.started = false
    · simp only [h, if_true]
    · simp only [h, if_false]; cases s.result <;> simp only <;> (repeat' split) <;> rfl
  | repair => unfold repair; cases s.result <;> simp only <;> (try split) <;> (try split) <;> rfl

/-- REG-01 over whole executions: a Standard Practice sitting with no released
    result never gets one, under every module scoring schedule, flag toggle,
    submit, termination and repair run. -/
theorem practice_never_released (s s' : St κ μ) (hstar : Star s s')
    (hp : s.classroom = false) (hres : ∀ row, s.result = some row → row.rel ≠ .released) :
    ∀ row, s'.result = some row → row.rel ≠ .released := by
  suffices P : s'.classroom = false ∧ ∀ row, s'.result = some row → row.rel ≠ .released from P.2
  induction hstar with
  | refl => exact ⟨hp, hres⟩
  | tail t u _ hs ih =>
    obtain ⟨htc, htr⟩ := ih
    refine ⟨(step_classroom t u hs).trans htc, fun row hu hrel => ?_⟩
    have := (released_only_when_enabled t u hs htr row hu hrel).2
    rw [htc] at this; cases this

/-- An attempt that never started never gets a result row. -/
theorem never_started_no_result (s : St κ μ) (h : Reachable s) (hs : s.started = false) :
    s.result = none := by
  cases hr : s.result with
  | none => rfl
  | some row => have := (inv_reachable s h row hr).2.1; simp_all

/-- Re-running submit never rewrites an existing result. -/
theorem submit_idempotent (s : St κ μ) (rf : Bool) (row : Row κ μ) (hr : s.result = some row) :
    (submit s rf).result = s.result := by
  rcases (submit_cases s rf).2.2.2.2 with e | ⟨hn, _⟩
  · exact e
  · rw [hn] at hr; cases hr

/-- A repeated termination by the same actor is a no-op on the result. -/
theorem terminate_idempotent (s : St κ μ) (a : Actor) :
    (terminate (terminate s a) a).result = (terminate s a).result := by
  unfold terminate
  split
  · rename_i hst
    simp only [hst, if_true]
  · rename_i hst
    split
    · split
      · simp [hst, *]
      · simp [hst]
    · simp [hst]

/-- Once released, module data is frozen and the result changes only by a
    later termination, which invalidates it (documented limitation). -/
theorem released_immutable (s s' : St κ μ) (h : Reachable s) (row : Row κ μ)
    (hr : s.result = some row) (hrel : row.rel = .released) (hs : Step s s') :
    s'.mods = s.mods ∧
    (s'.result = s.result ∨ ∃ a, s'.result = some ⟨wantTerminated a, .invalidated, none⟩) := by
  obtain ⟨hse, _, _⟩ := inv_reachable s h row hr
  obtain ⟨_, rep, _, hrep⟩ := released_report_faithful s h row hr hrel
  cases hs with
  | lateScore i r c t hi hnull =>
    have := released_rows_scored _ rep hrep i r hi
    rcases hnull with e | e <;> simp_all
  | rescore => simp_all
  | toggle => exact ⟨rfl, Or.inl rfl⟩
  | submit rf => exact ⟨(submit_cases s rf).1, Or.inl (submit_idempotent s rf row hr)⟩
  | terminate a =>
    refine ⟨(terminate_cases s a).1, ?_⟩
    rcases (terminate_cases s a).2.2.2.2 with e | ⟨_, e⟩
    · exact Or.inl e
    · exact Or.inr ⟨a, e⟩
  | repair =>
    refine ⟨(repair_cases s).1, ?_⟩
    rcases (repair_cases s).2.2.2.2 with e | ⟨row0, _, hr0, _, hp, _, _⟩
    · exact Or.inl e
    · rw [hr] at hr0; cases hr0; rw [hrel] at hp; cases hp

/-- Happy path: a started classroom attempt submitted with every module scored
    and the flag on is released in the same transaction. -/
theorem submit_releases (s : St κ μ) (hst : s.started = true) (hres : s.result = none)
    (hen : s.enabled = true) (hcl : s.classroom = true) (hne : s.mods ≠ [])
    (hall : ∀ r ∈ s.mods, ∃ c t, r.raw = some c ∧ r.op = some t ∧ 0 < t) :
    ∃ rep, reportOf s.mods = some rep ∧
      (submit s false).result = some ⟨.scored, .released, some rep⟩ := by
  obtain ⟨rep, hrep⟩ := report_complete s.mods hne hall
  refine ⟨rep, hrep, ?_⟩
  simp [submit, hst, hres, classroomRaw, St.reportOpen, hen, hcl, hrep]

/-- Conditional liveness (repair worker fairness): one repair pass releases a
    pending classroom result once every module is scored. -/
theorem repair_releases (s : St κ μ) (hres : s.result = some ⟨.pending, .pending, none⟩)
    (hen : s.enabled = true) (hcl : s.classroom = true) (hne : s.mods ≠ [])
    (hall : ∀ r ∈ s.mods, ∃ c t, r.raw = some c ∧ r.op = some t ∧ 0 < t) :
    ∃ rep, reportOf s.mods = some rep ∧
      (repair s).result = some ⟨.scored, .released, some rep⟩ := by
  obtain ⟨rep, hrep⟩ := report_complete s.mods hne hall
  refine ⟨rep, hrep, ?_⟩
  simp [repair, hres, classroomRaw, St.reportOpen, hen, hcl, hrep]

theorem report_blocked (mods : List (DbRow κ μ)) (j : Nat) (r : DbRow κ μ) (t : Int)
    (hj : mods[j]? = some r) (ht : r.op = some t) (ht0 : t ≤ 0) : reportOf mods = none := by
  cases h : reportOf mods with
  | none => rfl
  | some rep =>
    obtain ⟨c', t', _, ht', hp⟩ := (report_requires_all_scored mods rep h).2 r (mem_of_get? hj)
    rw [ht] at ht'; cases ht'; omega

/-- Liveness gap: once sealed, a fully scored module with no operational
    questions (`op ≤ 0`, e.g. pretest-only) blocks release forever, under every
    environment schedule, flag toggle and repair run. -/
theorem zero_op_never_released (s s' : St κ μ) (j : Nat) (r : DbRow κ μ) (c t : Int)
    (hseal : s.sealed = true) (hj : s.mods[j]? = some r) (hc : r.raw = some c)
    (ht : r.op = some t) (ht0 : t ≤ 0)
    (hres : ∀ row, s.result = some row → row.rel ≠ .released) (hstar : Star s s') :
    ∀ row, s'.result = some row → row.rel ≠ .released := by
  suffices P : s'.sealed = true ∧ s'.mods[j]? = some r ∧
      ∀ row, s'.result = some row → row.rel ≠ .released from P.2.2
  induction hstar with
  | refl => exact ⟨hseal, hj, hres⟩
  | tail u v _ hstep ih =>
    obtain ⟨hs, hju, hru⟩ := ih
    have hblk := report_blocked u.mods j r t hju ht ht0
    cases hstep with
    | lateScore i r' c' t' hi hnull =>
      refine ⟨hs, ?_, hru⟩
      by_cases hij : i = j
      · subst hij; rw [hju] at hi; cases hi
        rcases hnull with e | e <;> simp_all
      · simp only; rw [List.getElem?_set_ne hij]; exact hju
    | rescore => simp_all
    | toggle b => exact ⟨hs, hju, hru⟩
    | submit rf =>
      obtain ⟨hm, hse, _, _, hr⟩ := submit_cases u rf
      refine ⟨hse, hm ▸ hju, ?_⟩
      intro row hrow
      rcases hr with e | ⟨_, _, (⟨rep, hcr, _⟩ | e)⟩
      · rw [e] at hrow; exact hru row hrow
      · simp [classroomRaw, hblk] at hcr
      · rw [e] at hrow; cases hrow; simp
    | terminate a =>
      obtain ⟨hm, hse, _, _, hr⟩ := terminate_cases u a
      refine ⟨hse, hm ▸ hju, ?_⟩
      intro row hrow
      rcases hr with e | ⟨_, e⟩
      · rw [e] at hrow; exact hru row hrow
      · rw [e] at hrow; cases hrow; simp
    | repair =>
      obtain ⟨hm, hse, _, _, hr⟩ := repair_cases u
      refine ⟨hse ▸ hs, hm ▸ hju, ?_⟩
      intro row hrow
      rcases hr with e | ⟨_, rep, _, _, _, hcr, _⟩
      · rw [e] at hrow; exact hru row hrow
      · simp [classroomRaw, hblk] at hcr

end ResultMachine

/-! ## Paper — answered-exam marking (PDF-01..06) -/
namespace Paper

variable {α : Type} [DecidableEq α]
set_option linter.unusedSectionVars false

/-- PDF-01/PDF-02: an option is circled iff it is the recorded answer (no key input). -/
theorem circle_iff (opts : List α) (a : Option α) (o : α) :
    o ∈ circled opts a ↔ o ∈ opts ∧ a = some o := by
  simp [circled]

/-- With distinct option ids, a matched answer circles exactly one option. -/
theorem circle_exact (opts : List α) (x : α) (hnd : opts.Nodup) (hx : x ∈ opts) :
    circled opts (some x) = [x] := by
  induction opts with
  | nil => cases hx
  | cons o os ih =>
    rw [List.nodup_cons] at hnd
    by_cases ho : x = o
    · subst ho
      have : circled os (some x) = [] :=
        List.filter_eq_nil_iff.mpr (fun y hy => by
          have : x ≠ y := fun e => hnd.1 (e ▸ hy)
          simpa using this)
      simp [circled, List.filter_cons] at this ⊢; exact this
    · have hx' : x ∈ os := by simpa [ho] using hx
      have := ih hnd.2 hx'
      simp [circled, List.filter_cons, ho] at this ⊢; exact this

theorem unanswered_none (opts : List α) :
    circled opts none = [] ∧ unmatched opts none = false ∧ unanswered (none : Option α) = true := by
  simp [circled, unmatched, unanswered]

theorem unmatched_no_circle (opts : List α) (a : Option α) (h : unmatched opts a = true) :
    circled opts a = [] := by
  cases a with
  | none => simp [unmatched] at h
  | some x =>
    simp [unmatched] at h
    exact List.filter_eq_nil_iff.mpr (fun y hy => by
      have : x ≠ y := fun e => h (e ▸ hy)
      simpa using this)

/-- PDF-01/PDF-03: every question shows exactly one of: a circled option, the
    unmatched-answer note, or "Unanswered". -/
theorem exactly_one_indication (opts : List α) (a : Option α) :
    (if circled opts a = [] then 0 else 1) + (if unmatched opts a then 1 else 0) +
      (if unanswered a then 1 else 0) = 1 := by
  cases a with
  | none => simp [circled, unmatched, unanswered]
  | some x =>
    by_cases hx : x ∈ opts
    · have : x ∈ circled opts (some x) := (circle_iff opts (some x) x).mpr ⟨hx, rfl⟩
      have hne : circled opts (some x) ≠ [] := fun e => by rw [e] at this; cases this
      simp [hne, unmatched, unanswered, hx]
    · have hum : unmatched opts (some x) = true := by simp [unmatched, hx]
      simp [unmatched_no_circle opts (some x) hum, hum, unanswered]

section
variable {ρ μ ε : Type} [DecidableEq μ] [DecidableEq ε]

theorem fold_untouched (modOf : ρ → Option μ) (rs : List (Resp ρ ε α)) (k : μ × ε)
    (f : μ × ε → Option α) (h : ∀ r ∈ rs, keyOf modOf r ≠ some k) :
    rs.foldl (upd modOf) f k = f k := by
  induction rs generalizing f with
  | nil => rfl
  | cons r rs ih =>
    simp only [List.foldl]
    rw [ih _ (fun r' hr' => h r' (List.mem_cons_of_mem _ hr'))]
    have hk := h r List.mem_cons_self
    unfold upd
    cases hko : keyOf modOf r with
    | none => rfl
    | some k' =>
      cases hv : r.value with
      | none => rfl
      | some v =>
        have : k ≠ k' := fun e => hk (e ▸ hko)
        simp [this]

/-- PDF-04/PDF-06: the paper shows, for each (module, question), exactly the value of
    the one saved response with that key (unique by
    `uq_module_attempt_question`); a blank value shows as unanswered. -/
theorem answer_unique (modOf : ρ → Option μ) (pre post : List (Resp ρ ε α))
    (r : Resp ρ ε α) (k : μ × ε) (hk : keyOf modOf r = some k)
    (hpre : ∀ r' ∈ pre, keyOf modOf r' ≠ some k) (hpost : ∀ r' ∈ post, keyOf modOf r' ≠ some k) :
    answerMap modOf (pre ++ r :: post) k = r.value := by
  unfold answerMap
  rw [List.foldl_append, List.foldl_cons, fold_untouched modOf post k _ hpost]
  unfold upd
  rw [hk]
  cases hv : r.value with
  | some v => simp
  | none => simp only; exact fold_untouched modOf pre k _ hpre

theorem answer_absent (modOf : ρ → Option μ) (rs : List (Resp ρ ε α)) (k : μ × ε)
    (h : ∀ r ∈ rs, keyOf modOf r ≠ some k) : answerMap modOf rs k = none :=
  fold_untouched modOf rs k _ h

end

/-- PAPER-3: `data-complete` iff every administered module is printable. -/
theorem complete_iff {μ : Type} (adm : List μ) (p : μ → Bool) :
    complete adm p = true ↔ ∀ m ∈ adm, p m = true := by
  unfold complete
  induction adm with
  | nil => simp
  | cons a l ih =>
    have hle := List.length_filter_le p l
    by_cases hp : p a = true
    · simp [List.filter_cons, hp] at ih ⊢
    · simp [List.filter_cons, hp]; omega

end Paper

/-! ## PrintGate — the print button prints only a fresh, complete, decoded paper (PDF-10) -/
namespace PrintGate

def Good (p : Print) : Prop :=
  p.complete = true ∧ p.decoded = true ∧ p.failed = false ∧ p.paperGen = p.gen ∧
  p.clickEpoch < p.flowEpoch ∧ p.flowEpoch ≤ p.renderEpoch

def Inv (s : St) : Prop :=
  s.reqGen = s.gen ∧ s.paperGen ≤ s.gen ∧
  (s.paperGen = s.gen → s.renderEpoch = s.epoch) ∧
  (s.busy = false ↔ s.phase = .idle) ∧
  (s.phase = .reloading → s.clickEpoch = s.epoch) ∧
  (∀ g, s.phase = .polling g → g = s.gen ∧ s.flowEpoch = s.epoch ∧ s.clickEpoch < s.epoch) ∧
  (∀ p ∈ s.printed, Good p)

theorem inv_init : Inv init := by
  refine ⟨rfl, Nat.le_refl _, fun _ => rfl, ?_, ?_, ?_, ?_⟩ <;> simp [init]

theorem inv_step (s s' : St) (hi : Inv s) (hs : Step s s') : Inv s' := by
  obtain ⟨hreq, hle, hrend, hbusy, hrel, hpoll, hgood⟩ := hi
  cases hs with
  | click hb =>
    have hidle := hbusy.mp hb
    refine ⟨hreq, hle, hrend, by simp, fun _ => rfl, ?_, hgood⟩
    intro g hg; cases hg
  | reloadFail hph =>
    refine ⟨hreq, hle, hrend, by simp, ?_, ?_, hgood⟩
    · intro h; cases h
    · intro g h; cases h
  | reloadOk hph =>
    have hb : s.busy = true := by
      cases hb' : s.busy
      · have := hbusy.mp hb'; rw [hph] at this; cases this
      · rfl
    refine ⟨rfl, by simp; omega, ?_, ?_, ?_, ?_, hgood⟩
    · intro h; simp at h; omega
    · simp [hb]
    · intro h; cases h
    · intro g hg
      simp at hg
      have := hrel hph
      subst hg
      refine ⟨rfl, rfl, ?_⟩
      simp; omega
  | render c d _ =>
    refine ⟨hreq, by simp [hreq], fun _ => rfl, hbusy, hrel, ?_, hgood⟩
    intro g hg; exact hpoll g hg
  | env c d _ =>
    exact ⟨hreq, hle, fun _ => rfl, hbusy, hrel, hpoll, hgood⟩
  | mediaFail =>
    exact ⟨hreq, hle, hrend, hbusy, hrel, hpoll, hgood⟩
  | pollFail g hph hf =>
    refine ⟨hreq, hle, hrend, by simp, ?_, ?_, hgood⟩
    · intro h; cases h
    · intro g h; cases h
  | pollPrint g hph hf hpg hc hd =>
    obtain ⟨hg, hfe, hce⟩ := hpoll g hph
    have hre := hrend (by rw [hpg, hg])
    refine ⟨hreq, hle, hrend, by simp, ?_, ?_, ?_⟩
    · intro h; cases h
    · intro g h; cases h
    · intro p hp
      simp only [List.mem_append, List.mem_singleton] at hp
      rcases hp with hp | rfl
      · exact hgood p hp
      · simp only [Good, snapshot]
        exact ⟨hc, hd, hf, hpg, by omega, by omega⟩
  | timeout g hph =>
    refine ⟨hreq, hle, hrend, by simp, ?_, ?_, hgood⟩
    · intro h; cases h
    · intro g h; cases h

theorem inv_reachable (s : St) (h : Reachable s) : Inv s := by
  induction h with
  | init => exact inv_init
  | step s s' _ hs ih => exact inv_step s s' ih hs

/-- PDF-10. Cited by SatScoreReport.tsx `printAnsweredExam`: every print shows a
    complete paper with all figures decoded and no media failure, mounted for
    this flow's generation, rendered from a source at least as fresh as an
    authoritative reload that completed after the click. -/
theorem print_gate_sound (s : St) (h : Reachable s) (p : Print) (hp : p ∈ s.printed) :
    p.complete = true ∧ p.decoded = true ∧ p.failed = false ∧ p.paperGen = p.gen ∧
    p.clickEpoch < p.flowEpoch ∧ p.flowEpoch ≤ p.renderEpoch :=
  (inv_reachable s h).2.2.2.2.2.2 p hp

/-- At most one download flow at a time: a new click needs an idle gate. -/
theorem single_flight (s : St) (h : Reachable s) : s.busy = false ↔ s.phase = .idle :=
  (inv_reachable s h).2.2.2.1

/-- A flow never hangs: from any polling state the deadline ends it. -/
theorem poll_can_end (s : St) (g : Nat) (hph : s.phase = .polling g) :
    ∃ s', Step s s' ∧ s'.phase = .idle ∧ s'.busy = false ∧ s'.printed = s.printed :=
  ⟨_, Step.timeout s g hph, rfl, rfl, rfl⟩

end PrintGate

/-! ## CloseAck — the authoritative reload makes the paper match the server -/
namespace CloseAck

variable {α : Type}

theorem reload_faithful (s : St α) : ({ s with cache := s.server } : St α).cache = s.server := rfl

/-- After the module closes, the server's accepted answer never changes. -/
theorem closed_server_frozen (s s' : St α) (h : s.isOpen = false) (hs : Step s s') :
    s'.isOpen = false ∧ s'.server = s.server := by
  cases hs with
  | edit v ho => rw [h] at ho; cases ho
  | deliver v _ => simp [h]
  | close => exact ⟨rfl, rfl⟩
  | closeAck => exact ⟨h, rfl⟩
  | reload => exact ⟨h, rfl⟩

/-- Sealed and reloaded: the client source equals the server's accepted answers
    from then on, under every later step. -/
theorem sealed_reload_faithful (s s' : St α) (h : s.isOpen = false) (hc : s.cache = s.server)
    (hs : Star s s') : s'.isOpen = false ∧ s'.cache = s'.server := by
  induction hs with
  | refl => exact ⟨h, hc⟩
  | tail u v _ hstep ih =>
    obtain ⟨hu, hcu⟩ := ih
    cases hstep with
    | edit x ho => rw [hu] at ho; cases ho
    | deliver x _ => simp [hu, hcu]
    | close => exact ⟨rfl, hcu⟩
    | closeAck => exact ⟨hu, hcu⟩
    | reload => exact ⟨hu, rfl⟩

end CloseAck

/-! ## ConvertTopo — R-1 versioned converter (SC-01..05) -/
namespace ConvertTopo

/-- `Convert` returns exactly the entry of the table for this section and
    topology, and only when the attempt's operational count is the table's. -/
theorem convert_spec (c : Option Conv) (sec : String) (τ : Topology) (raw ops : Nat) (s : Score) :
    convert c sec τ raw ops = some s ↔
      ∃ k t, c = some k ∧ k.table sec τ = some t ∧ t.ops = ops ∧ raw ≤ ops ∧ t.scores raw = s := by
  constructor
  · intro h
    cases c with
    | none => cases h
    | some k =>
      cases ht : k.table sec τ with
      | none => simp [convert, ht] at h
      | some t =>
        simp only [convert, ht] at h
        split at h
        · rename_i hc
          cases h
          exact ⟨k, t, rfl, ht, hc.1.symm, hc.2, rfl⟩
        · cases h
  · rintro ⟨k, t, rfl, ht, rfl, hr, rfl⟩
    simp [convert, ht, hr]

/-- REQ-NF / SC-01: a valid converter only yields 200–800 multiples of 10. -/
theorem convert_sound (k : Conv) (hk : k.valid) (sec : String) (τ : Topology) (raw ops : Nat)
    (s : Score) (h : convert (some k) sec τ raw ops = some s) : s.valid := by
  obtain ⟨k', t, hk', ht, hops, hr, rfl⟩ := (convert_spec _ _ _ _ _ _).1 h
  cases hk'
  exact (hk sec τ t ht).2 raw (by omega)

/-- SC-05: no converter, no table for the topology, another operational count,
    or a raw score above the count each yield "unavailable", never a number. -/
theorem convert_fails_closed (c : Option Conv) (sec : String) (τ : Topology) (raw ops : Nat) :
    (c = none → convert c sec τ raw ops = none) ∧
    (∀ k, c = some k → k.table sec τ = none → convert c sec τ raw ops = none) ∧
    (∀ k t, c = some k → k.table sec τ = some t → t.ops ≠ ops → convert c sec τ raw ops = none) ∧
    (ops < raw → convert c sec τ raw ops = none) := by
  refine ⟨?_, ?_, ?_, ?_⟩
  · rintro rfl; rfl
  · rintro k rfl h; simp [convert, h]
  · rintro k t rfl h hne; simp [convert, h, Ne.symm hne]
  · intro hr
    cases c with
    | none => rfl
    | some k =>
      cases ht : k.table sec τ with
      | none => simp [convert, ht]
      | some t => simp only [convert, ht]; rw [if_neg (by omega)]

/-- SC-03: a conversion reads only its own (section, topology) table. -/
theorem convert_local (k₁ k₂ : Conv) (sec : String) (τ : Topology) (raw ops : Nat)
    (h : k₁.table sec τ = k₂.table sec τ) :
    convert (some k₁) sec τ raw ops = convert (some k₂) sec τ raw ops := by
  simp only [convert, h]

/-- The converter with every full two-module table erased. -/
def Conv.dropFull (k : Conv) : Conv := ⟨fun sec τ => if τ.full then none else k.table sec τ⟩

/-- SC-04: a standalone Module 2 never reads a full two-module table: erasing
    every full table leaves its conversion unchanged. -/
theorem standalone_ignores_full (k : Conv) (sec : String) (τ : Topology) (hτ : τ.full = false)
    (raw ops : Nat) :
    convert (some k) sec τ raw ops = convert (some k.dropFull) sec τ raw ops :=
  convert_local _ _ _ _ _ _ (by simp [Conv.dropFull, hτ])

/-- `TopologyOf`: a full topology means exactly M1 plus one Module 2; a
    standalone one means a single Module 2 and no M1. -/
theorem topologyOf_counts (rs : List Role) (τ : Topology) (h : topologyOf rs = some τ) :
    count .base rs = (if τ.full then 1 else 0) ∧ rs.length = (if τ.full then 2 else 1) := by
  unfold topologyOf at h
  split at h <;> (try cases h) <;> simp_all [Topology.full]

/-- Unadministrable or ambiguous role sets convert nothing. -/
theorem topologyOf_rejects :
    topologyOf [] = none ∧ topologyOf [.base] = none ∧ topologyOf [.base, .base] = none ∧
    topologyOf [.lower, .higher] = none ∧ topologyOf [.base, .lower, .higher] = none ∧
    topologyOf [.other] = none ∧ topologyOf [.base, .other] = none := by decide

theorem topologyOf_order :
    topologyOf [.lower, .base] = some .fullLower ∧ topologyOf [.higher, .base] = some .fullHigher := by
  decide

/-- One section of `convertClassroomScoresTx`. -/
theorem sectionScore_spec (c : Option Conv) (sec : String) (rs : List Role) (raw ops : Nat)
    (τ : Topology) (s : Score) (h : sectionScore c sec rs raw ops = some (τ, s)) :
    topologyOf rs = some τ ∧ convert c sec τ raw ops = some s := by
  cases hτ : topologyOf rs with
  | none => simp [sectionScore, hτ] at h
  | some τ' =>
    cases hc : convert c sec τ' raw ops with
    | none => simp [sectionScore, hτ, hc] at h
    | some s' =>
      simp [sectionScore, hτ, hc] at h
      obtain ⟨rfl, rfl⟩ := h
      exact ⟨rfl, hc⟩

/-- Legacy raw-only policy: no section ever gets a number. -/
theorem raw_only_never_scales (sec : String) (rs : List Role) (raw ops : Nat) :
    sectionScore none sec rs raw ops = none := by
  unfold sectionScore; split <;> rfl

/-- SC-02: a total exists only from two full-topology sections and is their sum. -/
theorem total_requires_full (a b : Option (Topology × Score)) (s : Score) (h : total a b = some s) :
    ∃ τ₁ x τ₂ y, a = some (τ₁, x) ∧ b = some (τ₂, y) ∧ τ₁.full = true ∧ τ₂.full = true ∧
      s = ⟨x.low + y.low, x.high + y.high⟩ := by
  match a, b, h with
  | some (τ₁, x), some (τ₂, y), h =>
    simp only [total] at h
    split at h
    · rename_i hf
      cases h
      exact ⟨τ₁, x, τ₂, y, rfl, rfl, hf.1, hf.2, rfl⟩
    · cases h
  | none, _, h => simp [total] at h
  | some _, none, h => simp [total] at h

/-- SC-01/SC-02 end to end: a total needs Module 1 and one Module 2 in both
    sections, and from a valid converter it is a 400–1600 multiple of 10. -/
theorem total_sound (k : Conv) (hk : k.valid) (sec₁ sec₂ : String) (rs₁ rs₂ : List Role)
    (r₁ o₁ r₂ o₂ : Nat) (s : Score)
    (h : total (sectionScore (some k) sec₁ rs₁ r₁ o₁) (sectionScore (some k) sec₂ rs₂ r₂ o₂) = some s) :
    count .base rs₁ = 1 ∧ rs₁.length = 2 ∧ count .base rs₂ = 1 ∧ rs₂.length = 2 ∧
      400 ≤ s.low ∧ s.low ≤ s.high ∧ s.high ≤ 1600 ∧ s.low % 10 = 0 ∧ s.high % 10 = 0 := by
  obtain ⟨τ₁, x, τ₂, y, ha, hb, hf₁, hf₂, rfl⟩ := total_requires_full _ _ _ h
  obtain ⟨hτ₁, hc₁⟩ := sectionScore_spec _ _ _ _ _ _ _ ha
  obtain ⟨hτ₂, hc₂⟩ := sectionScore_spec _ _ _ _ _ _ _ hb
  have c₁ := topologyOf_counts _ _ hτ₁
  have c₂ := topologyOf_counts _ _ hτ₂
  simp only [hf₁, hf₂, if_true] at c₁ c₂
  have vx := convert_sound k hk _ _ _ _ _ hc₁
  have vy := convert_sound k hk _ _ _ _ _ hc₂
  unfold Score.valid at vx vy
  refine ⟨c₁.1, c₁.2, c₂.1, c₂.2, ?_⟩
  dsimp only
  omega

/-- Every route a plan shape can administer is one of its gate topologies. -/
theorem administered_in_plan (sh : Shape) (higher : Bool) :
    ∃ τ, topologyOf (administered sh higher) = some τ ∧ τ ∈ topologiesFor sh := by
  cases sh <;> cases higher
  all_goals first
    | exact ⟨.fullLower, by decide, by decide⟩
    | exact ⟨.fullHigher, by decide, by decide⟩
    | exact ⟨.m2LowerOnly, by decide, by decide⟩
    | exact ⟨.m2HigherOnly, by decide, by decide⟩

/-- Publish gate completeness: once `validateConverter` passes, every route
    the published plan can administer converts every in-range raw score, so a
    published classroom exam never reports "unavailable" for a delivered route
    (given the attempt's operational count is the plan's, ASM-CV-1). -/
theorem gate_complete (k : Conv) (sec : String) (sh : Shape) (opsOf : Topology → Nat)
    (hg : gateOk k sec sh opsOf) (higher : Bool) (raw : Nat) :
    ∃ τ, topologyOf (administered sh higher) = some τ ∧
      (raw ≤ opsOf τ → ∃ s, sectionScore (some k) sec (administered sh higher) raw (opsOf τ) = some (τ, s)) := by
  obtain ⟨τ, hτ, hmem⟩ := administered_in_plan sh higher
  obtain ⟨t, ht, hops⟩ := hg τ hmem
  refine ⟨τ, hτ, fun hr => ⟨t.scores raw, ?_⟩⟩
  simp [sectionScore, hτ, convert, ht, hops, hr]

end ConvertTopo

/-! ## RepairQueue — LIVE-1 under any number of withheld rows (A-FAIR) -/
namespace RepairQueue
open Report

section
variable {κ μ : Type} [DecidableEq κ]

omit [DecidableEq κ] in
theorem scoreAll_isSome (rows : List (DbRow κ μ)) :
    (scoreAll rows).isSome = rows.all fun r => (scored r).isSome := by
  induction rows with
  | nil => rfl
  | cons r rs ih =>
    simp only [scoreAll, List.all_cons]
    cases hr : scored r <;> cases hs : scoreAll rs <;> simp_all

omit [DecidableEq κ] in
theorem scoreAll_nil_iff (rows : List (DbRow κ μ)) (ss : List (SRow κ μ))
    (h : scoreAll rows = some ss) : ss = [] ↔ rows = [] := by
  induction rows generalizing ss with
  | nil => simp [scoreAll] at h; simp [h]
  | cons r rs ih =>
    simp only [scoreAll] at h
    cases hr : scored r <;> cases hs : scoreAll rs <;> simp [hr, hs] at h <;> subst h <;> simp

theorem upsert_ne_nil (r : SRow κ μ) (l : List (Sec κ μ)) : upsert r l ≠ [] := by
  cases l with
  | nil => simp [upsert]
  | cons s ss => simp only [upsert]; split <;> simp

theorem foldl_upsert_ne_nil (rows : List (SRow κ μ)) (acc : List (Sec κ μ))
    (h : acc ≠ [] ∨ rows ≠ []) : rows.foldl (fun acc r => upsert r acc) acc ≠ [] := by
  induction rows generalizing acc with
  | nil => simpa using h
  | cons r rs ih => exact ih _ (Or.inl (upsert_ne_nil r acc))

theorem groupNew_isEmpty (rows : List (SRow κ μ)) : (groupNew rows).isEmpty = rows.isEmpty := by
  cases rows with
  | nil => rfl
  | cons r rs =>
    have := foldl_upsert_ne_nil (r :: rs) [] (Or.inr (by simp))
    simp only [groupNew, List.isEmpty_cons]
    cases h : List.foldl (fun acc r => upsert r acc) [] (r :: rs) with
    | nil => exact absurd h this
    | cons _ _ => rfl

/-- Correspondence: the readiness filter added to `classroomPendingSQL` selects
    exactly the rows for which `classroomRawScoreTx` (gate on) returns a report. -/
theorem sqlReady_iff (rows : List (DbRow κ μ)) :
    sqlReady rows = (reportOf rows).isSome := by
  unfold sqlReady reportOf
  have hs := scoreAll_isSome rows
  cases h : scoreAll rows with
  | none =>
    rw [h] at hs
    simp only [Option.isSome_none] at hs
    simp [← hs]
  | some ss =>
    rw [h] at hs
    simp only [Option.isSome_some] at hs
    have hn := scoreAll_nil_iff rows ss h
    dsimp only
    rw [groupNew_isEmpty]
    cases rows with
    | nil => simp_all
    | cons r rs =>
      have : ss ≠ [] := fun e => List.cons_ne_nil r rs (hn.mp e)
      cases ss with
      | nil => exact absurd rfl this
      | cons _ _ => simp [← hs]
end

variable {α : Type}

/-- A post-fix sweep never releases a not-yet-releasable row. -/
theorem sweep_keeps_withheld (ready : α → Bool) (k : Nat) (q : List α) :
    (sweep ready k q).filter (fun x => !ready x) = q.filter (fun x => !ready x) := by
  unfold sweep
  rw [List.filter_append, List.filter_filter]
  have h2 : ((q.filter ready).drop k).filter (fun x => !ready x) = [] :=
    List.filter_eq_nil_iff.mpr fun a ha => by
      have := (List.mem_filter.mp (List.mem_of_mem_drop ha)).2
      simp [this]
  simp only [Bool.and_self, h2, List.append_nil]

/-- One post-fix sweep removes the `k` oldest releasable rows. -/
theorem sweep_ready (ready : α → Bool) (k : Nat) (q : List α) :
    (sweep ready k q).filter ready = (q.filter ready).drop k := by
  unfold sweep
  rw [List.filter_append]
  have h1 : (q.filter fun x => !ready x).filter ready = [] :=
    List.filter_eq_nil_iff.mpr fun a ha => by
      have := (List.mem_filter.mp ha).2
      simpa using this
  have h2 : ((q.filter ready).drop k).filter ready = (q.filter ready).drop k :=
    List.filter_eq_self.mpr fun a ha => (List.mem_filter.mp (List.mem_of_mem_drop ha)).2
  rw [h1, h2, List.nil_append]

theorem runs_ready (ready : α → Bool) (k n : Nat) (q : List α) :
    (runs (sweep ready k) n q).filter ready = (q.filter ready).drop (n * k) := by
  induction n generalizing q with
  | zero => simp [runs]
  | succ n ih =>
    simp only [runs]
    rw [ih, sweep_ready, List.drop_drop, Nat.succ_mul, Nat.add_comm]

/-- LIVE-1 under A-FAIR (post-fix): with batch `k ≥ 1`, every releasable row
    is released within ⌈r/k⌉ sweeps, however many withheld rows precede it. -/
theorem every_ready_released (ready : α → Bool) (k n : Nat) (q : List α)
    (hn : (q.filter ready).length ≤ n * k) :
    (runs (sweep ready k) n q).filter ready = [] := by
  rw [runs_ready]
  exact List.drop_of_length_le hn

/-- BUG (fixed): when the `k` oldest pending rows are all withheld, a pre-fix
    sweep changes nothing, so every later sweep sees the same batch. -/
theorem old_sweep_stuck (ready : α → Bool) (k : Nat) (q : List α)
    (h : ∀ x ∈ q.take k, ready x = false) : sweepOld ready k q = q := by
  unfold sweepOld
  rw [List.filter_eq_self.mpr (fun a ha => by simp [h a ha]), List.take_append_drop]

theorem old_runs_stuck (ready : α → Bool) (k n : Nat) (q : List α)
    (h : ∀ x ∈ q.take k, ready x = false) : runs (sweepOld ready k) n q = q := by
  induction n with
  | zero => rfl
  | succ n ih => simp only [runs]; rw [old_sweep_stuck ready k q h, ih]

end RepairQueue
