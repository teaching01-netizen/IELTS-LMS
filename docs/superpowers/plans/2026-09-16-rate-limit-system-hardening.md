# Rate-Limit System Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ("- [ ]") syntax for tracking.

**Goal:** Make the IELTS proctoring rate-limit system authoritative, identity-correct, failure-safe, observable, documented, and verified under single-instance and distributed exam-day traffic.

**Architecture:** Keep the existing per-tier route model and atomic MySQL counter, but separate three responsibilities: a cheap pre-auth IP guard, a dual-mode local flood prefilter, and an exact local emergency limiter. Local mode uses the exact configured quota; dual mode uses the prefilter only while the distributed counter is healthy and switches to the exact emergency limiter on DB errors. Each tier owns its local store, key capacity is independent from token burst, and full stores reject safely instead of deleting active state.

The entry “queue” becomes an honest per-process admission gate with Retry-After only. This plan does not introduce a FIFO ticket service; it removes the unsupported FIFO/position promise and keeps the implementation bounded. A distributed FIFO queue would be a separate product and storage design.

**Tech Stack:** Go, MySQL/TiDB, sqlmock, chi, Prometheus-compatible telemetry, Bun, TypeScript, React Query, Vitest, Playwright, and k6.

---

## Definition of done

The implementation is complete only when all of these are true:

1. The global IP guard runs before session lookup, so a rejected cookie-bearing request does not touch the session database.
2. Local mode enforces the configured per-minute budget, not the dual-mode 2x prefilter.
3. A distributed-counter error uses a bounded exact emergency limiter and never silently falls through to an inflated prefilter.
4. Token-bucket refill rate is based on MaxRequests; Burst changes capacity only.
5. Store key capacity is independent from burst size, each tier has its own store, and full stores never evict active buckets arbitrarily.
6. A bucket that is full or quota-exhausted cannot be reset by creating another key.
7. Student attempt requests with both cookie and bearer credentials key by the hashed bearer token.
8. Trusted proxy CIDRs are explicit configuration, invalid CIDRs fail startup, and untrusted X-Forwarded-For is ignored.
9. Student entry exposes Retry-After only; the UI does not claim FIFO position or “keep your place.”
10. React Query mutations do not retry 429 responses, and typed Retry-After details survive service boundaries.
11. OpenAPI, frontend parsing, k6 scenarios, telemetry, alerts, and runbooks describe the same 429 contract.
12. Focused tests, all Go tests, TypeScript typecheck, lint, build, browser tests, and controlled staging load tests pass.

## Audit finding to task map

| Audit finding | Implemented by |
|---|---|
| Session lookup precedes rate limiting | Tasks 2 and 3 |
| 2x prefilter becomes authoritative in local/DB-failure modes | Tasks 1 and 2 |
| Arbitrary bucket eviction resets keys | Task 1 |
| Bucket cap is reused as burst and shared across tiers | Tasks 1 and 2 |
| Cookie user wins over bearer attempt identity | Task 4 |
| Grading mutations retry 429 | Task 6 |
| Entry queue has no stable ticket/FIFO semantics | Task 5 |
| Trusted proxy configuration is not wired | Task 4 |
| Missing failure telemetry and OpenAPI headers | Task 7 |
| Incorrect retry-attempt logging and inert legacy config | Tasks 6 and 7 |

## File map

### Create

- backend/go/internal/platform/httpx/ratelimit_hardening_test.go — deterministic bucket, capacity, local-mode, and emergency-mode tests.
- backend/go/cmd/api/preauth_ratelimit_test.go — router-order regression proving rejected cookie traffic does not query sessions.
- backend/go/cmd/api/trusted_proxy_test.go — configured and untrusted X-Forwarded-For cases.
- src/shared/api/__tests__/mutation.retry.test.ts — React Query mutation 429 retry regression.
- docs/rate-limit-contract.md — operator and client contract for quotas, failure posture, identity, headers, and entry admission.

### Modify

- backend/go/internal/platform/httpx/middleware.go — token refill semantics, bounded key store, capacity result, and injected clock used by tests.
- backend/go/internal/platform/httpx/ratelimit_tiers.go — per-tier stores, exact local/emergency limiter, and bearer-first attempt keying.
- backend/go/internal/platform/httpx/ratelimit_tiers_test.go — tier policy tests.
- backend/go/internal/platform/httpx/ratelimit_localonly_test.go — exact local-mode expectations.
- backend/go/internal/platform/httpx/ratelimit_fallback.go and ratelimit_fallback_test.go — explicit distributed error classification and coverage.
- backend/go/internal/platform/config/config.go and config tests — max-key, burst, proxy, and validation configuration.
- backend/go/cmd/api/main.go and middleware-order tests — pre-auth guard placement and trusted-proxy composition.
- backend/go/cmd/api/entry_gate.go, handlers_v2.go, and entry-gate tests — bounded honest admission gate.
- backend/go/internal/platform/telemetry/telemetry.go — limiter error and capacity metrics.
- backend/monitoring/prometheus-alert-rules.yml — alerts for DB fallback and local capacity rejection.
- backend/.env.example and .env.example — canonical names and migration notes.
- src/shared/api/apiClient.ts — canonical 429 details and actual attempt logging.
- src/shared/api/queryClient.ts — mutation retry policy.
- src/shared/api/__tests__/queryClient.retry.test.ts and entryQueueHeaders.test.ts — client contract tests.
- src/services/gradingService.ts, src/features/grading/api/gradingQueries.ts, and grading tests — preserve typed rate-limit errors.
- src/services/entryQueueRetry.ts, src/features/student/routes/StudentEntryRoute.tsx, and route tests — Retry-After-only admission UX.
- src/features/student-delivery/api/assessmentDeliveryApi.ts and attempt-key tests — cookie-plus-bearer identity coverage.
- api/openapi/openapi.yaml — reusable rate-limited response and headers.
- k6/prod-exam-day.js, k6/scale-proof/0_entry_wave.js, and related scale-proof scripts — remove queue-position assumptions.

