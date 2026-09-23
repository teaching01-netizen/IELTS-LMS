Below is the implementation plan I’d hand to an engineer/AI coding agent. It is designed around the **existing SAT delivery architecture**, not as a parallel resume system.

## SAT automatic resume — implementation plan

### Context

Current SAT delivery already has the important durability pieces:

* canonical student route: `"/student/:scheduleId/:studentId"`
* student auth through the existing `HttpOnly` session cookie
* server-owned `student_attempts`
* SAT attempt bearer credentials with refresh support
* server-authoritative runtime/timing
* persisted SAT responses and annotations
* reconnect/offline recovery
* server session recovery through the existing student-session endpoint
* existing reload/recovery/multi-device tests
* `k6/prod-resume-100.js` already verifies that a resumed session preserves the same attempt/module/answers

The feature we are adding is therefore **resume discovery + automatic routing**, not another exam-state persistence mechanism.

The intended flow is:

```text
student enters SAT
        ↓
server authenticates + creates/resolves attempt
        ↓
browser stores only a non-secret resume locator
        ↓
student closes tab/browser / disconnects
        ↓
student returns
        ↓
cookie identifies authenticated student
        ↓
resume locator identifies likely schedule
        ↓
server validates cookie + resolves canonical attempt
        ↓
server returns current attempt + runtime + refreshed credential
        ↓
existing SAT controller mounts
        ↓
student continues from authoritative current state
```

Critical invariant:

> Browser storage may locate a session. It must never authorize a session or determine exam state.

Do **not** restore answers, module, question, stage, break timer, remaining time, `attemptToken`, or security state from `localStorage`.

---

## Implementation

1. **Introduce one explicit SAT resume-locator module.** Create something like `src/features/student-delivery/infrastructure/satResumeLocator.ts`. Do not let `StudentEntryRoute`, Student Link entry, SAT controller, and other components independently read/write arbitrary localStorage keys. Define a versioned object similar to:

   ```ts
   interface SatResumeLocatorV1 {
     version: 1;
     providerKey: "sat";
     scheduleId: string;
     candidateId: string;
     attemptId?: string;
     accessLinkId?: string;
     updatedAt: string;
   }
   ```

   The API should be small: `loadSatResumeLocator()`, `saveSatResumeLocator(locator)`, `clearSatResumeLocator()`, and optionally `matchesSatResumeLocator(...)`. All operations must be wrapped in `try/catch`; storage denial must never stop the exam. Use `localStorage`, not `sessionStorage`, because the feature explicitly needs to survive tab/browser closure. Store no PII beyond the already-visible candidate identifier if avoidable, and no bearer/session tokens. Add a schema/version guard so malformed, old, or manually edited values are ignored instead of throwing. Keep a reasonable stale-record policy, but do not use the timestamp as authorization.

2. **Record the locator after successful SAT admission.** Update both `src/features/student/routes/StudentEntryRoute.tsx` and `src/features/student/routes/StudentAccessLinkEntryRoute.tsx`. After `studentEntry()` returns success, save `{scheduleId, candidateId/studentCode, attemptId, providerKey:"sat"}` before navigating. For Student Link entry, include `accessLinkId`. Do not save it for queued/failed admission. After `StudentSessionRoute` receives the canonical `attemptSnapshot`, write the locator again from the server-returned identity. That second write is important because the server is canonical and may normalize identity differently from the form input.

3. **Replace local-cache-based resume authorization in `StudentEntryRoute`.** There is already automatic entry logic around `studentAttemptRepository.getAttemptsByScheduleId(scheduleId)`. Do not use the IndexedDB/local attempt cache as proof that an exam may be reopened. Refactor this into a `resolveStudentResume()` application function or hook. Its responsibility should be only:

   ```text
   storage says: maybe SAT schedule X
                    ↓
   auth cookie says: currently authenticated student
                    ↓
   server says: yes/no + canonical attempt
   ```

   Keep the local attempt cache for offline durability/reconciliation, but not admission.

4. **Use the existing server session recovery path.** The backend already has the behavior we want. `studentSessionContext()` in `backend/go/cmd/api/student_context.go` can resolve an attempt from `scheduleID + authenticated user_id` when candidate ID is omitted. The existing resume/load path can also issue a fresh attempt credential. Prefer extending the existing API client rather than creating a SAT-only backend command. Add an application-level function such as:

   ```ts
   resumeStudentSession({
     scheduleId,
     clientSessionId,
   })
   ```

   Conceptually it should call the existing session endpoint with credential refresh enabled:

   ```text
   GET /v1/student/sessions/:scheduleId
       ?refreshAttemptCredential=true
       &clientSessionId=<current-writer-id>
   ```

   Parse the canonical `attempt`, `runtime`, and `attemptCredential`. Store the refreshed attempt credential using the existing `storeAttemptCredential()` path. Do not implement custom token persistence inside the resume feature.

