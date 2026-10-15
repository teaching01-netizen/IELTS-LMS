import Model
import Continuity

/-!
# The pre-fix cookie policy breaks every sitting longer than idle + TTL

These theorems are the anti-vacuity half of the proof: the same model, with
the old cookie policy, provably locks out a perfectly active student. They
explain the production incident (entry 10:15:10, last accepted save 11:20:27,
module close failing at 11:26).
-/
namespace SatSessionContinuity

theorem idleBound_middleware_fields (c : Config) (s : State) :
    (middleware c .idleBound s).cookieExp = s.cookieExp ∧
      (middleware c .idleBound s).tokenExp = s.tokenExp ∧
      (middleware c .idleBound s).now = s.now := by
  unfold middleware
  by_cases h : authed s
  · rw [if_pos h]
    show (touchIdle c s).cookieExp = _ ∧ (touchIdle c s).tokenExp = _ ∧ (touchIdle c s).now = _
    unfold touchIdle
    by_cases h2 : s.lastTouch + c.touch ≤ s.now
    · rw [if_pos h2]; exact ⟨rfl, rfl, rfl⟩
    · rw [if_neg h2]; exact ⟨rfl, rfl, rfl⟩
  · rw [if_neg h]; exact ⟨rfl, rfl, rfl⟩

theorem refreshIfDue_keeps_cookie (c : Config) (s : State) :
    (refreshIfDue c s).cookieExp = s.cookieExp ∧ (refreshIfDue c s).now = s.now := by
  unfold refreshIfDue
  split <;> exact ⟨rfl, rfl⟩

theorem idleBound_request_keeps_cookie (c : Config) (s : State) (t : Nat) :
    (request c .idleBound s t).cookieExp = s.cookieExp := by
  unfold request
  rw [(refreshIfDue_keeps_cookie c _).1, (idleBound_middleware_fields c _).1]
  rfl

/-- Pre-fix, the cookie expiry is fixed at entry, whatever the student does. -/
theorem idleBound_cookie_frozen (c : Config) (t0 : Nat) :
    ∀ (ts : List Nat) (s : State), s.cookieExp = t0 + min c.absolute c.idle →
      (run c .idleBound s ts).cookieExp = t0 + min c.absolute c.idle := by
  intro ts
  induction ts with
  | nil => intro s h; exact h
  | cons t ts ih =>
    intro s h
    exact ih _ (by rw [idleBound_request_keeps_cookie]; exact h)

/-- **Counterexample 1.** Pre-fix: no matter how active the student is, every
request from `entry + idle` on is unauthenticated (the browser dropped the
cookie), so the bearer cannot be refreshed. -/
theorem idleBound_logs_out_active_student (c : Config) (t0 t : Nat) (ts : List Nat)
    (ht : t0 + c.idle ≤ t) :
    ¬ authed (advance (run c .idleBound (enter c .idleBound t0) ts) t) := by
  intro h
  have hc := idleBound_cookie_frozen c t0 ts (enter c .idleBound t0) rfl
  have hp : t < (run c .idleBound (enter c .idleBound t0) ts).cookieExp := h.1
  rw [hc] at hp
  have := Nat.min_le_right c.absolute c.idle
  omega

/-- Bearer bound under the old policy: a refresh needs the cookie, so the
bearer never outlives `cookieExp + ttl`. -/
theorem idleBound_token_bounded (c : Config) :
    ∀ (ts : List Nat) (s : State), s.tokenExp ≤ s.cookieExp + c.ttl →
      (run c .idleBound s ts).tokenExp ≤ (run c .idleBound s ts).cookieExp + c.ttl := by
  intro ts
  induction ts with
  | nil => intro s h; exact h
  | cons t ts ih =>
    intro s h
    apply ih
    rw [idleBound_request_keeps_cookie]
    obtain ⟨hmc, hmt, _⟩ := idleBound_middleware_fields c (advance s t)
    have hac : (advance s t).cookieExp = s.cookieExp := rfl
    have hat : (advance s t).tokenExp = s.tokenExp := rfl
    unfold request
    generalize middleware c .idleBound (advance s t) = m at *
    unfold refreshIfDue
    split
    · rename_i hr
      have hcp : m.now < m.cookieExp := hr.2.1
      show m.now + c.ttl ≤ s.cookieExp + c.ttl
      omega
    · show m.tokenExp ≤ s.cookieExp + c.ttl
      omega

/-- **Counterexample 2 (answer-loss mechanism).** Pre-fix: every delivery
call (save, state, module close) made at or after
`entry + min(absolute, idle) + ttl` is rejected, for every activity pattern.
With production values that is 75 minutes after entry — inside an SAT
sitting. -/
theorem idleBound_rejects_saves (c : Config) (t0 t : Nat) (ts : List Nat)
    (ht : t0 + min c.absolute c.idle + c.ttl ≤ t) :
    ¬ accepted (request c .idleBound (run c .idleBound (enter c .idleBound t0) ts) t) := by
  have hc := idleBound_cookie_frozen c t0 ts (enter c .idleBound t0) rfl
  have hb := idleBound_token_bounded c ts (enter c .idleBound t0)
    (by simp [enter, cookieIssue])
  generalize run c .idleBound (enter c .idleBound t0) ts = s at *
  have hNotAuth : ¬ authed (advance s t) := by
    intro h; have : t < s.cookieExp := h.1; omega
  have hm : middleware c .idleBound (advance s t) = advance s t := by
    unfold middleware; rw [if_neg hNotAuth]
  unfold request
  rw [hm, refreshIfDue, if_neg (fun h => hNotAuth h.2)]
  intro h
  have : t < s.tokenExp := h
  omega

/-- A student who talks to the server every 5 minutes for 3 hours (the
production SAT length scale). -/
def everyFiveMinutes (n : Nat) : List Nat := (List.range n).map (fun i => 300 * (i + 1))

theorem everyFiveMinutes_active : Active 300 0 (everyFiveMinutes 36) := by decide

/-- **Differential witness, fixed policy.** The same 3-hour active trace is
fully served with the fix (concrete kernel computation, independent of the
general theorem). -/
theorem fixed_policy_serves_three_hours :
    AllServed prodConfig .absoluteRefreshed (enter prodConfig .absoluteRefreshed 0)
      (everyFiveMinutes 36) := by decide

/-- **Differential witness, old policy.** The identical trace is NOT served
pre-fix. -/
theorem old_policy_fails_three_hours :
    ¬ AllServed prodConfig .idleBound (enter prodConfig .idleBound 0)
      (everyFiveMinutes 36) := by decide

/-- The general theorem also covers the trace (cross-check of the two
routes). -/
example : AllServed prodConfig .absoluteRefreshed (enter prodConfig .absoluteRefreshed 0)
    (everyFiveMinutes 36) :=
  prod_active_student_always_served 0 _ everyFiveMinutes_active (by decide)

end SatSessionContinuity
