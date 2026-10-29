package main

import (
	"net/http"
	"net/url"
	"strings"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// noStoreMiddleware marks every /api/v1/auth response, including early
// rate-limit, CSRF and authorization errors, as uncacheable: session payloads
// carry identity and the CSRF token.
func noStoreMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/auth/") {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Pragma", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

// expectedAuthOrigin is the exact origin browser credential requests must
// carry. Production-like deployments configure AUTH_PUBLIC_ORIGIN (startup
// enforces it); local development derives it from the request itself — its
// TLS state and Host — never from an untrusted forwarded header.
func expectedAuthOrigin(cfg config.Config, r *http.Request) (config.AuthOrigin, bool) {
	if cfg.AuthPublicOrigin != "" {
		origin, err := config.ParseAuthOrigin(cfg.AuthPublicOrigin)
		return origin, err == nil
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if r.Host == "" {
		return config.AuthOrigin{}, false
	}
	origin, err := config.ParseAuthOrigin(scheme + "://" + r.Host)
	return origin, err == nil
}

// authOriginAllowed requires the request to come from the exact expected
// origin (scheme, host and effective port). Origin wins over Referer; a
// "null" or foreign value is rejected. With neither header present only a
// browser-asserted Sec-Fetch-Site: same-origin is accepted, so non-browser
// clients must send Origin explicitly.
func authOriginAllowed(cfg config.Config, r *http.Request) bool {
	want, ok := expectedAuthOrigin(cfg, r)
	if !ok {
		return false
	}
	if raw := strings.TrimSpace(r.Header.Get("Origin")); raw != "" {
		got, err := config.ParseAuthOrigin(raw)
		return err == nil && got == want
	}
	if raw := strings.TrimSpace(r.Header.Get("Referer")); raw != "" {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			return false
		}
		got, err := config.ParseAuthOrigin(u.Scheme + "://" + u.Host)
		return err == nil && got == want
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "same-origin")
}

// authOriginGuard rejects cross-origin credential and logout requests with
// the CSRF envelope before any handler work (login CSRF, forced logout).
func authOriginGuard(app *App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !authOriginAllowed(app.Config, r) {
				err := apperrors.New(apperrors.CodeCSRF, "Origin validation failed.")
				err.Code = apperrors.Code("CSRF_REJECTED")
				httpx.WriteError(w, r, err)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
