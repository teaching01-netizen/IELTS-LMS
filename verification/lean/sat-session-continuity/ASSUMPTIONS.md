# Assumptions

Each item is either a theorem hypothesis (H) or a modelling assumption (M). Modelling assumptions are checked by code review and tests, not by Lean.

| ID | Kind | Assumption | Why it holds / evidence | If false |
|---|---|---|---|---|
| H1 | H | `touch + gap < idle` | Prod: idle 3600 s; touch coalescing 300 s applies only when `SESSION_CACHE=true` (not set in the pasted prod env → default false → every request slides idle). Even with it on, 300 + 300 < 3600. Measured SAT client traffic ≈ 27 requests/min per student. | Server idle expiry could lapse between requests. |
| H2 | H | `0 < ttl` | `ATTEMPT_TOKEN_TTL_MINUTES=15`. | — |
| H3 | H | Every request happens before `entry + absolute` (12 h). | SAT sitting ≈ 2–3 h after entry. | Session expires by design; student must re-enter. |
| H4 | H | Requests are at most `gap` apart (`Active`). | Client state poll + saves + heartbeats while the exam page is open and online. | iPad asleep or offline longer than `idle − touch`: covered by re-entry on the same browser (works) and late evidence (G3). |
| M1 | M | Browser keeps a cookie until its `Max-Age` and sends it on same-origin requests. Server-set `HttpOnly` cookies are not capped by Safari ITP. | `__Host-session`, same origin, `Max-Age` (relative, so client clock skew is irrelevant). | Cookie dropped early: G1 fails. |
| M2 | M | Every delivery call passes through `authMiddleware` with the cookie, so the cookie is refreshed even when the call is bearer-authorised. | Router applies middleware globally; prod logs show `actor: student` on delivery routes. | Cookie refresh only on some routes; G1 then needs those routes in the gap. |
| M3 | M | Bearer refresh needs only the cookie session (`GET …?refreshAttemptCredential=true`, falls back to `POST …/bootstrap`). | `attemptCredentialAdapter.ts` `refreshAttemptCredential`. | — |
| M4 | M | The client refreshes the bearer before a call when it expires within the window. | `attemptRequest` → `isAttemptCredentialExpiringWithin(…, ATTEMPT_REFRESH_WINDOW_MS)`; test "singleflights proactive refresh". | Proof needs gap ≤ refresh window instead. |
| M5 | M | No revocation of the student's session during the sitting. | Not modelled. | Student must re-enter (same browser works). |
| M6 | M | Device storage survives reload/crash/iPad sleep (localStorage checkpoint + IndexedDB). Clearing site data is not an action. | `wipe_breaks_retention` shows this is the exact boundary. | Unsent answers on that device are lost. |
| M7 | M | Quarantine is archive-before-delete: the evidence copy is durable before the draft is removed; an archive failure keeps the draft and raises `durability_fault`. | `DurableResponseEngine.quarantineEntry` (I5 archive-before-delete). | — |
| M8 | M | 401 / 5xx / timeout / offline send failures are non-terminal (retry with backoff, answers kept). | `isTerminalConflict` excludes auth codes; new regression test + mutation check. | Answers quarantined/stopped on auth errors. |
| M9 | M | The server accepts writes only while the module is open, and the close snapshot is taken from committed rows. | `TestResponseWriteSectionLiveness`; `close_module.go`. | G4 fails. |
| M10 | M | Single API instance clock; idle/absolute are compared in server time. | Railway single service. | Multi-instance clock skew of seconds; negligible against 55 min margin. |