## Task 1: Make the local bucket mathematically correct and bounded

**Files:**

- Modify backend/go/internal/platform/httpx/middleware.go.
- Create backend/go/internal/platform/httpx/ratelimit_hardening_test.go.
- Modify backend/go/internal/platform/httpx/ratelimit_fallback_test.go if shared result fields require updates.

- [ ] **Step 1: Write failing token-bucket tests**

Add tests in package httpx so they can exercise TokenBucket.allow with deterministic timestamps:

~~~go
func TestTokenBucketRefillUsesMaxRequestsNotCapacity(t *testing.T) {
    b := &TokenBucket{
        max:    10,
        window: time.Second,
        burst:  10,
    }
    start := time.Unix(100, 0)
    for i := 0; i < 20; i++ {
        if !b.allow(start).Allowed {
            t.Fatalf("initial capacity token %d must be allowed", i)
        }
    }

    allowed := 0
    for i := 0; i < 6; i++ {
        if b.allow(start.Add(500 * time.Millisecond)).Allowed {
            allowed++
        }
    }
    if allowed != 5 {
        t.Fatalf("500ms at max=10/s must refill 5 tokens, got %d", allowed)
    }
}
~~~

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

~~~bash
cd backend/go
go test ./internal/platform/httpx -run TestTokenBucketRefillUsesMaxRequestsNotCapacity -count=1
~~~

Expected: FAIL because the current implementation refills at (max + burst) / window.

- [ ] **Step 3: Add a capacity-safe store result**

Extend RateLimitResult with a distinct CapacityLimited bool. Preserve Allowed, Remaining, and RetryAfter for ordinary quota denials.

Change TokenBucket.allow so refill is:

~~~go
b.tokens += elapsed.Seconds() * (float64(b.max) / b.window.Seconds())
~~~

Keep initial token capacity as max + burst, but do not let burst increase sustained refill rate.

- [ ] **Step 4: Write the failing active-key preservation test**

The store must not delete an active bucket merely because a new identity arrives:

~~~go
func TestBucketStoreRejectsNewKeyWhenAllEntriesAreActive(t *testing.T) {
    now := time.Unix(200, 0)
    store := newBucketStoreWithClock(1, time.Minute, func() time.Time { return now })
    cfg := RateLimitConfig{MaxRequests: 1, Window: time.Minute}

    if !store.allowAt(cfg, "key-a", now).Allowed {
        t.Fatal("key-a first request must be allowed")
    }
    result := store.allowAt(cfg, "key-b", now)
    if result.Allowed || !result.CapacityLimited {
        t.Fatalf("new key must be rejected without evicting key-a: %+v", result)
    }
    if store.allowAt(cfg, "key-a", now).Allowed {
        t.Fatal("key-a must remain quota-exhausted")
    }
}
~~~

- [ ] **Step 5: Run the capacity test and verify it fails**

Run:

~~~bash
cd backend/go
go test ./internal/platform/httpx -run TestBucketStoreRejectsNewKeyWhenAllEntriesAreActive -count=1
~~~

Expected: FAIL because the current map deletes an arbitrary key and recreates it.

- [ ] **Step 6: Implement bounded idle eviction**

Replace map[string]*TokenBucket with entries that contain:

~~~go
type bucketEntry struct {
    bucket   *TokenBucket
    lastSeen time.Time
}
~~~

Add maxKeys as the store-capacity field, idleAfter set to at least one configured window, a clock function used by allowAt, and newBucketStoreWithClock for deterministic tests.

When the store is full:

1. Evict only the oldest entry whose lastSeen is older than idleAfter.
2. If no entry is idle, return CapacityLimited=true with a one-second Retry-After.
3. Never delete an active bucket to admit a new key.

Keep NewBucketStore as the production constructor and have it delegate to newBucketStoreWithClock(cap, time.Minute, time.Now).

- [ ] **Step 7: Route capacity results through the existing 429 envelope**

Update BucketStore.Allow and BucketStore.RateLimit to return a tiered 429 when capacity is exhausted. Add a separate telemetry hook in Task 7; do not log raw bucket keys.

