package main

import (
	"mime"
	"net/http"
	"path"
	"path/filepath"
	"strconv"
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
			if !strings.HasPrefix(requestPath, "/assets/") {
				w.Header().Set("Cache-Control", "no-cache")
				fileServer.ServeHTTP(w, r)
				return
			}
			// Vite names every /assets file by content hash, so its bytes
			// never change under the same URL.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			w.Header().Add("Vary", "Accept-Encoding")
			if !servePrecompressedAsset(w, r, fileSystem, requestPath) {
				fileServer.ServeHTTP(w, r)
			}
			return
		}

		// Missing files with an extension (and everything under /assets) are
		// real asset misses, not browser routes. Returning index.html here
		// would make the browser report a misleading JavaScript/CSS parse error.
		if !frontendSPAFallbackPath(requestPath) || !frontendRegularFile(fileSystem, "/index.html") {
			frontendNotFound(w, r)
			return
		}

		// The document names the current build's hashed assets: revalidate it.
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(distDir, "index.html"))
	}
}

// frontendEncodings are tried in preference order; the build writes the
// sibling files (scripts/compress-dist.mjs).
var frontendEncodings = []struct{ token, ext string }{{"br", ".br"}, {"gzip", ".gz"}}

// servePrecompressedAsset serves a build-time .br/.gz sibling the client
// accepts. It reports false (nothing written) when none applies.
func servePrecompressedAsset(w http.ResponseWriter, r *http.Request, fileSystem http.FileSystem, requestPath string) bool {
	contentType := mime.TypeByExtension(path.Ext(requestPath))
	if contentType == "" {
		return false
	}
	accept := r.Header.Get("Accept-Encoding")
	for _, enc := range frontendEncodings {
		if !acceptsEncoding(accept, enc.token) {
			continue
		}
		file, err := fileSystem.Open(requestPath + enc.ext)
		if err != nil {
			continue
		}
		info, err := file.Stat()
		if err != nil || info.IsDir() {
			file.Close()
			continue
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Encoding", enc.token)
		http.ServeContent(w, r, requestPath, info.ModTime(), file)
		file.Close()
		return true
	}
	return false
}

// acceptsEncoding reports whether an Accept-Encoding header lists token
// without q=0.
func acceptsEncoding(header, token string) bool {
	for _, part := range strings.Split(header, ",") {
		name, params, _ := strings.Cut(part, ";")
		if !strings.EqualFold(strings.TrimSpace(name), token) {
			continue
		}
		q, ok := strings.CutPrefix(strings.TrimSpace(params), "q=")
		if !ok {
			return true
		}
		weight, err := strconv.ParseFloat(strings.TrimSpace(q), 64)
		return err == nil && weight > 0
	}
	return false
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
