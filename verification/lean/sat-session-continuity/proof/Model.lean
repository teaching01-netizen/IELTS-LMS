/-!
# SAT session continuity model

All durations and instants are whole seconds of server time. Browser
`Max-Age` cookies are relative, so client clock skew is not modelled.

Code anchors (see TRACEABILITY.md):
* `enter`        — `setCreatedSessionCookies` (handlers_auth.go) + session row
                   creation (`SESSION_ABSOLUTE_HOURS`, `SESSION_IDLE_STUDENT_MINS`)
                   + first attempt bearer (`ATTEMPT_TOKEN_TTL_MINUTES`).
* `middleware`   — `authMiddleware` (cmd/api/main.go) + `LookupSessionWithCache`
                   idle slide coalesced by `SESSION_TOUCH_COALESCE_SECS`.
* `refreshIfDue` — `attemptRequest` (assessmentDeliveryApi.ts,
                   `ATTEMPT_REFRESH_WINDOW_MS`) → `refreshAttemptCredential`
                   (attemptCredentialAdapter.ts), which needs the session cookie.
* `accepted`     — delivery routes verify the attempt bearer expiry.
-/
namespace SatSessionContinuity

structure Config where
  /-- server idle window (SESSION_IDLE_STUDENT_MINS · 60) -/
  idle : Nat
  /-- server absolute window (SESSION_ABSOLUTE_HOURS · 3600) -/
  absolute : Nat
  /-- idle-slide coalescing window (0 when the session cache is off) -/
  touch : Nat
  /-- attempt bearer lifetime (ATTEMPT_TOKEN_TTL_MINUTES · 60) -/
  ttl : Nat
  /-- client proactive refresh window (ATTEMPT_REFRESH_WINDOW_MS / 1000) -/
  refresh : Nat
  deriving Repr, DecidableEq

/-- Which cookie policy the server runs. -/
inductive CookiePolicy where
  /-- Pre-fix: cookie Max-Age = min(absolute, idle) at entry; the middleware
  never re-issues it while the student is sitting. -/
  | idleBound
  /-- Fix (bc87947a + 71fab6d6): cookie Max-Age = absolute deadline, re-issued
  by the middleware on every authenticated student request. -/
  | absoluteRefreshed
  deriving Repr, DecidableEq

structure State where
  now : Nat
  /-- server absolute expiry of the session row -/
  sessAbs : Nat
  /-- server idle expiry of the session row -/
  sessIdle : Nat
  /-- last persisted idle slide -/
  lastTouch : Nat
  revoked : Bool
  /-- browser cookie expiry: the cookie is sent iff `now < cookieExp` -/
  cookieExp : Nat
  /-- attempt bearer expiry -/
  tokenExp : Nat
  deriving Repr, DecidableEq

/-- The browser still holds and sends the session cookie. -/
def cookiePresent (s : State) : Prop := s.now < s.cookieExp

/-- The server session row is still valid. -/
def sessionLive (s : State) : Prop :=
  s.revoked = false ∧ s.now < s.sessAbs ∧ s.now < s.sessIdle

/-- A request is authenticated iff the cookie arrives AND the row is valid. -/
def authed (s : State) : Prop := cookiePresent s ∧ sessionLive s

/-- A delivery call (save / state / close) passes the bearer check. -/
def accepted (s : State) : Prop := s.now < s.tokenExp

instance (s : State) : Decidable (cookiePresent s) :=
  inferInstanceAs (Decidable (s.now < s.cookieExp))
instance (s : State) : Decidable (sessionLive s) :=
  inferInstanceAs (Decidable (s.revoked = false ∧ s.now < s.sessAbs ∧ s.now < s.sessIdle))
instance (s : State) : Decidable (authed s) :=
  inferInstanceAs (Decidable (cookiePresent s ∧ sessionLive s))
instance (s : State) : Decidable (accepted s) :=
  inferInstanceAs (Decidable (s.now < s.tokenExp))

