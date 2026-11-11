package main

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// GET /v1/exam-library?providerKey=sat -> {folders, entries}. SAT-only.
func examLibraryHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		provider := strings.TrimSpace(r.URL.Query().Get("providerKey"))
		if provider == "" {
			provider = strings.TrimSpace(r.URL.Query().Get("provider"))
		}
		if provider == "" {
			provider = "sat"
		}
		folders, entries, err := app.Exams.ListLibraryForActor(r.Context(), actorOf(r.Context()), provider)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"folders": folders, "entries": entries})
	}
}

func examLibraryFoldersHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		var req struct {
			Name          string  `json:"name"`
			ParentID      *string `json:"parentId"`
			ContextExamID *string `json:"contextExamId"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Exams.CreateFolderForActor(r.Context(), actorOf(r.Context()), exams.CreateFolderRequest{
			ProviderKey:   "sat",
			Name:          req.Name,
			ParentID:      req.ParentID,
			ContextExamID: req.ContextExamID,
			OperationKey:  strings.TrimSpace(r.Header.Get("Idempotency-Key")),
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

func parseRequiredRevision(value any, present bool) (int, error) {
	if !present || value == nil {
		return 0, apperrors.New(apperrors.CodeValidation, "Revision is required.")
	}
	f, ok := value.(float64)
	if !ok {
		return 0, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer.")
	}
	if math.IsNaN(f) || math.IsInf(f, 0) || math.Trunc(f) != f || f < 0 || f > 2147483647 {
		return 0, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer.")
	}
	return int(f), nil
}

func parseQueryRevision(raw string) (int, bool, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, false, nil
	}
	for _, r := range trimmed {
		if r < '0' || r > '9' {
			return 0, true, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer.")
		}
	}
	if len(trimmed) > 1 && strings.HasPrefix(trimmed, "0") {
		return 0, true, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer.")
	}
	n, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, true, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer.")
	}
	if n < 0 {
		return 0, true, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer.")
	}
	return n, true, nil
}

// readBodyForRevision reads the DELETE body with the admin cap. Empty bodies
// return nil (caller requires an explicit revision elsewhere); malformed
// bodies surface as validation errors, never as a silent revision 0.
func readBodyForRevision(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	data, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, httpx.MaxAdminBodyBytes))
	if err != nil {
		return nil, apperrors.New(apperrors.CodeBadRequest, "Invalid request body.")
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, nil
	}
	return data, nil
}

func examLibraryFolderHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		id := chi.URLParam(r, "folderId")
		switch r.Method {
		case http.MethodPatch:
			var raw map[string]any
			if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &raw); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			_, hasParent := raw["parentId"]
			var namePtr *string
			if v, ok := raw["name"]; ok && v != nil {
				s, ok := v.(string)
				if !ok {
					httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Folder name is required."))
					return
				}
				namePtr = &s
			}
			var parentPtr *string
			if hasParent {
				if raw["parentId"] == nil {
					parentPtr = nil
				} else {
					s, ok := raw["parentId"].(string)
					if !ok {
						httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Folder parent is invalid."))
						return
					}
					if strings.TrimSpace(s) != "" {
						v := strings.TrimSpace(s)
						parentPtr = &v
					} else {
						parentPtr = nil
					}
				}
			}
			rev, err := parseRequiredRevision(raw["revision"], func() bool { _, ok := raw["revision"]; return ok }())
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if namePtr != nil && !hasParent {
				out, err := app.Exams.RenameFolderForActor(r.Context(), actorOf(r.Context()), id, *namePtr, rev)
				if err != nil {
					httpx.WriteError(w, r, err)
					return
				}
				httpx.WriteJSON(w, http.StatusOK, out)
				return
			}
			if namePtr != nil && hasParent {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Rename and move must be sent separately."))
				return
			}
			if hasParent && namePtr == nil {
				out, err := app.Exams.MoveFolderForActor(r.Context(), actorOf(r.Context()), id, exams.MoveFolderRequest{ParentID: parentPtr, Revision: rev})
				if err != nil {
					httpx.WriteError(w, r, err)
					return
				}
				httpx.WriteJSON(w, http.StatusOK, out)
				return
			}
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Nothing to update."))
			return
		case http.MethodDelete:
			queryRaw := r.URL.Query().Get("revision")
			queryRev, hasQuery, err := parseQueryRevision(queryRaw)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			var rev int
			var hasRev bool
			if hasQuery {
				rev = queryRev
				hasRev = true
			} else {
				var body struct {
					Revision *int `json:"revision"`
				}
				// Malformed bodies must fail, not fall back to revision 0.
				rawBody, readErr := readBodyForRevision(r)
				if readErr != nil {
					httpx.WriteError(w, r, readErr)
					return
				}
				if rawBody != nil {
					if err := json.Unmarshal(rawBody, &body); err != nil {
						httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer."))
						return
					}
					if body.Revision == nil {
						httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision is required."))
						return
					}
					if *body.Revision < 0 {
						httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer."))
						return
					}
					rev = *body.Revision
					hasRev = true
				}
			}
			if !hasRev {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision is required."))
				return
			}
			if err := app.Exams.DeleteFolderForActor(r.Context(), actorOf(r.Context()), id, rev); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		default:
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeMethodNotAllowed, "Method not allowed."))
		}
	}
}

func examLibraryMoveHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		var raw struct {
			Items []struct {
				ExamID   *string `json:"examId"`
				Revision *int    `json:"revision"`
			} `json:"items"`
			FolderID json.RawMessage `json:"folderId"`
		}
		// Decode strictly first so fractional revisions (1.5) fail instead of
		// truncating to 1. Missing revisions decode as nil and are rejected
		// below; they must never default to revision 0.
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &raw); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer."))
			return
		}
		var folderID *string
		if len(raw.FolderID) == 0 || json.Unmarshal(raw.FolderID, &folderID) != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Choose a destination folder or the Library."))
			return
		}
		items := make([]exams.MoveExamItem, 0, len(raw.Items))
		for _, it := range raw.Items {
			if it.ExamID == nil || strings.TrimSpace(*it.ExamID) == "" {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Exam id is required."))
				return
			}
			if it.Revision == nil || *it.Revision < 0 {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision must be a nonnegative integer."))
				return
			}
			items = append(items, exams.MoveExamItem{ExamID: strings.TrimSpace(*it.ExamID), Revision: *it.Revision})
		}
		out, err := app.Exams.MoveExamsForActor(r.Context(), actorOf(r.Context()), items, folderID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []exams.FolderEntry{}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"entries": out})
	}
}