- [ ] **Step 8: Run the focused package tests**

~~~bash
cd backend/go
go test ./internal/platform/httpx -count=1
~~~

Expected: PASS, including the existing fallback and envelope tests.

- [ ] **Step 9: Commit the isolated bucket change**

~~~bash
git add backend/go/internal/platform/httpx/middleware.go backend/go/internal/platform/httpx/ratelimit_hardening_test.go backend/go/internal/platform/httpx/ratelimit_fallback_test.go
git commit -m "fix: make local rate-limit buckets bounded and mathematically correct"
~~~

## Task 2: Separate prefilter, authoritative local, and DB-emergency behavior

**Files:**

- Modify backend/go/internal/platform/httpx/ratelimit_tiers.go.
- Modify backend/go/internal/platform/httpx/ratelimit_tiers_test.go.
- Modify backend/go/internal/platform/httpx/ratelimit_localonly_test.go.
- Modify backend/go/internal/platform/config/config.go.
- Modify backend/go/internal/platform/config/rate_limit_tiers_test.go.
- Modify backend/go/cmd/api/main.go.
- Modify backend/go/cmd/api/ratelimit_mode_test.go.
- Modify backend/.env.example.

- [ ] **Step 1: Define the new configuration contract**

Add these Config fields:

~~~go
RateLimitMaxKeys int
RateLimitBurst   int
~~~

Load them as follows:

- RATE_LIMIT_MAX_KEYS is the canonical local-store key limit.
- RATE_LIMIT_BURST is extra token capacity and defaults to zero.
- RATE_LIMIT_BUCKET_CAP remains a one-release compatibility alias for max keys, emits a deprecation log, and is never used as burst.
- RATE_LIMIT_GLOBAL is removed from the supported runtime contract; the per-tier variables are authoritative.

Reject non-positive max keys, negative burst, non-positive per-minute values, and invalid export limits in ValidateForRuntime.

- [ ] **Step 2: Add failing quota-posture tests**

Replace the current local/dual parity expectation with these explicit cases:

~~~go
func TestTierLocalOnlyUsesConfiguredBudget(t *testing.T) {
    tiers := NewTierSet(
        map[string]TierBudget{TierWrites: {PerMin: 2, Window: time.Minute}},
        nil,
        10,
    )
    tiers.SetLocalOnly(true)
    handler := tiers.Middleware(TierWrites, func(*http.Request) string {
        return "user:u1"
    })(okTierHandler())

    allowed := 0
    for i := 0; i < 5; i++ {
        if rec := doTierRequest(handler, "POST", "/writes"); rec.Code == http.StatusOK {
            allowed++
        }
    }
    if allowed != 2 {
        t.Fatalf("local mode must allow exactly PerMin requests, got %d", allowed)
    }
}
~~~

Add separate tests asserting:

- dual mode allows the 2x prefilter while the DB checker allows;
- local mode uses the exact budget;
- a DB checker error uses the exact emergency budget;
- one tier reaching its key cap does not evict another tier’s active key.

- [ ] **Step 3: Run the new tests and verify the expected failures**

Run:

~~~bash
cd backend/go
go test ./internal/platform/httpx ./internal/platform/config ./cmd/api -run 'TestTierLocalOnlyUsesConfiguredBudget|TestTierSetDBErrorUsesEmergencyBudget|TestTierStoresAreIndependent|TestRateLimitConfigRejectsInvalidValues' -count=1
~~~

Expected: FAIL against the current 2x local behavior, shared store, and absent configuration validation.

- [ ] **Step 4: Give each tier independent local stores**

Replace TierSet.local with a map of tier runtimes:

~~~go
type tierRuntime struct {
    budget    TierBudget
    prefilter *BucketStore
    emergency *BucketStore
    db        DBChecker
}
~~~

Construct both stores for every tier in NewTierSet. Use the configured max-key limit for each store. This prevents backstop traffic from evicting write or polling buckets.

- [ ] **Step 5: Implement the three verdict paths**

For each request:

1. In local mode, check only the exact emergency store.
2. In dual mode, check the 2x prefilter first.
3. If the DB checker allows or denies, use that distributed verdict.
4. If the DB checker returns an error, check the exact emergency store and use its verdict.
5. If a store reports CapacityLimited, return a safe 429 and increment the capacity metric.

Do not use the prefilter as the emergency authority.

- [ ] **Step 6: Update configuration wiring**

Use RateLimitMaxKeys when constructing App.Limiter and TierSet. Pass RateLimitBurst into TierBudgetsFromConfig. Preserve the existing TierBudget.Burst field so per-tier math remains localized.

Update backend/.env.example to show:

~~~dotenv
RATE_LIMIT_MAX_KEYS=120
RATE_LIMIT_BURST=0
RATE_LIMIT_MODE=dual
~~~

Document that local mode is an exact single-process limiter and dual mode is required when multiple API processes serve traffic.

- [ ] **Step 7: Run all rate-limit tests**

