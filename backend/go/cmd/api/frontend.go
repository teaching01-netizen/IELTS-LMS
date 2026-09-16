package main

import (
	"net/http"
	"path"
	"path/filepath"
	"strings"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// frontendHandler serves built assets and falls back to index.html for
// client-side browser routes. API-owned paths deliberately stay JSON 404s so
// a typo in an API URL cannot silently receive the SPA document.
func frontendHandler(distDir string) http.HandlerFunc {
	distDir = strings.TrimSpace(distDir)
	fileSystem := http.Dir(distDir)
	fileServer := http.FileServer(fileSystem)

	return func(w http.ResponseWriter, r *http.Request) {
		requestPath := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
		if distDir == "" || frontendBackendPath(requestPath) {
			frontendNotFound(w, r)
			return
		}

		if frontendRegularFile(fileSystem, requestPath) {
			fileServer.ServeHTTP(w, r)
			return
		}

		// Missing files with an extension (and everything under /assets) are
		// real asset misses, not browser routes. Returning index.html here
		// would make the browser report a misleading JavaScript/CSS parse error.
		if !frontendSPAFallbackPath(requestPath) || !frontendRegularFile(fileSystem, "/index.html") {
			frontendNotFound(w, r)
			return
		}

		http.ServeFile(w, r, filepath.Join(distDir, "index.html"))
	}
}

func frontendRegularFile(fileSystem http.FileSystem, requestPath string) bool {
	file, err := fileSystem.Open(requestPath)
	if err != nil {
		return false
	}
	defer file.Close()
	info, err := file.Stat()
	return err == nil && !info.IsDir()
}

func frontendBackendPath(requestPath string) bool {
	switch requestPath {
	case "/api", "/healthz", "/readyz", "/metrics", "/v2", "/internal", "/authoring-coedit":
		return true
	}
	for _, prefix := range []string{"/api/", "/v2/", "/internal/", "/authoring-coedit/"} {
		if strings.HasPrefix(requestPath, prefix) {
			return true
		}
	}
	return false
}

func frontendSPAFallbackPath(requestPath string) bool {
	return requestPath == "/" || !strings.HasPrefix(requestPath, "/assets/") && path.Ext(requestPath) == ""
}

func frontendNotFound(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Route not found."))
}