def cookieIssue (c : Config) : CookiePolicy → Nat → Nat
  | .idleBound, t0 => t0 + min c.absolute c.idle
  | .absoluteRefreshed, t0 => t0 + c.absolute

/-- Student entry at `t0`: new session row, cookie, first attempt bearer. -/
def enter (c : Config) (p : CookiePolicy) (t0 : Nat) : State where
  now := t0
  sessAbs := t0 + c.absolute
  sessIdle := t0 + c.idle
  lastTouch := t0
  revoked := false
  cookieExp := cookieIssue c p t0
  tokenExp := t0 + c.ttl

def advance (s : State) (t : Nat) : State := { s with now := t }

/-- Idle slide, persisted at most once per `touch` seconds. -/
def touchIdle (c : Config) (s : State) : State :=
  if s.lastTouch + c.touch ≤ s.now then
    { s with sessIdle := s.now + c.idle, lastTouch := s.now }
  else s

/-- `authMiddleware`: authenticate from the cookie, slide idle, and (fixed
policy only) re-issue the cookie with the absolute deadline. -/
def middleware (c : Config) (p : CookiePolicy) (s : State) : State :=
  if authed s then
    match p with
    | .idleBound => touchIdle c s
    | .absoluteRefreshed =>
        let s₁ := touchIdle c s
        { s₁ with cookieExp := s₁.sessAbs }
  else s

/-- `attemptRequest`: refresh the bearer when it expires within the window.
The refresh endpoint is cookie-authenticated, so it succeeds only if
`authed`. -/
def refreshIfDue (c : Config) (s : State) : State :=
  if s.tokenExp ≤ s.now + c.refresh ∧ authed s then
    { s with tokenExp := s.now + c.ttl }
  else s

/-- One student request at time `t`. -/
def request (c : Config) (p : CookiePolicy) (s : State) (t : Nat) : State :=
  refreshIfDue c (middleware c p (advance s t))

def run (c : Config) (p : CookiePolicy) (s : State) (ts : List Nat) : State :=
  ts.foldl (request c p) s

/-- Request instants are non-decreasing and no two consecutive requests are
more than `gap` seconds apart (an active, online student). -/
def Active (gap : Nat) : Nat → List Nat → Prop
  | _, [] => True
  | prev, t :: ts => prev ≤ t ∧ t ≤ prev + gap ∧ Active gap t ts

def decActive (gap : Nat) : (prev : Nat) → (ts : List Nat) → Decidable (Active gap prev ts)
  | _, [] => isTrue trivial
  | prev, t :: ts =>
    have := decActive gap t ts
    inferInstanceAs (Decidable (prev ≤ t ∧ t ≤ prev + gap ∧ Active gap t ts))

instance (gap prev : Nat) (ts : List Nat) : Decidable (Active gap prev ts) :=
  decActive gap prev ts

/-- Every request is authenticated on arrival and its delivery call is
accepted. -/
def AllServed (c : Config) (p : CookiePolicy) : State → List Nat → Prop
  | _, [] => True
  | s, t :: ts =>
      authed (advance s t) ∧ accepted (request c p s t) ∧
        AllServed c p (request c p s t) ts

/-- `AllServed` is decidable for a concrete trace (used by the witnesses). -/
def decAllServed (c : Config) (p : CookiePolicy) :
    (s : State) → (ts : List Nat) → Decidable (AllServed c p s ts)
  | _, [] => isTrue trivial
  | s, t :: ts =>
    have := decAllServed c p (request c p s t) ts
    inferInstanceAs (Decidable (authed (advance s t) ∧ accepted (request c p s t) ∧
      AllServed c p (request c p s t) ts))

instance (c : Config) (p : CookiePolicy) (s : State) (ts : List Nat) :
    Decidable (AllServed c p s ts) := decAllServed c p s ts

/-- Production values (Railway env pasted by the operator). -/
def prodConfig : Config where
  idle := 60 * 60
  absolute := 12 * 3600
  touch := 300
  ttl := 15 * 60
  refresh := 5 * 60

end SatSessionContinuity