~~~bash
cd backend/go
go test ./internal/platform/httpx ./internal/platform/config ./cmd/api -count=1
~~~

Expected: PASS with local exactness, dual prefiltering, DB denial, DB failure, and tier isolation covered.

- [ ] **Step 8: Commit the posture change**

~~~bash
git add backend/go/internal/platform/httpx backend/go/internal/platform/config backend/go/cmd/api/main.go backend/.env.example
git commit -m "fix: separate rate-limit prefilter and authoritative failure paths"
~~~

## Task 3: Move the IP guard before authentication

**Files:**

- Modify backend/go/cmd/api/main.go.
- Create backend/go/cmd/api/preauth_ratelimit_test.go.
- Modify backend/go/cmd/api/middleware_order_test.go.

- [ ] **Step 1: Write the router-order regression**

Add an injected session resolver to App so middleware-order tests can count lookup calls without depending on SQL text. Define the type and field in main.go, set the production resolver in BuildApp to auth.LookupSessionWithCache, and have authMiddleware call app.SessionResolver. Tests may replace it with a deterministic function. Then use a deliberately tiny backstop budget and send a cookie-bearing request twice:

~~~go
type SessionResolver func(context.Context, *sql.DB, *auth.SessionCache, config.Config, string, time.Time) (*auth.Session, error)

type App struct {
    // existing fields...
    SessionResolver SessionResolver
}

// BuildApp composition-root excerpt:
app := &App{
    Config:          cfg,
    DB:              pool,
    SessionResolver: auth.LookupSessionWithCache,
    // existing dependencies...
}
~~~

~~~go
func requestWithSessionCookie(router http.Handler, name, value string) *httptest.ResponseRecorder {
    req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)
    req.AddCookie(&http.Cookie{Name: name, Value: value})
    rec := httptest.NewRecorder()
    router.ServeHTTP(rec, req)
    return rec
}

func TestPreAuthBackstopRejectsBeforeSessionLookup(t *testing.T) {
    cfg := config.Load()
    cfg.RateLimitMode = config.RateLimitModeLocal
    cfg.RateLimitBackstopPerMin = 1
    cfg.RateLimitBurst = 0

    db, _, err := sqlmock.New()
    if err != nil {
        t.Fatal(err)
    }
    defer db.Close()

    lookupCalls := 0
    app := &App{
        Config: cfg,
        DB:     db,
        SessionResolver: func(context.Context, *sql.DB, *auth.SessionCache, config.Config, string, time.Time) (*auth.Session, error) {
            lookupCalls++
            return nil, nil
        },
    }
    router := BuildRouter(app)
    first := requestWithSessionCookie(router, cfg.EffectiveSessionCookieName(), "session-1")
    if first.Code == http.StatusTooManyRequests {
        t.Fatalf("first request must reach authentication before the bucket is exhausted: %d", first.Code)
    }
    if lookupCalls != 1 {
        t.Fatalf("allowed cookie request must reach session resolution once; calls=%d", lookupCalls)
    }

    second := requestWithSessionCookie(router, cfg.EffectiveSessionCookieName(), "session-1")
    if second.Code != http.StatusTooManyRequests {
        t.Fatalf("exhausted pre-auth guard must return 429, got %d", second.Code)
    }
    if lookupCalls != 1 {
        t.Fatalf("rejected request must not resolve a session; calls=%d", lookupCalls)
    }
}
~~~

The first request may resolve anonymously through the injected resolver; the second request must be rejected before the resolver is called again.

- [ ] **Step 2: Run the regression and verify it fails**

~~~bash
cd backend/go
go test ./cmd/api -run TestPreAuthBackstopRejectsBeforeSessionLookup -count=1
~~~

Expected: FAIL because authMiddleware currently runs before the backstop.

- [ ] **Step 3: Move only the global backstop**

In BuildRouter, mount:

~~~go
r.Use(app.Tiers.Middleware(httpx.TierBackstop, httpx.ClientIPKey))
r.Use(authMiddleware(app))
r.Use(csrfMiddleware(app))
~~~

Keep route-specific user, attempt, and IP tiers after authentication so they can use verified identity. Update the middleware-order comment to state:

~~~text
recovery > request-id > trace > security > body-limit > pre-auth IP guard >
auth > CSRF > route rate limit > authorization > handler > access log
~~~

- [ ] **Step 4: Keep the positive authenticated-path assertion**

The first-request assertion in TestPreAuthBackstopRejectsBeforeSessionLookup is required: it proves the pre-auth guard is a front door, not a replacement for session resolution and the later user-keyed route tiers.

- [ ] **Step 5: Run the router tests**

~~~bash
cd backend/go
go test ./cmd/api -run 'TestPreAuth|TestMiddlewareOrder|TestBuildTierSet' -count=1
~~~

Expected: PASS.

- [ ] **Step 6: Commit the boundary fix**

~~~bash
git add backend/go/cmd/api/main.go backend/go/cmd/api/preauth_ratelimit_test.go backend/go/cmd/api/middleware_order_test.go
git commit -m "fix: guard session lookups with pre-auth rate limiting"
~~~

