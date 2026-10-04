package main

import (
	"io"
	"net/http"
	"strings"
	"time"

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
		content, err := app.Media.OpenFinalized(r.Context(), assetID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Step 7: finalized assets are immutable (status flips pending ->
		// finalized exactly once and never back), so long-lived caching is
		// safe: browsers/CDNs may reuse bytes for a year. Uploads stay
		// uncacheable via the finalized-only guard above.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		serveMediaContent(w, r, content)
	}
}

// serveMediaContent streams from storage (Content-Length, Range) instead of
// holding the whole figure in memory per request.
func serveMediaContent(w http.ResponseWriter, r *http.Request, content media.Content) {
	defer content.Body.Close()
	contentType := strings.TrimSpace(content.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, "", time.Time{}, content.Body)
}

// mediaContentWriteWindow outlasts the client's 120s body timeout, so a large
// figure on a slow exam-room link is not cut at the server-wide 30s WriteTimeout.
const mediaContentWriteWindow = 2 * time.Minute

func withWriteWindow(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// ErrNotSupported (e.g. httptest recorders) keeps the server default.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(mediaContentWriteWindow))
		h(w, r)
	}
}

// mediaDownloadContentHandler serves normal readers by session and SAT
// students by an attempt credential scoped to their pinned version.
func mediaDownloadContentHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer := bearerOf(r)
		if bearer == "" {
			mediaDownloadHandler(app)(w, r)
			return
		}
		if app == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Media service is unavailable."))
			return
		}
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil || claims.ClientSessionID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if app.Delivery == nil || app.Media == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Media service is unavailable."))
			return
		}
		assetID := strings.TrimSpace(chi.URLParam(r, "assetID"))
		allowed, err := app.Delivery.CanAttemptReadMedia(r.Context(), claims.ScheduleID, claims.AttemptID, assetID)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Media is unavailable."))
			return
		}
		if !allowed {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Media asset not found."))
			return
		}
		// Students get the delivery rendition: same figure, screen-sized bytes.
		content, err := app.Media.OpenDelivery(r.Context(), assetID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		serveMediaContent(w, r, content)
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
