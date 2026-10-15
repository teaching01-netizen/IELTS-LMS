import Model

/-!
# Fixed policy: an active student is never logged out mid-sitting

Main theorem `active_student_always_served`: under `absoluteRefreshed`, if the
student makes a request at least every `gap` seconds, every request before the
absolute deadline is authenticated and every delivery call is accepted.
-/
namespace SatSessionContinuity

/-- Inductive invariant of the fixed policy for a session with absolute
deadline `A`. -/
structure Inv (c : Config) (A : Nat) (s : State) : Prop where
  notRevoked : s.revoked = false
  absFixed : s.sessAbs = A
  cookieAbs : s.cookieExp = A
  idleSlid : s.sessIdle = s.lastTouch + c.idle
  touchFresh : s.now ≤ s.lastTouch + c.touch

theorem inv_enter (c : Config) (t0 : Nat) :
    Inv c (t0 + c.absolute) (enter c .absoluteRefreshed t0) := by
  refine ⟨rfl, rfl, rfl, rfl, ?_⟩; simp [enter]

/-- Facts about the state right after the fixed-policy middleware, for an
authenticated arrival. -/
theorem middleware_fields (c : Config) (A t : Nat) (s : State)
    (hAuth : authed (advance s t)) (hRev : s.revoked = false) (hA : s.sessAbs = A)
    (hI : s.sessIdle = s.lastTouch + c.idle) (hIdle : t < s.sessIdle) :
    let m := middleware c .absoluteRefreshed (advance s t)
    m.now = t ∧ m.revoked = false ∧ m.sessAbs = A ∧ m.cookieExp = A ∧
      m.tokenExp = s.tokenExp ∧ m.sessIdle = m.lastTouch + c.idle ∧
      t ≤ m.lastTouch + c.touch ∧ t < m.sessIdle := by
  intro m
  have hm : m = { touchIdle c (advance s t) with
      cookieExp := (touchIdle c (advance s t)).sessAbs } := by
    show middleware c .absoluteRefreshed (advance s t) = _
    rw [middleware, if_pos hAuth]
  rw [hm]
  by_cases hDue : s.lastTouch + c.touch ≤ t
  · have hT : touchIdle c (advance s t) =
        { advance s t with sessIdle := t + c.idle, lastTouch := t } := by
      rw [touchIdle, if_pos (by simpa [advance] using hDue)]; rfl
    rw [hT]
    exact ⟨rfl, hRev, hA, hA, rfl, rfl, by dsimp only [advance]; omega,
      by dsimp only [advance]; omega⟩
  · have hT : touchIdle c (advance s t) = advance s t := by
      rw [touchIdle, if_neg (by simpa [advance] using hDue)]
    rw [hT]
    exact ⟨rfl, hRev, hA, hA, rfl, hI, by dsimp only [advance]; omega, hIdle⟩