## Task 4: Correct identity precedence and trusted-proxy configuration

**Files:**

- Modify backend/go/internal/platform/httpx/ratelimit_tiers.go.
- Modify backend/go/internal/platform/httpx/ratelimit_tiers_test.go.
- Modify backend/go/internal/platform/httpx/middleware.go.
- Create backend/go/cmd/api/trusted_proxy_test.go.
- Modify backend/go/internal/platform/config/config.go.
- Modify backend/go/cmd/api/main.go.
- Modify backend/go/internal/platform/config/config_test.go.
- Modify src/features/student-delivery/api/assessmentDeliveryApi.test.ts if the shared identity fixture is there.

- [ ] **Step 1: Add the failing cookie-plus-bearer test**

~~~go
func TestAttemptKeyUsesBearerBeforeSessionUser(t *testing.T) {
    req := httptest.NewRequest(http.MethodPost, "/attempt", nil)
    req.Header.Set("Authorization", "Bearer attempt-secret")

    got := AttemptOrUserOrIPKey(func(*http.Request) (string, bool) {
        return "user-1", true
    })(req)

    sum := sha256.Sum256([]byte("attempt-secret"))
    want := "attempt:" + hex.EncodeToString(sum[:])[:16]
    if got != want {
        t.Fatalf("bearer identity must win over cookie user: got %q want %q", got, want)
    }
}
~~~

- [ ] **Step 2: Run the identity test and verify it fails**

~~~bash
cd backend/go
go test ./internal/platform/httpx -run TestAttemptKeyUsesBearerBeforeSessionUser -count=1
~~~

Expected: FAIL because the current implementation checks the session user first.

- [ ] **Step 3: Fix the key precedence**

Order AttemptOrUserOrIPKey as:

1. Valid bearer hash.
2. Verified session user.
3. Trusted client IP.

Keep raw bearer material out of keys, logs, and metrics.

- [ ] **Step 4: Add explicit trusted-proxy configuration**

Add TrustedProxyCIDRs []string to Config, load TRUSTED_PROXIES as a comma-separated list, and make invalid non-empty CIDRs fail ValidateForRuntime.

Change SetTrustedProxies to return an error rather than silently discarding invalid CIDRs. Call it from the startup composition root after config validation and before BuildRouter.

Default behavior must trust loopback only. A deployment must opt into load-balancer CIDRs explicitly.

- [ ] **Step 5: Add proxy behavior tests**

Cover:

- untrusted peer plus forged X-Forwarded-For returns the peer IP;
- configured proxy peer plus valid X-Forwarded-For returns the left-most client IP;
- invalid TRUSTED_PROXIES prevents runtime validation;
- empty configuration does not trust RFC1918 peers.

- [ ] **Step 6: Run backend and frontend identity tests**

~~~bash
cd backend/go
go test ./internal/platform/httpx ./internal/platform/config ./cmd/api -run 'TestAttemptKey|TestTrustedProxy|TestRateLimitConfig' -count=1
cd ../..
bun run test:run -- src/features/student-delivery/api/assessmentDeliveryApi.test.ts
~~~

Expected: PASS.

- [ ] **Step 7: Commit identity and proxy hardening**

~~~bash
git add backend/go/internal/platform/httpx backend/go/internal/platform/config backend/go/cmd/api/main.go backend/go/cmd/api/trusted_proxy_test.go src/features/student-delivery/api/assessmentDeliveryApi.test.ts
git commit -m "fix: align attempt identity and trusted proxy boundaries"
~~~

## Task 5: Make student entry an honest bounded admission gate

**Files:**

- Modify backend/go/cmd/api/entry_gate.go.
- Modify backend/go/cmd/api/handlers_v2.go.
- Modify backend/go/cmd/api/entrygate_test.go.
- Modify backend/go/cmd/api/entrygate_emit_test.go.
- Modify src/services/entryQueueRetry.ts.
- Modify src/features/student/routes/StudentEntryRoute.tsx.
- Modify src/features/student/routes/__tests__/StudentEntryRoute.test.tsx.
- Modify src/services/__tests__/entryQueueRetry.test.ts.
- Modify src/services/__tests__/entryQueueFlatEnvelope.test.ts.
- Modify k6/prod-exam-day.js and k6/scale-proof/0_entry_wave.js.

- [ ] **Step 1: Replace queue-position expectations with Retry-After expectations**

Change entryGateResult to:

~~~go
type entryGateResult struct {
    Allowed         bool
    RetryAfterSecs  int64
    CapacityLimited bool
}
~~~

Remove waiting from entryBucket. Keep token refill and per-schedule isolation. Add bounded schedule storage using the same idle-entry policy as BucketStore; when all schedule entries are active, return CapacityLimited=true without creating a new map entry.

- [ ] **Step 2: Run the entry-gate tests and verify the old assertions fail**

~~~bash
cd backend/go
go test ./cmd/api -run 'TestEntryGate|TestStudentEntry' -count=1
~~~

Expected: FAIL at queue-position assertions. The failure is intentional and marks the contract change.

