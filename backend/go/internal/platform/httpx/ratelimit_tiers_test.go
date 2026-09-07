package httpx

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

var errTierTestDB = errors.New("tier test db down")

type countingDBChecker struct {
	allow bool
	fail  bool
	calls int
}

func (c *countingDBChecker) check(ctx context.Context, key string) (bool, time.Duration, error) {
	c.calls++
	if c.fail {
		return true, 0, errTierTestDB
	}
	if !c.allow {
		return false, time.Second, nil
	}
	return true, 0, nil
}

func doTierRequest(h http.Handler, method, target string) *httptest.ResponseRecorder {
	req, _ := http.NewRequest(method, target, nil)
	req.RemoteAddr = "198.51.100.9:1234"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func okTierHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func lookupWithUser(user string) SessionLookup {
	return func(r *http.Request) (string, bool) {
		if user != "" {
			return user, true
		}
		return "", false
	}
}

// AT-02/AT-08: tier key functions classify by credential material.
func TestTierKeyFuncsClassify(t *testing.T) {
	req, _ := http.NewRequest("GET", "/api/v1/auth/session", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	if got := UserOrIPKey(lookupWithUser("user-1"))(req); got != "user:user-1" {
		t.Fatalf("authed request must key by user, got %q", got)
	}

	anon, _ := http.NewRequest("GET", "/api/v1/auth/session", nil)
	anon.RemoteAddr = "198.51.100.9:1234"
	if got := UserOrIPKey(lookupWithUser(""))(anon); got != "ip:198.51.100.9" {
		t.Fatalf("anonymous request must key by IP, got %q", got)
	}

	bearer, _ := http.NewRequest("POST", "/api/v2/student/attempts/a/responses:batch", nil)
	bearer.RemoteAddr = "198.51.100.9:1234"
	bearer.Header.Set("Authorization", "Bearer attempt-secret-token")
	sum := sha256.Sum256([]byte("attempt-secret-token"))
	want := "attempt:" + hex.EncodeToString(sum[:])[:16]
	if got := AttemptOrUserOrIPKey(lookupWithUser(""))(bearer); got != want {
		t.Fatalf("bearer request must key by hashed attempt, got %q", got)
	}
	if got := AttemptOrUserOrIPKey(lookupWithUser(""))(bearer); tierTestContainsStr(got, "attempt-secret-token") {
		t.Fatalf("bucket key must never embed the raw bearer: %q", got)
	}

	garbage, _ := http.NewRequest("GET", "/x", nil)
	garbage.RemoteAddr = "198.51.100.9:1234"
	garbage.Header.Set("Authorization", "not-a-bearer")
	if got := AttemptOrUserOrIPKey(lookupWithUser(""))(garbage); got != "ip:198.51.100.9" {
		t.Fatalf("garbage bearer must fall back to IP, got %q", got)
	}
}

func tierTestContainsStr(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// AT-01/AT-04/AT-11: one authoritative verdict per tier, tiers isolated.
func TestTierSetAuthoritativeVerdict(t *testing.T) {
	allow := &countingDBChecker{allow: true}
	deny := &countingDBChecker{allow: false}
	ts := NewTierSet(
		map[string]TierBudget{
			TierPolling:      {PerMin: 1000, Window: time.Minute},
			TierAuthCritical: {PerMin: 1000, Window: time.Minute},
		},
		map[string]DBChecker{
			TierPolling:      allow.check,
			TierAuthCritical: deny.check,
		},
		100,
	)
	key := func(r *http.Request) string { return "user:u1" }

	// Polling tier allows (DB allows); auth-critical denies (DB denies):
	// proves the verdict comes from the per-tier DB checker, and tiers are
	// independent namespaces.
	poll := ts.Middleware(TierPolling, key)(okTierHandler())
	if rec := doTierRequest(poll, "GET", "/p"); rec.Code != 200 {
		t.Fatalf("polling request must pass, got %d", rec.Code)
	}
	sess := ts.Middleware(TierAuthCritical, key)(okTierHandler())
	if rec := doTierRequest(sess, "GET", "/s"); rec.Code != 429 {
		t.Fatalf("over-budget tier request must 429, got %d", rec.Code)
	}
	if rec := doTierRequest(poll, "GET", "/p"); rec.Code != 200 {
		t.Fatalf("isolated tier must stay 200 after the other tier denied, got %d", rec.Code)
	}
	if allow.calls != 2 || deny.calls != 1 {
		t.Fatalf("each request must produce exactly one DB verdict (allow=%d deny=%d)", allow.calls, deny.calls)
	}
}

// Prefilter sheds floods without a DB roundtrip.
func TestTierSetPrefilterShedsFlood(t *testing.T) {
	db := &countingDBChecker{allow: true}
	ts := NewTierSet(
		map[string]TierBudget{TierWrites: {PerMin: 2, Window: time.Minute}},
		map[string]DBChecker{TierWrites: db.check},
		100,
	)
	h := ts.Middleware(TierWrites, func(r *http.Request) string { return "k" })(okTierHandler())
	// Local budget = 2 * PrefilterMultiple(2) = 4 + burst 0; DB allows.
	// First 4 pass; the 5th must be shed by the prefilter with no DB call.
	for i := 0; i < 4; i++ {
		if rec := doTierRequest(h, "POST", "/w"); rec.Code != 200 {
			t.Fatalf("request %d must pass, got %d", i, rec.Code)
		}
	}
	if rec := doTierRequest(h, "POST", "/w"); rec.Code != 429 {
		t.Fatalf("flood request must be shed with 429, got %d", rec.Code)
	}
	if db.calls != 4 {
		t.Fatalf("prefilter shed must not touch the DB (calls=%d)", db.calls)
	}
}

// DB failure keeps the local verdict (fail-open invariant, per tier).
func TestTierSetDBErrorKeepsLocalVerdict(t *testing.T) {
	db := &countingDBChecker{fail: true}
	ts := NewTierSet(
		map[string]TierBudget{TierPolling: {PerMin: 1000, Window: time.Minute}},
		map[string]DBChecker{TierPolling: db.check},
		100,
	)
	rec := doTierRequest(ts.Middleware(TierPolling, func(r *http.Request) string { return "k" })(okTierHandler()), "GET", "/p")
	if rec.Code != 200 {
		t.Fatalf("DB error must keep local allow verdict, got %d", rec.Code)
	}
}

// Empty key bypasses limiting (probe exemption mechanism).
func TestTierSetEmptyKeyBypasses(t *testing.T) {
	db := &countingDBChecker{allow: false}
	ts := NewTierSet(
		map[string]TierBudget{TierPolling: {PerMin: 1000, Window: time.Minute}},
		map[string]DBChecker{TierPolling: db.check},
		100,
	)
	h := ts.Middleware(TierPolling, func(r *http.Request) string { return "" })(okTierHandler())
	if rec := doTierRequest(h, "GET", "/healthz"); rec.Code != 200 {
		t.Fatalf("empty key must bypass, got %d", rec.Code)
	}
	if db.calls != 0 {
		t.Fatalf("bypassed request must not touch the DB (calls=%d)", db.calls)
	}
}
