// Package authz is the first-layer (middleware) route authorization table.
//
// DESIGN (fail-closed, dependency-free):
//
//   - Role names are plain strings ("admin", "admin_observer", "builder",
//     "proctor", "grader", "student") mirroring internal/auth.Role*.
//     Strings keep this package dependency-free: cmd/api imports both auth
//     and authz, so importing auth here would work today, but strings avoid
//     any future import-cycle risk and keep the table greppable.
//   - Table keys come in TWO forms:
//     (a) Annotated keys: the verbatim METHOD+" "+pattern string that
//     route() in cmd/api/main.go stamps via httpx.WithRoute. Those
//     patterns are chi sub-route patterns RELATIVE to their mount
//     (e.g. "GET /session" inside Route("/auth")), NOT full paths.
//     (b) Full-path keys ("METHOD /api/v1/...") for registrations that do
//     NOT go through WithRoute (probes, chained authoring verbs, the
//     release-state .Get). These carry no CtxRouteTemplate, so the
//     middleware path-matches them (matchShape, mirroring sameRouteShape
//     in cmd/api/main.go).
//   - ScopeKind is ADVISORY at the middleware layer: SelfOnly,
//     AssignedSchedule and AttemptOwner need DB lookups, so the middleware
//     enforces MinRoles only and the handler enforces the scope second.
//   - Public routes and Bearer routes (attempt-credential delivery/V2 /
//     student-mutation paths) pass through: enforcement lives in the
//     handler. Bearer=true is explicit so reviewers see the credential is
//     NOT checked here.
//   - Unknown route (no table hit by template or path) denies closed with
//     403 + a structured log line, even for admins: an unlisted route is a
//     misconfiguration, and failing open would silently unprotect it.
//
// TemplateKey bridges httpx.CtxRouteTemplate without an import: the
// wiring layer (cmd/api/main.go) sets authz.TemplateKey =
// httpx.CtxRouteTemplate once, and TemplateOf reads the annotation. This
// keeps authz dependency-free (stdlib only) while resolving the exact
// annotated template.
package authz

import (
	"context"
	"strings"
)

// Role name constants. Values MUST match internal/auth.Role* exactly; they
// are duplicated as strings (not imported) to keep this package
// dependency-free. See package doc.
const (
	RoleAdmin         = "admin"
	RoleAdminObserver = "admin_observer"
	RoleBuilder       = "builder"
	RoleProctor       = "proctor"
	RoleGrader        = "grader"
	RoleStudent       = "student"
)

// AllRoles lists every known role.
var AllRoles = []string{RoleAdmin, RoleAdminObserver, RoleBuilder, RoleProctor, RoleGrader, RoleStudent}

// readStaff/writeStaff are the shared staff role gates used by the Table
// literals in table_auth.go, table_staff.go, and table_fullpath.go. They
// live here (not in a table_*.go file) so the package compiles no matter
// which subset of table files a downstream sync picks up: authz.go is the
// entry point every copy must include (Table, Policy, Middleware).
var (
	readStaff  = []string{RoleAdmin, RoleAdminObserver, RoleBuilder}
	writeStaff = []string{RoleAdmin, RoleBuilder}
)

// ScopeKind names the second-layer (handler, DB-backed) scope check that
// applies on top of the middleware MinRoles gate. None means the role gate
// is the whole story.
type ScopeKind int

const (
	// ScopeNone: role membership is sufficient; no per-row check.
	ScopeNone ScopeKind = iota
	// ScopeSelfOnly: handler restricts rows to the caller's own user id.
	ScopeSelfOnly
	// ScopeAssignedSchedule: handler restricts proctors/graders to
	// schedules in their live schedule_staff_assignments rows
	// (proctorHasLiveAssignment / requireGraderSchedule, 404-collapse).
	ScopeAssignedSchedule
	// ScopeAttemptOwner: handler binds the attempt credential (bearer
	// claims or session user) to the URL schedule/attempt via
	// verifyAttemptBearer / requireV1StudentIdentity.
	ScopeAttemptOwner
)