- [ ] **Step 3: Remove queuePosition from the backend response**

At the student entry handler, return only:

~~~go
err.Details = map[string]any{
    "tier":              "student-entry",
    "retryAfterSeconds": gres.RetryAfterSecs,
}
~~~

Continue setting the Retry-After header. Use the same rate-limit envelope for gate capacity rejection.

- [ ] **Step 4: Replace the UI queue with bounded retry state**

Remove local ticket IDs, persisted positions, “keep your place” copy, and position rendering. Keep:

- the last submitted payload in component state while retrying;
- a Retry button after a failed retry;
- a Leave button that clears the payload;
- jittered Retry-After polling with a minimum one-second delay and maximum 65-second delay;
- an accessible live status such as “High traffic; retrying in N seconds.”

Do not persist a server position that the server does not own.

- [ ] **Step 5: Update frontend tests**

Replace position assertions with:

~~~tsx
expect(screen.getByText(/high traffic/i)).toBeInTheDocument();
expect(screen.queryByText(/position:/i)).not.toBeInTheDocument();
expect(screen.queryByText(/keep your place/i)).not.toBeInTheDocument();
~~~

Keep tests for Retry, Leave, bounded jitter, and successful admission after a 429.

- [ ] **Step 6: Update k6 scenarios**

Change entry-wave scripts to treat 429 as expected only when it has a valid numeric Retry-After or details.retryAfterSeconds. Remove checks for queuePosition, ticket persistence, or FIFO order. Preserve existing success thresholds for 200/429 and p99 latency.

- [ ] **Step 7: Run the entry contract suite**

~~~bash
cd backend/go
go test ./cmd/api -run 'TestEntryGate|TestStudentEntry' -count=1
cd ../..
bun run test:run -- src/services/__tests__/entryQueueRetry.test.ts src/services/__tests__/entryQueueFlatEnvelope.test.ts src/features/student/routes/__tests__/StudentEntryRoute.test.tsx
~~~

Expected: PASS with no position or ticket assumptions.

- [ ] **Step 8: Commit the honest gate**

~~~bash
git add backend/go/cmd/api/entry_gate.go backend/go/cmd/api/handlers_v2.go backend/go/cmd/api/entrygate_test.go backend/go/cmd/api/entrygate_emit_test.go src/services/entryQueueRetry.ts src/features/student/routes/StudentEntryRoute.tsx src/features/student/routes/__tests__/StudentEntryRoute.test.tsx src/services/__tests__/entryQueueRetry.test.ts src/services/__tests__/entryQueueFlatEnvelope.test.ts k6/prod-exam-day.js k6/scale-proof/0_entry_wave.js
git commit -m "fix: make student entry admission honest and bounded"
~~~

## Task 6: Stop client-side 429 amplification and preserve typed errors

**Files:**

- Modify src/shared/api/apiClient.ts.
- Modify src/shared/api/queryClient.ts.
- Modify src/shared/api/__tests__/queryClient.retry.test.ts.
- Modify src/shared/api/__tests__/entryQueueHeaders.test.ts.
- Create src/shared/api/__tests__/mutation.retry.test.ts.
- Modify src/services/gradingService.ts.
- Modify src/features/grading/api/gradingQueries.ts.
- Modify src/features/grading/api/__tests__/gradingQueries.test.tsx.
- Modify src/features/auth/authSession.tsx.

- [ ] **Step 1: Write the failing mutation retry test**

Use the application query-client factory, not a test client that overrides mutation retries:

~~~tsx
it('does not retry a grading mutation after a 429', async () => {
    const rateLimited = new ApiClientError({
        message: 'rate limited',
        statusCode: 429,
        backendDetails: { retryAfterSeconds: 12, tier: 'writes' },
    });
    mockStartReview.mockResolvedValue({ success: false, error: rateLimited });

    const client = createQueryClient();
    const hook = renderHook(() => useStartReview(), {
        wrapper: createWrapper(client),
    });

    await expect(hook.result.current.mutateAsync({
        submissionId: 'submission-1',
        teacherId: 'teacher-1',
        teacherName: 'Teacher',
    })).rejects.toMatchObject({ statusCode: 429 });

    expect(mockStartReview).toHaveBeenCalledTimes(1);
});
~~~

- [ ] **Step 2: Run the test and verify it fails**

~~~bash
bun run test:run -- src/shared/api/__tests__/mutation.retry.test.ts
~~~

Expected: FAIL because the application mutation default is currently one retry and the service converts the error to a generic string.

- [ ] **Step 3: Normalize the 429 error contract**

In apiClient.ts:

- Preserve retryAfterSeconds as the canonical detail name.
- Accept both retryAfterSeconds and legacy retryAfterSecs from existing servers.
- Copy numeric Retry-After into retryAfterSeconds when the body lacks it.
- Do not invent tier: student-entry for a generic 429.
- Log attempt + 1, the actual completed attempt count, instead of retries + 1.

In authSession.tsx, read retryAfterSeconds, retryAfterSecs, retryAfter, and the Retry-After header before falling back to one second.

