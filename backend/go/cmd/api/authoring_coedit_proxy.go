package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

const coeditPublicProxyPath = "/authoring-coedit"

// coeditWebSocketProxy exposes the embedded Hocuspocus process through the
// single public HTTP port owned by the Go API. Browser tokens authenticate at
// Hocuspocus, so this route deliberately does not require a Go session cookie.
// The private control API remains loopback-only through the service URL.
func coeditWebSocketProxy(app *App) http.HandlerFunc {
	target, err := url.Parse(strings.TrimSpace(app.Config.AuthoringCoeditServiceURL))
	if err != nil || target.Scheme == "" || target.Host == "" {
		return func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "Co-editing service is unavailable.", http.StatusServiceUnavailable)
		}
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		// Hocuspocus accepts the socket handshake on its root listener. The
		// public route is intentionally not part of its document identity.
		r.URL.Path = "/"
		r.URL.RawPath = ""
		r.Host = target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "Co-editing service is unavailable.", http.StatusServiceUnavailable)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if !websocketUpgradeRequested(r) {
			w.Header().Set("Connection", "close")
			http.Error(w, "WebSocket upgrade required.", http.StatusUpgradeRequired)
			return
		}
		proxy.ServeHTTP(w, r)
	}
}

func websocketUpgradeRequested(r *http.Request) bool {
	if !strings.EqualFold(strings.TrimSpace(r.Header.Get("Upgrade")), "websocket") {
		return false
	}
	for _, value := range strings.Split(r.Header.Get("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(value), "upgrade") {
			return true
		}
	}
	return false
}