/-- One request preserves the invariant, is authenticated on arrival and its
delivery call is accepted. -/
theorem step_served (c : Config) (A gap t : Nat) (s : State)
    (hTouch : c.touch + gap < c.idle) (hTtl : 0 < c.ttl)
    (hInv : Inv c A s) (_hLo : s.now ≤ t) (hHi : t ≤ s.now + gap) (hAbs : t < A) :
    authed (advance s t) ∧ accepted (request c .absoluteRefreshed s t) ∧
      Inv c A (request c .absoluteRefreshed s t) ∧
      (request c .absoluteRefreshed s t).now = t := by
  obtain ⟨hRev, hA, hC, hI, hT⟩ := hInv
  have hIdle : t < s.sessIdle := by omega
  have hAuth : authed (advance s t) :=
    ⟨show t < s.cookieExp by omega, hRev, show t < s.sessAbs by omega, hIdle⟩
  obtain ⟨mNow, mRev, mAbs, mCookie, mTok, mIdle, mTouch, mLive⟩ :=
    middleware_fields c A t s hAuth hRev hA hI hIdle
  have hReq : request c .absoluteRefreshed s t =
      refreshIfDue c (middleware c .absoluteRefreshed (advance s t)) := rfl
  rw [hReq]
  generalize middleware c .absoluteRefreshed (advance s t) = m at *
  have hAuthM : authed m :=
    ⟨show m.now < m.cookieExp by omega, mRev, show m.now < m.sessAbs by omega,
      show m.now < m.sessIdle by omega⟩
  by_cases hDue : m.tokenExp ≤ m.now + c.refresh
  · rw [refreshIfDue, if_pos ⟨hDue, hAuthM⟩]
    refine ⟨hAuth, ?_, ⟨mRev, mAbs, mCookie, mIdle, ?_⟩, mNow⟩
    · show m.now < m.now + c.ttl; omega
    · show m.now ≤ m.lastTouch + c.touch; omega
  · rw [refreshIfDue, if_neg (fun h => hDue h.1)]
    refine ⟨hAuth, ?_, ⟨mRev, mAbs, mCookie, mIdle, ?_⟩, mNow⟩
    · show m.now < m.tokenExp; simp only [] at hDue; omega
    · show m.now ≤ m.lastTouch + c.touch; omega

theorem served_from_inv (c : Config) (A gap : Nat)
    (hTouch : c.touch + gap < c.idle) (hTtl : 0 < c.ttl) :
    ∀ (ts : List Nat) (s : State), Inv c A s → Active gap s.now ts →
      (∀ t ∈ ts, t < A) → AllServed c .absoluteRefreshed s ts := by
  intro ts
  induction ts with
  | nil => intro _ _ _ _; trivial
  | cons t ts ih =>
    intro s hInv hAct hAbs
    obtain ⟨hLo, hHi, hRest⟩ := hAct
    obtain ⟨hAuth, hAcc, hInv', hNow⟩ :=
      step_served c A gap t s hTouch hTtl hInv hLo hHi (hAbs t (by simp))
    refine ⟨hAuth, hAcc, ?_⟩
    apply ih _ hInv'
    · rw [hNow]; exact hRest
    · intro u hu; exact hAbs u (by simp [hu])

/-- **Main theorem.** Fixed cookie policy: a student who enters at `t0` and
then makes a request at least every `gap` seconds is authenticated on every
request, and every save/state/close call is accepted, until the absolute
session deadline — provided only that the idle window exceeds `touch + gap`
and the bearer TTL is positive. (The bearer is renewed at request time through
the cookie session, so its TTL never bounds the allowed gap.) -/
theorem active_student_always_served (c : Config) (t0 gap : Nat) (ts : List Nat)
    (hTouch : c.touch + gap < c.idle) (hTtl : 0 < c.ttl)
    (hAct : Active gap t0 ts) (hAbs : ∀ t ∈ ts, t < t0 + c.absolute) :
    AllServed c .absoluteRefreshed (enter c .absoluteRefreshed t0) ts :=
  served_from_inv c (t0 + c.absolute) gap hTouch hTtl ts _
    (inv_enter c t0) hAct hAbs

/-- Production instance: with the Railway configuration (60 min idle, 12 h
absolute, 5 min touch coalescing, 15 min bearer, 5 min refresh window), a
student whose browser talks to the server at least every 5 minutes is served
for the whole of any sitting shorter than 12 hours. The SAT client talks to the
server far more often than that. -/
theorem prod_active_student_always_served (t0 : Nat) (ts : List Nat)
    (hAct : Active 300 t0 ts) (hAbs : ∀ t ∈ ts, t < t0 + 12 * 3600) :
    AllServed prodConfig .absoluteRefreshed (enter prodConfig .absoluteRefreshed t0) ts :=
  active_student_always_served prodConfig t0 300 ts (by decide) (by decide)
    hAct hAbs

end SatSessionContinuity