// Policy is the first-layer authorization rule for one route.
type Policy struct {
	// MinRoles are the session roles admitted past the middleware gate.
	// Empty + Public=false + Bearer=false admits ANY authenticated session
	// (session/logout/register/ws-live): the handler applies its own finer
	// check. (Anon still 401s: Middleware requires a session before Allow.)
	MinRoles []string
	// Scope documents the handler second-layer check (advisory here).
	Scope ScopeKind
	// Public admits anonymous requests (no session required).
	Public bool
	// Bearer admits requests without a cookie session: the handler
	// enforces the attempt-credential check instead.
	Bearer bool
}

// RoleIn reports whether role is in roles.
func RoleIn(role string, roles ...string) bool {
	for _, r := range roles {
		if role == r {
			return true
		}
	}
	return false
}

// Allow reports whether role passes policy p at the middleware layer.
// Public and Bearer policies admit (anon "" included); an empty MinRoles
// admits any authenticated session (anon "" denied); otherwise the role
// must be listed in MinRoles. Scope is advisory here (see ScopeKind).
func Allow(role string, p Policy) bool {
	if p.Public || p.Bearer {
		return true
	}
	if len(p.MinRoles) == 0 {
		return role != ""
	}
	if role == "" {
		return false
	}
	return RoleIn(role, p.MinRoles...)
}

// TemplateKey is set once by the wiring layer to httpx.CtxRouteTemplate
// so TemplateOf can read the route annotation without importing httpx.
var TemplateKey any

// TemplateOf returns the annotated route template for ctx, or "" when the
// handler was registered without httpx.WithRoute (or wiring is unset).
func TemplateOf(ctx context.Context) string {
	if ctx == nil || TemplateKey == nil {
		return ""
	}
	if v, ok := ctx.Value(TemplateKey).(string); ok {
		return v
	}
	return ""
}

// Table maps METHOD+" "+routeTemplate to its Policy. Populated by init()
// blocks in table_*.go; FullPaths holds the full-path entries.
var Table = map[string]Policy{}

// fullPathTable holds FULL-path keys for registrations that bypass
// httpx.WithRoute (no CtxRouteTemplate): probes plus chained authoring
// verbs and the release-state GET. Populated by init() in table_fullpath.go.
var fullPathTable = map[string]Policy{}

// FullPaths exposes the full-path entries. It returns a copy so callers
// cannot mutate the table.
func FullPaths() map[string]Policy {
	out := make(map[string]Policy, len(fullPathTable))
	for k, v := range fullPathTable {
		out[k] = v
	}
	return out
}

// LookupFullPath path-matches method+path against the full-path table.
// {param} segments match any single non-empty segment; literals compare
// exactly. It mirrors sameRouteShape in cmd/api/main.go.
func LookupFullPath(method, path string) (Policy, bool) {
	for key, p := range fullPathTable {
		if matchFullKey(key, method, path) {
			return p, true
		}
	}
	return Policy{}, false
}

func matchFullKey(key, method, path string) bool {
	sp := strings.Index(key, " ")
	if sp < 0 {
		return false
	}
	if key[:sp] != method {
		return false
	}
	return matchShape(key[sp+1:], path)
}

// matchShape reports whether a chi-style pattern (with {param} segments)
// matches a concrete request path.
func matchShape(pattern, path string) bool {
	if pattern == path {
		return true
	}
	trimmedPattern := strings.Trim(pattern, "/")
	trimmedPath := strings.Trim(path, "/")
	if trimmedPattern == "" || trimmedPath == "" {
		return trimmedPattern == trimmedPath
	}
	patternSegs := strings.Split(trimmedPattern, "/")
	pathSegs := strings.Split(trimmedPath, "/")
	if len(patternSegs) != len(pathSegs) {
		return false
	}
	for i, ps := range patternSegs {
		if len(ps) >= 2 && ps[0] == '{' && ps[len(ps)-1] == '}' {
			if pathSegs[i] == "" {
				return false
			}
			continue
		}
		if ps != pathSegs[i] {
			return false
		}
	}
	return true
}