5. **Preserve writer/session identity rules.** SAT already deliberately unifies heartbeat, saves, takeover, and credential refresh around one `clientSessionId`. Automatic resume must use the same infrastructure, particularly `ensureClientSessionIdForStudentKey(...)`, instead of introducing `sat-resume-session:*` or another second writer identity. On a reload in the same logical browser, reuse the existing writer identity where appropriate. On a truly fresh browser lifecycle, allow the existing session infrastructure to create a new ID and let lease/takeover rules decide whether it may write.

6. **Add an automatic resume state machine to the entry screen.** `StudentEntryRoute` should not immediately paint the check-in form if it has enough evidence to try resume. A simple state model is enough:

   ```ts
   type ResumeState =
     | { kind: "idle" }
     | { kind: "checking" }
     | { kind: "resumable"; route: string }
     | { kind: "offline" }
     | { kind: "not-resumable" };
   ```

   Do not mix this into the main SAT runner reducer. It belongs to entry/discovery. Resolve authentication first. If there is an appropriate SAT resume locator, probe the server exactly once. On success, `navigate(canonicalRoute, { replace: true })`. During this short window use the SAT loading surface, not the generic IELTS/admin skeleton and not the registration form.

7. **Make the UX invisible during the happy path.** The normal experience should be:

   ```text
   reopen
   → “Reconnecting to your SAT…”
   → exam
   ```

   There should be no “Do you want to resume?” confirmation for the same authenticated student and active attempt. Automatic resume is both safer and lower cognitive load because the server already determines whether the attempt is valid. A manual action should appear only when automatic recovery fails and human intervention is useful.

8. **Treat network failure differently from authentication failure.** Define the error contract explicitly. `401/403`, revoked session, wrong student, missing registration, or an invalid attempt means auto-resume cannot proceed. Clear the stale locator only when the server has positively proven it is invalid. A timeout, offline browser, `5xx`, `429`, or transient transport failure must **not** destroy the locator or log the student out. Preserve the current session and show reconnecting/retry state. When `window.online` fires, perform another bounded resume attempt. Never create a tight poll loop.

9. **Keep terminal state authoritative.** If the attempt/session is already completed, submitted, terminated, cancelled, or otherwise terminal, do not redirect to an old module because local storage says the student was there. Let `StudentSessionRoute`/SAT delivery render the existing complete or terminated state. Clear the resume locator once the application has positively observed a terminal state. This should also happen after explicit student exit/logout.

10. **Do not restore SAT stage from browser storage.** Once `SatStudentSessionRoute` mounts, reuse the existing `useSatExamController` and bootstrap pipeline unchanged as much as possible. Current module, selected adaptive branch, break, review, completion, proctor status, deadline, and timer must come from the current server snapshot. For example, if the student closes the app in Reading & Writing Module 1 but the cohort moves while they are gone, reopening must show whatever the server now considers valid. Never navigate to a stored `moduleId`.

11. **Make student authentication survive a full browser/app close.** The current cookie created in `backend/go/cmd/api/handlers_auth.go` is `HttpOnly` but does not currently have a persistent `Expires`/`MaxAge`. A normal page reload is fine, but full browser/app termination is not a reliable persistence guarantee for a session cookie. Adjust student-session issuance so the student cookie persists no longer than the server-side session boundary. Use:

```text
expires = min(session.expiresAt, session.idleTimeoutAt)
```

Keep `HttpOnly`, `Secure`, `SameSite`, and `Path=/`. Give the corresponding CSRF cookie the same expiry. Prefer scoping this behavior to role=`student` rather than silently changing staff authentication semantics. The DB/session lookup remains authoritative even if the browser presents an old cookie.

12. **Keep logout and identity switching destructive.** Explicit logout, “Back to check-in” when intentionally switching students, session revocation, or an operator-directed termination must remove the SAT resume locator. Do not clear it merely because the network disappeared. Separate “leave exam temporarily” from “forget this student” semantics in code.

13. **Handle Student Links carefully.** If a student comes back through `/join/:accessLinkId`, check the locator before making them complete the identity form again. Only use a locator that is compatible with that link/session. The link itself still needs its normal server validity check. An old locator must not permit entry through an expired/revoked link in a way that violates the current access policy. After entry has already been established, however, the authenticated schedule/attempt should be the primary recovery identity.

14. **Do not automatically implement global `/` discovery in this change.** The first version should support reopening the known Student Link or schedule URL, because that requires no new server discovery model. If later you want a student to type only the website root and automatically return to an exam even when localStorage is gone, introduce a separate authenticated endpoint such as `GET /v1/student/resume`, resolving the newest non-terminal attempt for `sess.UserID`. Do not overload `/v1/auth/session` with exam-specific state.

