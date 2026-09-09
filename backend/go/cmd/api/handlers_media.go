package main

import (
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// mediaUploadBytesHandler stores raw bytes for a pending asset, mirroring
// Rust upload_local_object (NO_CONTENT 204, Bytes body, writer roles).
func mediaUploadBytesHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder, auth.RoleProctor, auth.RoleGrader, auth.RoleStudent) == nil {
			return
		}
		if app.Media == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Media service is unavailable."))
			return
		}
		assetID := strings.TrimSpace(chi.URLParam(r, "assetID"))
		// Headroom of one byte past the cap so over-limit bodies are
		// detected here (413) instead of truncating silently.
		r.Body = http.MaxBytesReader(w, r.Body, int64(media.MaxUploadBytes)+1)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodePayloadTooLarge, "Request body too large."))
			return
		}
		contentType := strings.TrimSpace(r.Header.Get("Content-Type"))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		if err := app.Media.UploadBytes(r.Context(), assetID, body, contentType); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// mediaDownloadHandler serves finalized asset bytes with the stored
// content type, mirroring Rust download_asset (raw bytes + content-type).
func mediaDownloadHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder, auth.RoleProctor, auth.RoleGrader, auth.RoleStudent) == nil {
			return
		}
		if app.Media == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Media service is unavailable."))
			return
		}
		assetID := strings.TrimSpace(chi.URLParam(r, "assetID"))
		contentType, body, err := app.Media.ReadBytes(r.Context(), assetID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if strings.TrimSpace(contentType) == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)
		// Step 7: finalized assets are immutable (status flips pending ->
		// finalized exactly once and never back), so long-lived caching is
		// safe: browsers/CDNs may reuse bytes for a year. Uploads stay
		// uncacheable via the pending-only ReadBytes guard above.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}
}

// mediaGetHandler returns one media asset's metadata JSON, mirroring Rust
// get_asset (metadata route, reader roles).
func mediaGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder, auth.RoleProctor, auth.RoleGrader, auth.RoleStudent) == nil {
			return
		}
		if app.Media == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Media service is unavailable."))
			return
		}
		assetID := strings.TrimSpace(chi.URLParam(r, "assetID"))
		out, err := app.Media.GetAsset(r.Context(), assetID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}
