package authz

import (
	"encoding/json"
	"log"
	"net/http"
)

// SessionOfFunc resolves (userID, role, ok) for r. The wiring layer
// (cmd/api/main.go) passes a closure over SessionOf: authz cannot import
// cmd/api (cycle) and stays dependency-free (stdlib only), so the caller
// injects session resolution here.
type SessionOfFunc func(r *http.Request) (userID, role string, ok bool)

// Middleware is the first-layer route authorization gate. Resolution:
//  1. TemplateOf(r.Context()) (the httpx.WithRoute annotation) verbatim
//     against Table; hit -> enforce.
//  2. Else LookupFullPath(method, URL path) against the full-path table
//     (registrations that bypass WithRoute); hit -> enforce.
//  3. Else deny closed: 403 + structured log line, regardless of session.
//     An unlisted route is a misconfiguration; failing open would
//     silently unprotect it.
//
// Enforcement per hit: Public/Bearer -> passthrough (handler enforces the
// credential or needs no auth); else require a session (anon -> 401) and
// require Allow(role, policy) (mismatch -> 403). ScopeKind is advisory
// here: SelfOnly/AssignedSchedule/AttemptOwner need DB lookups, so the
// handler enforces them second. Denials render the stable error envelope
// shapes ({code,message,requestId}) without importing httpx.
func Middleware(table map[string]Policy, sessionOf SessionOfFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			policy, route, ok := resolve(table, r)
			if !ok {
				denyUnknown(w, r, route)
				return
			}
			enforce(w, r, next, policy, route, sessionOf)
		})
	}
}

// LookupKey resolves one exact table key against the annotated table and
// the full-path table. It reports false for unlisted keys (deny-closed).
func LookupKey(table map[string]Policy, key string) (Policy, bool) {
	if p, ok := table[key]; ok {
		return p, true
	}
	if p, ok := fullPathTable[key]; ok {
		return p, true
	}
	return Policy{}, false
}

// MiddlewareFor returns the first-layer gate for one exact table key.
// Unlike Middleware (which resolves the key from the request template or
// path at serve time), the key is fixed at wiring time by the caller, so
// this gate never fires on 404/405 paths: chi only invokes it after a
// route matched. Unlisted keys deny closed (403), exactly like resolve
// misses in Middleware. Enforcement is shared via enforce.
func MiddlewareFor(table map[string]Policy, key string, sessionOf SessionOfFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			policy, ok := LookupKey(table, key)
			if !ok {
				denyUnknown(w, r, key)
				return
			}
			enforce(w, r, next, policy, key, sessionOf)
		})
	}
}

// enforce applies one resolved policy: Public/Bearer passthrough (the
// handler enforces the credential), else require a session (anon -> 401)
// and require Allow(role, policy) (mismatch -> 403). ScopeKind stays
// advisory here; handlers enforce scope second.
func enforce(w http.ResponseWriter, r *http.Request, next http.Handler, policy Policy, route string, sessionOf SessionOfFunc) {
	if policy.Public || policy.Bearer {
		next.ServeHTTP(w, r)
		return
	}
	if sessionOf == nil {
		denyUnknown(w, r, route)
		return
	}
	_, role, authed := sessionOf(r)
	if !authed {
		writeEnvelope(w, r, http.StatusUnauthorized, "SESSION_EXPIRED", "Session expired.")
		return
	}
	if !Allow(role, policy) {
		denyForbidden(w, r, route, role)
		return
	}
	next.ServeHTTP(w, r)
}

func resolve(table map[string]Policy, r *http.Request) (Policy, string, bool) {
	if template := TemplateOf(r.Context()); template != "" {
		p, ok := table[template]
		if !ok {
			return Policy{}, template, false
		}
		return p, template, true
	}
	if p, ok := LookupFullPath(r.Method, r.URL.Path); ok {
		return p, r.Method + " " + r.URL.Path, true
	}
	return Policy{}, r.Method + " " + r.URL.Path, false
}

func denyUnknown(w http.ResponseWriter, r *http.Request, route string) {
	log.Printf(`{"level":"warn","msg":"authz deny: unknown route","route":%q}`, route)
	writeEnvelope(w, r, http.StatusForbidden, "FORBIDDEN", "Forbidden.")
}

func denyForbidden(w http.ResponseWriter, r *http.Request, route, role string) {
	log.Printf(`{"level":"warn","msg":"authz deny: role not admitted","route":%q,"role":%q}`, route, role)
	writeEnvelope(w, r, http.StatusForbidden, "FORBIDDEN", "Forbidden.")
}

func writeEnvelope(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"code":      code,
		"message":   message,
		"requestId": requestIDOf(r),
	})
}

func requestIDOf(r *http.Request) string {
	if r == nil {
		return ""
	}
	if id := r.Header.Get("X-Request-Id"); id != "" {
		return id
	}
	return ""
}
