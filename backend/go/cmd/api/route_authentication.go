package main

import (
	"net/http"

	"example.com/ielts-proctoring/internal/authz"
	"github.com/go-chi/chi/v5"
)

// routeAuthenticationMiddleware selects the declared authentication mechanism
// before cookie lookup and rate limiting. Match uses a private context and never
// invokes handlers or mutates the request's route parameters. An unknown route
// keeps the existing cookie/CSRF behavior; Authorization alone cannot bypass it.
func routeAuthenticationMiddleware(app *App, router chi.Router) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		cookie := authMiddleware(app)(csrfMiddleware(app)(next))
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			route := chi.NewRouteContext()
			if router.Match(route, r.Method, r.URL.Path) {
				policy, known := authz.LookupFullPath(r.Method, route.RoutePattern())
				if !known && len(route.RoutePatterns) > 0 {
					policy, known = authz.LookupKey(authz.Table, r.Method+" "+route.RoutePatterns[len(route.RoutePatterns)-1])
				}
				if known && policy.Bearer && (!policy.SessionOrBearer || r.Header.Get("Authorization") != "") {
					// The route handler verifies signature/expiry and the live grant. Never
					// fall back to an ambient account cookie when that verification fails.
					next.ServeHTTP(w, r)
					return
				}
			}
			cookie.ServeHTTP(w, r)
		})
	}
}