- [ ] **Step 4: Make mutation retry policy explicit**

Use a shared predicate:

~~~ts
export function shouldRetryMutation(failureCount: number, error: unknown): boolean {
    if (isRateLimitedError(error)) {
        return false;
    }
    return failureCount < 1;
}
~~~

Set mutations.retry to shouldRetryMutation. Feature mutations may set retry: false when their operation is not idempotent.

- [ ] **Step 5: Preserve the original error through grading**

Change GradingServiceResult.error from string | undefined to unknown | undefined. In requireResultData, rethrow an Error unchanged:

~~~ts
function requireResultData<T>(result: GradingServiceResult<T>, fallback: string): T {
    if (result.success && result.data !== undefined) {
        return result.data;
    }
    if (result.error instanceof Error) {
        throw result.error;
    }
    throw new Error(typeof result.error === 'string' ? result.error : fallback);
}
~~~

Keep human-readable strings for existing callers, but do not stringify ApiClientError before the retry policy sees it.

- [ ] **Step 6: Run client retry and grading tests**

~~~bash
bun run test:run -- src/shared/api/__tests__/queryClient.retry.test.ts src/shared/api/__tests__/mutation.retry.test.ts src/shared/api/__tests__/entryQueueHeaders.test.ts src/features/grading/api/__tests__/gradingQueries.test.tsx src/services/__tests__/gradingService.backend.test.ts
~~~

Expected: PASS; one 429 mutation request, no blind retry, and Retry-After details preserved.

- [ ] **Step 7: Commit the client boundary fix**

~~~bash
git add src/shared/api src/services/gradingService.ts src/features/grading/api src/features/auth/authSession.tsx
git commit -m "fix: prevent client retries from amplifying rate limits"
~~~

## Task 7: Make configuration, telemetry, and API documentation complete

**Files:**

- Create docs/rate-limit-contract.md.
- Modify backend/go/internal/platform/telemetry/telemetry.go.
- Modify backend/monitoring/prometheus-alert-rules.yml.
- Modify api/openapi/openapi.yaml.
- Modify backend/go/cmd/api/openapi_drift_test.go to cover the reusable RateLimited response.
- Modify backend/.env.example.
- Modify .env.example if stale names are present.

- [ ] **Step 1: Write the published contract**

Document these exact rules in docs/rate-limit-contract.md:

- per-minute values are authoritative quotas;
- burst is capacity only and never increases sustained refill;
- local mode is exact and single-process;
- dual mode uses MySQL/TiDB as the distributed authority;
- DB errors use the bounded emergency local limiter;
- keys are bearer hash, verified user, then trusted IP;
- Retry-After and details.retryAfterSeconds are numeric seconds;
- X-RateLimit-Tier is present on tier denials;
- student entry is admission retry, not FIFO queue;
- RATE_LIMIT_MAX_KEYS, RATE_LIMIT_BURST, TRUSTED_PROXIES, and per-tier budgets are the supported knobs.

- [ ] **Step 2: Add failure and capacity metrics**

Add low-cardinality counters:

~~~go
MRatelimitDBErrorTotal  = "http_ratelimit_db_error_total"
MRatelimitCapacityTotal = "http_ratelimit_capacity_rejected_total"
MEntryGateCapacityTotal = "http_entry_gate_capacity_rejected_total"
~~~

Labels may contain only tier and key class. Never include user IDs, email addresses, attempt tokens, or IP addresses.

Increment DB-error metrics at the exact fallback point and capacity metrics whenever a store refuses a new active key.

- [ ] **Step 3: Add operational alerts**

Add alerts for:

- any distributed rate-limit DB errors over five minutes;
- sustained capacity rejection by tier;
- high 429 burn rate split by tier and key class;
- entry-gate capacity rejection.

Alert descriptions must point operators to the exact per-tier configuration and the failure-mode runbook.

- [ ] **Step 4: Add a reusable OpenAPI rate-limited response**

Define components/responses/RateLimited with:

- Retry-After integer header;
- optional X-RateLimit-Tier string header;
- the existing ErrorEnvelope body;
- documented details.retryAfterSeconds and details.tier.

Replace rate-limit 429 references with RateLimited; leave non-rate-limit business 429 responses on the generic error response.

- [ ] **Step 5: Add contract tests**

Verify:

- backend denial has the documented headers and body fields;
- OpenAPI contains the reusable response and every rate-limited endpoint references it;
- telemetry registry contains the new counters;
- invalid configuration is rejected before router construction.

- [ ] **Step 6: Run contract and monitoring tests**

~~~bash
cd backend/go
go test ./cmd/api ./internal/platform/httpx ./internal/platform/config -run 'OpenAPI|RateLimit|Telemetry' -count=1
cd ../..
bun run test:run -- src/shared/api/__tests__/entryQueueHeaders.test.ts
~~~

Expected: PASS.

- [ ] **Step 7: Commit documentation and operations**

