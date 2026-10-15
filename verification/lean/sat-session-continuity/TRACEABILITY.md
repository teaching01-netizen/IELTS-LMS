# Traceability: model ↔ code ↔ tests

| Model element (proof/) | Code | Tests pinning the correspondence |
|---|---|---|
| `Config.idle/absolute/ttl` | `config.go` `SESSION_IDLE_STUDENT_MINS`, `SESSION_ABSOLUTE_HOURS`, `ATTEMPT_TOKEN_TTL_MINUTES` | prod env pasted by operator (60 / 12 / 15) |
| `Config.touch` | `config.go` `SESSION_TOUCH_COALESCE_SECS` (300), active only with `SESSION_CACHE`; `sessionlookup_cache_impl.go` touch slide | — (reviewed) |
| `Config.refresh` | `assessmentDeliveryApi.ts` `ATTEMPT_REFRESH_WINDOW_MS = 5 min` | — (reviewed) |
| `CookiePolicy.idleBound` | pre-fix `setCreatedSessionCookies` (Max-Age = min(abs, idle)); no middleware re-issue | pre-fix behaviour reproduced in local E2E with `SESSION_IDLE_STUDENT_MINS=1` (401 storm); not re-run as a unit test against pre-fix code |
| `CookiePolicy.absoluteRefreshed`, `enter` | `handlers_auth.go` `setCreatedSessionCookies(w, app, role, sessionToken, csrfToken, expiresAt, now)` | `TestStudentSessionCookiesOutliveTheIdleWindow` |
| `middleware` | `cmd/api/main.go` `authMiddleware` re-issues student cookie to the absolute deadline | `TestAuthMiddlewareRefreshesLiveStudentCookieToAbsoluteDeadline` (student re-issued, admin not) |
| `authed` = cookie ∧ session row live | `LookupSessionWithCache` (revoked / absolute / idle checks) | existing auth package tests |
| `refreshIfDue` | `attemptRequest` → `refreshCredentialSingleflight` → `refreshAttemptCredential` (cookie-authenticated GET, then bootstrap POST) | `assessmentDeliveryApi.test.ts` "singleflights proactive refresh across concurrent near-expiry requests" |
| `accepted` | delivery routes verify the attempt bearer (`ATTEMPT_TOKEN_EXPIRED/INVALID`) | — (reviewed) |
| `Retention.Step.create` | `DurableResponseEngine.acceptResponse` (checkpoint + IndexedDB before resolve) | "reports durability_fault and never a false saved state…" |
| `Step.sendAck` / `sendAckLost` / `recoverAcked` | `drainOutbox` ACK handling; recovery `serverAlreadyHasThisWrite → clearRecoveredWrite` | "guarantee 7 & 8", "keeps a command pending when the server response omits its acknowledgement" |
| `Step.sendTransient` | `drainOutbox` non-terminal branch (bounded retry + `scheduleRetry`, status `saved_locally`) | **new** "keeps answers through 401 auth failures and delivers the same write once the credential recovers" (mutation-checked) |
| `Step.sendClosed` | `isTerminalConflict` + `closeScope` / `quarantineAllPending` → `quarantineEntry` (archive-before-delete) | "quarantines ASSESSMENT_CONFLICT/TIMEOUT_RECOVERY_CLOSED as terminal (answer kept, never dropped)" |
| `Step.close`, `snapshot` | `delivery/close_module.go` `CloseModule`; writes refused after close | `TestResponseWriteSectionLiveness` |
| `Step.uploadLate`, `evidence` | `useSatResponsePersistence.ts` late evidence upload → `assessment_late_answer_evidence` | existing late-evidence tests (reviewed) |
| `Step.reload` | localStorage checkpoint + IndexedDB recovery | "recovers local drafts and overlays onto server snapshot" |

Source hashes: `evidence/source-snapshot.json` (base commit `71fab6d6`).