15. **Add focused unit tests before E2E.** For `satResumeLocator`, cover successful write/read, corrupted JSON, wrong version, wrong provider, missing required fields, storage read throwing, storage write throwing, clearing, and a tampered attempt ID. For the entry application logic, cover authenticated+active → resume, authenticated+terminal → no active exam, anonymous+locator → no resume, `401` → fall back to check-in, offline/5xx → retain locator, stale candidate locator with valid user session → server identity wins, and React StrictMode double effects → one logical resume request. For `StudentAccessLinkEntryRoute`, test same-link resume and stale/different-link behavior.

16. **Add backend tests for persistent student cookies.** In Go tests around `handlers_auth.go`, assert student entry sets a cookie with `HttpOnly`, expected `Secure`, expected `SameSite`, `Path=/`, and an expiry bounded by session expiry/idle timeout. Assert logout emits an expired matching cookie. Also test that expired/revoked DB sessions remain `401` even if the browser still carries the persistent cookie. The persistent cookie improves continuity; it must not extend authorization.

17. **Add a dedicated SAT Playwright recovery suite.** Create `e2e/sat-auto-resume.spec.ts`. Reuse `e2e/support/satStudentSession.ts` rather than building a second authoring fixture. The critical test is not `page.reload()`: actually answer a SAT question, wait for persistence, save the remaining-time observation, call `studentPage.close()`, create a **new Page in the same BrowserContext**, navigate only to `/student/${scheduleId}`, perform **zero form interactions**, and verify `sat-exam-shell` appears automatically, the same answer is selected, annotations/eliminations remain where applicable, and remaining time has not increased/reset.

18. **Cover real browser-closure variants in E2E.** At minimum test: current URL reload; tab close + new tab; navigate back to `/student/:scheduleId`; reopen `/join/:accessLinkId`; same browser context with localStorage but no sessionStorage; localStorage cleared but valid cookie and explicit canonical student URL; cookie cleared but localStorage retained; network offline before reopen then online; runtime advances while page is closed; break screen while closed; terminalization while closed; proctor pause while closed; and candidate locator tampered to another student. For the cookie-cleared case, prove that storage alone **never** opens the SAT exam.

19. **Keep existing durability regression suites mandatory.** This feature touches entry/auth/recovery, so CI should run at least `e2e/sat-answer-recovery.spec.ts`, `e2e/student-recovery.spec.ts`, `e2e/student-network.spec.ts`, `e2e/student-multi-device.spec.ts`, SAT timing tests, SAT transition tests, the new auto-resume suite, and `k6/prod-resume-100.js` in the appropriate load/rehearsal pipeline. Particularly protect the invariant that resume keeps the same attempt ID rather than accidentally creating a second attempt.

20. **Add low-cardinality recovery observability.** Emit metrics around the application/backend seam, not every render. Useful examples are `student_resume_probe_total`, `student_resume_success_total`, `student_resume_failure_total{reason}`, and `student_resume_recovery_ms`. Keep reasons bounded, e.g. `unauthenticated`, `no_active_attempt`, `terminal`, `network`, `server_error`, `storage_missing`. Include schedule/attempt identifiers only where your existing telemetry conventions allow them; do not use candidate/email as uncontrolled labels.

### Acceptance contract

The implementation is complete only when these invariants hold simultaneously:

```text
refresh current page
→ same attempt automatically resumes

close tab, open new tab
→ same active SAT automatically resumes

force-close browser/app, reopen while student cookie is valid
→ same active SAT automatically resumes

sessionStorage deleted
→ no impact

localStorage missing but canonical exam URL + valid cookie available
→ server can still recover the attempt

localStorage exists but auth cookie is gone
→ exam DOES NOT open

localStorage candidate/attempt is tampered
→ server identity wins / request is denied

browser goes offline
→ student work remains recoverable

browser comes online
→ existing durability pipeline flushes and server state reconciles

student returns after cohort has moved
→ server's current stage is rendered

student returns after exam completion
→ completion/terminal screen, never stale question UI

resume
→ timer continues from authoritative server deadline
→ timer is never restarted

resume
→ attempt ID remains unchanged

resume
→ no duplicate student attempt is created

resume from conflicting second writer/device
→ existing lease/device policy still applies
```

### Suggested file ownership

The main changes should stay concentrated around `StudentEntryRoute.tsx`, `StudentAccessLinkEntryRoute.tsx`, a new SAT resume-locator/application helper, the existing student-session API/gateway, `StudentSessionRoute.tsx`, and student cookie issuance in `handlers_auth.go`.

Avoid modifying `satRunnerReducer`, SAT scoring, module-routing logic, response persistence rules, or server timing unless a failing test demonstrates a genuine integration gap. Those systems already know how to reconstruct the exam; this feature should primarily make sure the student gets back to them automatically.

The main engineering rule for this work is:

> **Remember where to look locally; decide what to resume on the server.**

That preserves your existing server-authoritative SAT architecture while giving students the seamless “close → come back → continue automatically” behavior you want.