~~~bash
git add docs/rate-limit-contract.md backend/go/internal/platform/telemetry/telemetry.go backend/monitoring/prometheus-alert-rules.yml api/openapi/openapi.yaml backend/go/cmd/api/openapi_drift_test.go backend/.env.example .env.example
git commit -m "docs: publish rate-limit contract and failure telemetry"
~~~

## Task 8: Verify the complete system and prove the failure boundaries

**Files:**

- Modify e2e/rate-limit-session-refresh.spec.ts to assert canonical Retry-After parsing and session preservation.
- Modify e2e/rate-limit-polling-budget.spec.ts to assert query and mutation 429 retry policy.
- Modify k6/scale-proof/0_entry_wave.js, k6/scale-proof/1_bootstrap_herd.js, k6/scale-proof/2_bootstrap_staggered.js, and k6/scale-proof/3_bootstrap_arrival.js to assert Retry-After without queue-position assumptions.
- Add test fixtures under the existing e2e fixture directory for valid cookie and bearer cases.

- [ ] **Step 1: Run focused backend verification**

~~~bash
cd backend/go
go test ./internal/platform/httpx ./internal/platform/config ./internal/auth ./cmd/api -count=1
go test -race ./internal/platform/httpx ./cmd/api -count=1
~~~

Expected: PASS with no data races in store access, tier runtime access, or trusted-proxy configuration.

- [ ] **Step 2: Run focused frontend verification**

~~~bash
bun run test:run -- src/shared/api/__tests__/queryClient.retry.test.ts src/shared/api/__tests__/mutation.retry.test.ts src/shared/api/__tests__/entryQueueHeaders.test.ts src/services/__tests__/entryQueueRetry.test.ts src/features/student/routes/__tests__/StudentEntryRoute.test.tsx src/features/grading/api/__tests__/gradingQueries.test.tsx
bun run typecheck
bun run lint
bun run build
~~~

Expected: all tests pass, TypeScript emits no errors, ESLint exits zero, and Vite build succeeds.

- [ ] **Step 3: Run browser contract tests**

~~~bash
bun run playwright -- e2e/rate-limit-session-refresh.spec.ts e2e/rate-limit-polling-budget.spec.ts
~~~

Expected:

- session refresh honors Retry-After without logging the user out;
- query polling does not retry 429;
- grading mutations do not repeat 429;
- student entry retries only after the server-provided delay;
- no test refers to queue positions or locally generated server tickets.

- [ ] **Step 4: Run controlled staging failure tests**

Run against a disposable staging deployment:

1. Send cookie-bearing requests until the pre-auth guard rejects; verify session lookup SQL does not increase for rejected requests.
2. Disable or fault the distributed-counter DB path; verify exact emergency quotas and http_ratelimit_db_error_total.
3. Send more unique keys than RATE_LIMIT_MAX_KEYS; verify active keys retain their state and capacity rejections are observable.
4. Run two API instances in dual mode; verify both share the same DB quota.
5. Run entry traffic with ENTRY_GATE=on; verify only 200 or well-formed 429 responses, no position claims, and no 5xx storm.

- [ ] **Step 5: Run existing k6 scale proofs**

Use the repository’s existing required environment variables and thresholds:

~~~bash
K6_BASE_URL=https://staging.example \
K6_SCHEDULE_ID=staging-schedule-id \
K6_ENTRY_CSV_PATH=entry-fixture.csv \
k6 run k6/scale-proof/0_entry_wave.js
~~~

Then run the bootstrap and polling scenarios already referenced by the project. Treat 429 as an expected shed signal only when the Retry-After/body contract is valid. Record p99 latency, 5xx rate, DB pool utilization, limiter DB-error counter, and capacity-rejection counter.

- [ ] **Step 6: Run the full Go suite**

~~~bash
cd backend/go
go test ./...
~~~

Expected: PASS.

- [ ] **Step 7: Perform the final acceptance review**

Confirm every Definition of Done item in this plan against test output, OpenAPI, dashboards, and the staging runbook. Do not mark the work complete if any item is satisfied only by a source comment without an executable test or observable runtime signal.

- [ ] **Step 8: Commit the verification updates**

~~~bash
git add e2e k6
git commit -m "test: verify rate-limit hardening across browser and load paths"
~~~

## Rollout order

1. Ship Tasks 1 and 2 behind the existing dual mode; keep the old environment variables as one-release aliases with deprecation logs.
2. Ship Task 3 and verify session-query reduction in staging.
3. Ship Task 4 and configure explicit trusted proxy CIDRs before enabling production traffic.
4. Ship Tasks 5 and 6 together so backend and frontend 429 contracts change atomically.
5. Ship Task 7 before the first production load test so failures are observable.
6. Run Task 8 in staging, then canary one API process, then enable the full deployment.

## Self-review checklist

- Every audit finding has an explicit task.
- Local mode, DB outage, and multi-instance behavior have separate executable tests.
- No active bucket is reset to admit a new key.
- No client retries a 429 mutation.
- No UI claims a server-side queue position that the server does not persist.
- No raw identity material enters logs, metrics, or distributed keys.
- The plan makes no production code changes until the failing tests are present.
